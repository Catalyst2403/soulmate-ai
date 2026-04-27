# Telegram Webhook Discovery

This note captures the architecture and behavior discovered while analyzing [`supabase/functions/telegram-webhook/index.ts`](./supabase/functions/telegram-webhook/index.ts).

## Scope

Primary file:
- [`supabase/functions/telegram-webhook/index.ts`](./supabase/functions/telegram-webhook/index.ts)

Related files discovered during tracing:
- [`supabase/functions/tg-redirect/index.ts`](./supabase/functions/tg-redirect/index.ts)
- [`supabase/functions/create-razorpay-order/index.ts`](./supabase/functions/create-razorpay-order/index.ts)
- [`supabase/functions/verify-razorpay-payment/index.ts`](./supabase/functions/verify-razorpay-payment/index.ts)
- [`supabase/functions/razorpay-webhook/index.ts`](./supabase/functions/razorpay-webhook/index.ts)
- [`supabase/functions/riya-analytics/index.ts`](./supabase/functions/riya-analytics/index.ts)
- [`src/pages/riya/TelegramPayment.tsx`](./src/pages/riya/TelegramPayment.tsx)
- [`src/pages/riya/RiyaAnalytics.tsx`](./src/pages/riya/RiyaAnalytics.tsx)
- [`src/App.tsx`](./src/App.tsx)

Relevant migrations:
- [`supabase/migrations/20260409_telegram_bot.sql`](./supabase/migrations/20260409_telegram_bot.sql)
- [`supabase/migrations/20260410_telegram_monetization.sql`](./supabase/migrations/20260410_telegram_monetization.sql)
- [`supabase/migrations/20260411_telegram_daily_image_count.sql`](./supabase/migrations/20260411_telegram_daily_image_count.sql)
- [`supabase/migrations/20260412_telegram_plan_limits.sql`](./supabase/migrations/20260412_telegram_plan_limits.sql)
- [`supabase/migrations/20260413_fix_debounce_conflict_key.sql`](./supabase/migrations/20260413_fix_debounce_conflict_key.sql)

## What This Function Is

`telegram-webhook/index.ts` is the Telegram DM backend for the Riya character. It is a single Supabase Edge Function that combines:
- Telegram webhook intake
- onboarding callbacks
- user creation and state management
- message debounce/merge logic
- prompt building for Gemini
- image understanding
- voice transcription
- TTS voice-note generation
- memory summarization and fact extraction
- plan enforcement and monetization gates

The entrypoint is `serve(async (req) => { ... })`.

## High-Level Flow

1. Telegram sends an update to the webhook.
2. The function validates method, parses JSON, and creates a Supabase service-role client.
3. Callback queries are routed to onboarding handling.
4. Regular private messages go through user lookup/creation.
5. Attachments and reply context are normalized into a single message payload.
6. Multiple quick user messages are debounced and merged.
7. `handleRequest()` loads plan state, recent chat history, summaries, user facts, and life-state context.
8. Gemini produces a structured JSON reply.
9. The function sends text, optional image, and optional voice note to Telegram.
10. The turn is persisted to Supabase.
11. Summary and facts refresh jobs run asynchronously.

Mental model:

`Telegram update -> normalize input -> debounce -> load user state/history -> Gemini -> send text/photo/voice -> persist -> async memory maintenance`

## Main Components

### 1. Webhook Entry

Main entrypoint:
- [`supabase/functions/telegram-webhook/index.ts`](./supabase/functions/telegram-webhook/index.ts)

Responsibilities:
- Handle CORS `OPTIONS`
- Reject non-`POST`
- Parse raw request body
- Load env vars:
  - `TELEGRAM_BOT_TOKEN`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `GEMINI_API_KEY_*`
  - `GEMINI_TTS_KEY_*` optional
  - `VERTEX_DEFAULT_PROJECT` optional
- Route callback queries to `handleCallbackQuery`
- Route regular messages into the Telegram message pipeline

Important behavior:
- Non-private chats are ignored
- Callback queries are acknowledged immediately and processed in the background when possible

### 2. Onboarding / Callback Queries

Handler:
- `handleCallbackQuery(query, supabase, botToken)`

Responsibilities:
- Ensure a `telegram_users` row exists
- Persist `preferred_language`
- Run the 18+ and AI-character disclaimer flow
- Mark users as verified or underage
- Send onboarding/welcome replies via Telegram inline keyboards

State used:
- `telegram_users.preferred_language`
- `telegram_users.is_verified`
- `telegram_users.is_underage`

### 3. User Intake and Message Normalization

In the main webhook path, the function:
- looks up `telegram_users`
- creates the user on first message
- optionally parses city from `/start <City-Name>` deep-link params
- enforces onboarding completion

It also normalizes incoming content:
- `message.text` and `message.caption`
- photos
- stickers
- voice notes
- GIFs / animations
- file/video placeholders
- `reply_to_message` context

Attachment handling turns Telegram-specific content into prompt-friendly text, or inline model parts when possible.

Examples of normalization:
- photo -> inline image bytes plus `[User sent a photo]`
- voice note -> inline audio bytes plus voice processing context
- reply to a bot voice note -> quoted context injected into the next prompt

### 4. Debounce and Merge Layer

Handler:
- `debounceAndProcess(parsed, supabase, botToken)`

Backing table:
- `telegram_pending_messages`

Purpose:
- merge fragmented user messages into one turn
- avoid replying to every partial thought

Behavior:
- upserts pending rows keyed by user/message id
- waits `DEBOUNCE_MS = 4000`
- latest row wins
- older rows are marked `absorbed`
- late-arriving rows get one additional sweep window
- orphan recovery exists if an invocation dies after inserting but before finishing

Operationally, this makes the bot feel more human in Telegram chats.

### 5. Core Conversation Orchestrator

Handler:
- `handleRequest(parsed, supabase, botToken)`

This is the center of the system. It is responsible for:
- rate limiting
- duplicate suppression
- silent-treatment logic
- daily reset logic
- streak maintenance
- plan and credit enforcement
- conversation history loading
- summary injection
- fact injection
- life-state injection
- model selection and fallback
- response parsing
- text/image/voice dispatch
- persistence
- background memory updates

### 6. Prompt and Persona Layer

Key helpers:
- `getRelationshipStage(messageCount)`
- `getTelegramSystemPrompt(...)`
- `buildLanguageBlock(preferredLang)`
- `formatFactsForPrompt(facts)`

Prompt context includes:
- user name
- preferred language
- streak
- relationship stage
- recent summary
- structured user facts
- current time in IST
- optional city
- current shared Riya life-state

The prompt enforces a strict JSON reply format:
- 1-4 message objects
- `text` max 8 words
- optional `send_image`
- optional `image_context`
- optional `send_voice`
- optional `silent_hours`
- optional `lang`

Important design note:
- The model is instructed to emit only fields it actively needs. The code then strips falsy padded fields because Gemini may include defaulted schema-like values even when not relevant.

### 7. Gemini / Vertex Layer

Key helpers:
- `vertexFetch(model, apiKey, body)`
- `projectForKey(key)`
- `vertexUrl(model, key)`
- API key pool initialization and key rotation helpers

Model strategy:
- first 10 user messages: `gemini-3.1-pro-preview`
- later: `gemini-3.1-flash-lite-preview`
- fallback: `gemini-2.5-flash`

Error handling strategy:
- rotate keys on quota exhaustion
- try same model with alternate keys on permission-style errors
- fall back to a more compatible model when needed
- retry text-only if media payload is rejected
- treat safety/prohibited-content blocks as a scripted refusal path

### 8. Media Understanding and Output

Input-side helpers:
- `describeImage(imageUrl, mediaType, apiKey, uid)`
- `transcribeVoiceNote(inlineAudio, key, uid)`
- `getTelegramFileUrl(fileId, token)`

Output-side helpers:
- `sendTelegramMessage(chatId, text, token, replyMarkup?)`
- `sendTelegramPhoto(chatId, photoUrl, token, caption?)`
- `sendTelegramVoiceBytes(chatId, wav, token)`
- `sendChatAction(chatId, action, token)`

Image sending:
- driven by the LLM via `send_image`
- resolved through `selectContextualImage(...)`
- deduped per user using `telegram_sent_images`
- sourced from `riya_gallery` and Supabase Storage bucket `riya-images`

Voice sending:
- driven by explicit `send_voice`, voice-in/voice-out routing, or spontaneous heuristics
- generated via Gemini TTS in `generateAndSendVoiceNote(...)`
- uploaded directly to Telegram as multipart voice media

Spontaneous voice is more likely when:
- the user questions realness: `bot`, `ai`, `fake`, `prove`
- some morning/night emotional contexts
- late-night conditions

### 9. Memory Layer

There are three memory systems in this file.

#### A. Raw message history

Table:
- `riya_conversations`

Purpose:
- canonical chat log for Telegram turns
- shared schema with other platforms using `source = 'telegram'`

#### B. Rolling summaries

Table:
- `telegram_conversation_summaries`

Helpers:
- `formatMessagesForSummary(messages)`
- `createSimpleSummary(messages, existing)`
- `generateConversationSummary(messages, existingSummary, apiKey)`

Purpose:
- compress older history into a prompt-friendly memory block
- keep recent messages separate from summarized messages

#### C. Structured user facts

Stored on:
- `telegram_users.user_facts`

Helpers:
- `extractAndUpdateFacts(...)`
- `safeParseFactsDelta(raw)`
- `deepMerge(existing, delta)`

Purpose:
- preserve stable facts about the user
- make future turns more personalized

### 10. Shared Character Life-State

Tables:
- `riya_life_state`
- `riya_life_state_history`

Helpers:
- `getLifeState(supabase)`
- `runLifeStateUpdate(supabase, current)`

Purpose:
- maintain a shared evolving story state for the Riya character
- comments in the code explicitly say Telegram and Instagram share this table and story arc

Behavior:
- cached in memory for 1 hour
- background update triggered if stale for more than 7 days

### 11. Monetization and Usage Gates

Constants:
- `FREE_TRIAL_LIMIT`
- `FREE_DAILY_LIMIT`
- `PAYMENT_PAGE_BASE`

RPCs used:
- `get_telegram_user_plan`
- `reset_telegram_daily_counts`
- `deduct_telegram_message_credit`

Behavior:
- free/trial/paid plan is resolved before AI generation
- free users can hit a daily wall after their trial rules are exhausted
- wall-hit messages are still logged into `riya_conversations`
- counters still advance even when no AI reply is sent
- paid users are charged one message credit after a successful response

Payment UI connection:
- frontend route `/riya/pay/telegram` in [`src/App.tsx`](./src/App.tsx)
- page implementation in [`src/pages/riya/TelegramPayment.tsx`](./src/pages/riya/TelegramPayment.tsx)

## Database Map

### Tables directly touched by `telegram-webhook`

#### `telegram_users`

Used for:
- identity and profile
- onboarding state
- preferred language
- streaks and counters
- silence state
- structured facts
- paid credits
- image/voice counters

#### `riya_conversations`

Used for:
- full chat log
- duplicate detection
- reply-context lookups
- history loading for prompts
- analytics source of truth

#### `telegram_pending_messages`

Used for:
- debounce queue
- pending/absorbed/processing/done/error statuses

#### `telegram_conversation_summaries`

Used for:
- summary text
- summary boundary tracking

#### `telegram_sent_images`

Used for:
- per-user image deduplication

#### `riya_gallery`

Used for:
- photo catalog
- image category filtering
- `times_sent` updates

#### `riya_life_state`

Used for:
- current cross-platform character state

#### `riya_life_state_history`

Used for:
- weekly state evolution history

## External Systems Map

### Telegram Bot API

Used for:
- sending text
- sending photos
- sending voice notes
- acknowledging callbacks
- resolving file paths
- typing indicators

### Vertex AI / Gemini

Used for:
- primary chat generation
- image description
- voice transcription
- TTS voice-note generation
- memory summarization
- facts extraction
- life-state evolution

### Supabase

Used for:
- all persistence
- service-role database access
- storage public URLs for images
- RPCs for plans and counters

## Adjacent System Links

### Deep-link entrypoint

File:
- [`supabase/functions/tg-redirect/index.ts`](./supabase/functions/tg-redirect/index.ts)

Observed role:
- redirects users into Telegram with a start param
- comments in the app indicate this is deployed as the Telegram redirect edge function
- the webhook later reads `/start <city>` and stores the city

### Payments

Files:
- [`supabase/functions/create-razorpay-order/index.ts`](./supabase/functions/create-razorpay-order/index.ts)
- [`supabase/functions/verify-razorpay-payment/index.ts`](./supabase/functions/verify-razorpay-payment/index.ts)
- [`supabase/functions/razorpay-webhook/index.ts`](./supabase/functions/razorpay-webhook/index.ts)

Observed role:
- Telegram users can purchase credits
- Razorpay verification/webhook code updates Telegram-specific balances and records

### Analytics

Files:
- [`supabase/functions/riya-analytics/index.ts`](./supabase/functions/riya-analytics/index.ts)
- [`src/pages/riya/RiyaAnalytics.tsx`](./src/pages/riya/RiyaAnalytics.tsx)

Observed role:
- Telegram user counts, activity, payments, retention, sessions, and funnel metrics are surfaced here

## Notable Design Characteristics

### Strengths

- End-to-end handling is complete in one place, which makes behavior tracing straightforward.
- Debounce/orphan recovery is thoughtful and tuned for chat UX.
- The function logs wall-hit and silent-period user messages instead of dropping them.
- Prompt context is richer than just recent history because it combines summary, structured facts, and life-state.
- Media flows are integrated instead of bolted on as separate handlers.

### Tradeoffs / Risks

- The file is very large and acts as transport layer, orchestration layer, business rules layer, and memory layer at once.
- Cross-cutting behavior is hard to test in isolation because many concerns live in one function file.
- Prompt contract and post-processing are tightly coupled; schema drift or model behavior changes could create subtle regressions.
- Some comments indicate parity with Instagram behavior, which suggests shared product logic is currently duplicated across webhook files.

## Condensed Architecture Summary

If you need the shortest useful summary of this file:

- `serve()` accepts Telegram updates and routes callbacks or messages.
- new users are onboarded into `telegram_users`.
- messages are normalized and passed through `telegram_pending_messages` for debounce merging.
- `handleRequest()` loads user state, plan info, summary, facts, and life-state from Supabase.
- Gemini returns structured message objects that can contain text, image-send, voice-send, language-switch, or silence signals.
- the function sends content through Telegram APIs.
- the turn is saved in `riya_conversations`.
- summaries and facts are refreshed asynchronously.

## Useful Next Steps

Possible follow-up docs or refactors:
- split this file into modules: transport, prompting, memory, monetization, media
- document the JSON contract expected from Gemini in a dedicated spec
- extract a shared Riya character core used by Telegram and Instagram
- add a sequence diagram for the webhook request lifecycle
- add tests around debounce, wall-hit behavior, and response parsing

