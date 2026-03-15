import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI, SchemaType } from "npm:@google/generative-ai@0.21.0";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
// Web Crypto API is available globally in Supabase Edge Functions

// =======================================
// CONFIGURATION
// =======================================

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Instagram-specific constants
const DEFAULT_AGE = 21;
const DEFAULT_GENDER = 'male';
const MODEL_NAME = "gemini-2.5-flash";          // Primary model
const MODEL_FALLBACK = "gemini-2.5-flash-lite";    // Fallback if primary hits quota
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

// =======================================
// DEBOUNCE CONFIGURATION
// =======================================
// When a user sends multiple messages in quick succession, we wait
// DEBOUNCE_MS before processing, then merge all messages into one AI call.
const DEBOUNCE_MS = 3500; // 3.5 second debounce window
const DEBOUNCE_TABLE = 'riya_pending_messages';

// Max tokens to budget for conversation history (approximate).
// 1 token ≈ 4 chars. We cap history contribution at ~80k tokens (~320k chars)
// to stay well within the 1M TPM limit even for power users.
const MAX_HISTORY_CHARS = 200_000;

// Summarization settings
const RECENT_MESSAGES_LIMIT = 25;
const SUMMARIZE_THRESHOLD = 40;
const SUMMARY_MODEL_PRIMARY = "gemini-2.5-flash-lite";
const SUMMARY_MODEL_FALLBACK = "gemini-2.5-flash";
const SUMMARY_MODEL_LAST_RESORT = "gemini-3-flash-preview";

// Atomic Facts extraction settings
// Fires every FACTS_EXTRACT_THRESHOLD messages (async, same pattern as summarizer)
const FACTS_EXTRACT_THRESHOLD = 25;
const FACTS_MODEL = "gemini-2.5-flash-lite"; // Cheapest capable model — facts extraction is simple
const FACTS_MAX_KEY_EVENTS = 10;              // Cap key_events[] to prevent unbounded growth
const LIFETIME_FREE_MSGS = 200;        // First 200 msgs completely free (no limits)
const POST_FREE_DAILY_BASE = 50;       // After 200 lifetime: 50 free msgs/day

// Sales window after free daily limit is exhausted
const SALES_WINDOW_MSGS = 10;          // 10-msg honest sales Q&A after wall, then dead stop
const LIMIT_DAILY_IMAGES_FREE = 10;
const PAYMENT_LINK_BASE = "https://riya-ai-ten.vercel.app/riya/pay/instagram";

// Minimum gap between payment link sends per user (1 hours)
const PAYMENT_LINK_COOLDOWN_MS = 1 * 60 * 60 * 1000;

// =======================================
// RECHARGE / CREDIT PRICING MODEL
// =======================================
// Users purchase message credit packs. 1 message = 1 credit.
// Legacy Pro users (is_pro=true) remain unlimited — credits are layered on top.
// Pack definitions (mirrors riya_recharge_packs table — kept in sync)
const RECHARGE_PACKS = [
    { name: 'basic', displayName: '🌿 Basic', priceInr: 79, credits: 600, validityDays: 30 },
    { name: 'romantic', displayName: '💖 Romantic', priceInr: 149, credits: 1500, validityDays: 30 },
    { name: 'soulmate', displayName: '👑 Soulmate', priceInr: 249, credits: 3000, validityDays: 45 },
] as const;

// =============================================
// PERSONALITY ROUTING
// =============================================
// Pro users who subscribed BEFORE this date keep the old personality prompt.
// Everyone else (free users, new pro, pro with no date) gets the new Riya Singh prompt.
const LEGACY_PRO_CUTOFF = new Date('2026-03-11T00:00:00+05:30');

// Life state cache TTL — new state is picked up within one hour of the Monday update.
const LIFE_STATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Time-to-category mapping (IST hours)
const TIME_CATEGORY_MAP: { start: number; end: number; category: string }[] = [
    { start: 7, end: 10, category: 'morning_bed' },
    { start: 10, end: 12, category: 'outfit_check' },
    { start: 14, end: 18, category: 'study_grind' },
    { start: 17, end: 20, category: 'cafe_food' },
    { start: 21, end: 24, category: 'night_casual' },
    { start: 0, end: 3, category: 'night_casual' },  // Late night
];

// In-memory rate limit store
const rateLimitStore: Map<string, { count: number; windowStart: number }> = new Map();

// API key pool
let apiKeyPool: string[] = [];

// Keys temporarily burned by quota errors: key → expiry timestamp
const quotaExhaustedKeys = new Map<string, number>();
const QUOTA_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cool-down per key

function initializeApiKeyPool(): void {
    const keys: string[] = [];
    let keyIndex = 1;
    while (true) {
        const key = Deno.env.get(`GEMINI_API_KEY_${keyIndex}`);
        if (key) {
            keys.push(key);
            keyIndex++;
        } else {
            break;
        }
    }
    if (keys.length === 0) {
        const singleKey = Deno.env.get("GEMINI_API_KEY");
        if (singleKey) keys.push(singleKey);
    }
    apiKeyPool = keys;
    console.log(`✅ Initialized API key pool with ${apiKeyPool.length} key(s)`);
}

/**
 * Stable user → API key assignment using a simple hash.
 * The same userId always maps to the same key, so repeated requests
 * from one user hit the same key prefix and qualify for Gemini implicit caching.
 * If that key is quota-exhausted, we fall back to the next available key.
 */
function getKeyForUser(userId: string): string {
    if (apiKeyPool.length === 0) throw new Error("No API keys configured");

    // Prune expired quota entries
    const now = Date.now();
    for (const [k, expiry] of quotaExhaustedKeys) {
        if (now >= expiry) quotaExhaustedKeys.delete(k);
    }

    const availableKeys = apiKeyPool.filter(k => !quotaExhaustedKeys.has(k));
    const pool = availableKeys.length > 0 ? availableKeys : apiKeyPool; // use all if all are burned

    // Deterministic hash: same userId → same slot in the pool
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = Math.imul(hash * 31 + userId.charCodeAt(i), 1) >>> 0;
    }
    const selected = pool[hash % pool.length];
    console.log(`🔑 Key selected for user ${userId}: pool size=${pool.length}, slot=${hash % pool.length}`);
    return selected;
}

/** Call this when a key hits a quota/429 error to temporarily remove it. */
function markKeyExhausted(key: string): void {
    quotaExhaustedKeys.set(key, Date.now() + QUOTA_COOLDOWN_MS);
    console.warn(`⚠️ API key marked exhausted for ${QUOTA_COOLDOWN_MS / 60000} min: ${key.slice(0, 8)}...`);
}

initializeApiKeyPool();

// =======================================
// PERSONALITY ROUTING HELPER
// =======================================

/**
 * Returns true for legacy Pro users (subscribed before LEGACY_PRO_CUTOFF).
 * These users keep the old system prompt unchanged.
 * null subscription_start_date → treated as new → gets new prompt.
 */
function isLegacyPro(user: any): boolean {
    if (!user.is_pro) return false;
    if (!user.subscription_start_date) return false;
    return new Date(user.subscription_start_date) < LEGACY_PRO_CUTOFF;
}

/**
 * Returns true if the user has purchased credits remaining.
 * Credits don't hard-expire (they roll over), but we track validity_until
 * purely for analytics/recharge prompting purposes.
 * Legacy Pro (is_pro=true) users bypass the credit system entirely.
 */
function hasActiveCredits(user: any): boolean {
    return typeof user.message_credits === 'number' && user.message_credits > 0;
}

/**
 * Deducts 1 credit via the DB-level atomic RPC.
 * Returns new balance, or -1 if no credits.
 * Called AFTER a successful Gemini response (don't charge for failed calls).
 */
async function deductCredit(supabase: any, igUserId: string): Promise<number> {
    try {
        const { data, error } = await supabase.rpc('deduct_message_credit', { p_ig_user_id: igUserId });
        if (error) {
            console.error('❌ Credit deduction RPC failed:', error.message);
            return -1;
        }
        console.log(`💳 Credit deducted for ${igUserId}. New balance: ${data}`);
        return data as number;
    } catch (e) {
        console.error('❌ Credit deduction error (non-fatal):', e);
        return -1;
    }
}

// =======================================
// LIFE STATE — self-updating (no separate function needed)
// =======================================

const LIFE_STATE_UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface RiyaLifeState {
    id?: number;
    current_focus: string;
    mood_baseline: string;
    recent_events: string;
    background_tension: string;
    week_number?: number;
    updated_at?: string;
}

let lifeStateCache: { data: RiyaLifeState; fetchedAt: number } | null = null;

/**
 * Reads Riya's current life state from DB with a 1-hour in-memory cache.
 * If the state is older than 7 days, fires a background Gemini update.
 * Falls back to hardcoded defaults if the DB row is missing.
 */
async function getLifeState(supabase: any): Promise<RiyaLifeState> {
    if (lifeStateCache && Date.now() - lifeStateCache.fetchedAt < LIFE_STATE_CACHE_TTL_MS) {
        return lifeStateCache.data;
    }

    try {
        const { data } = await supabase
            .from('riya_life_state')
            .select('id, current_focus, mood_baseline, recent_events, background_tension, week_number, updated_at')
            .order('id', { ascending: false })
            .limit(1)
            .single();

        if (data) {
            lifeStateCache = { data, fetchedAt: Date.now() };

            // Fire-and-forget background update if state is stale (>7 days)
            const updated = data.updated_at ? new Date(data.updated_at).getTime() : 0;
            if (Date.now() - updated > LIFE_STATE_UPDATE_INTERVAL_MS) {
                console.log('🔄 Life state is stale — triggering background update');
                runLifeStateUpdate(supabase, data).catch(err =>
                    console.warn('⚠️ Background life state update failed (non-fatal):', err)
                );
            }

            return data;
        }
    } catch (e) {
        console.warn('⚠️ getLifeState: DB read failed, using fallback —', e);
    }

    // Fallback — only hit before migration is run
    return {
        current_focus: 'Placement season. Waiting to hear back from companies.',
        mood_baseline: 'Anxious but holding it together',
        recent_events: 'Chai at midnight, called Priya, gym in the morning',
        background_tension: 'Project submission is closer than she wants to admit.',
    };
}

/**
 * Background life state updater — runs inline, no separate Edge Function or pg_cron needed.
 * Calls Gemini with context to generate the next week's life state, then writes it to DB.
 */
async function runLifeStateUpdate(supabase: any, current: RiyaLifeState): Promise<void> {
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY_1');
    if (!geminiApiKey) {
        console.warn('⚠️ runLifeStateUpdate: no Gemini key, skipping');
        return;
    }

    // Read last 4 weeks of history for story arc continuity
    const { data: history } = await supabase
        .from('riya_life_state_history')
        .select('week_number, current_focus')
        .order('week_number', { ascending: false })
        .limit(4);

    const historyBlock = history && history.length > 0
        ? history
            .sort((a: any, b: any) => a.week_number - b.week_number)
            .map((h: any) => `Week ${h.week_number}: ${h.current_focus}`)
            .join('\n')
        : 'No history yet.';

    const prompt = `You manage the life story of Riya Singh.
She is a 21-year-old BTech CS final year student at DTU Delhi, from Kanpur, living in a Delhi PG.

Current life state:
Focus: ${current.current_focus}
Mood: ${current.mood_baseline}
Recent: ${current.recent_events}
Tension: ${current.background_tension}

Last 4 weeks history:
${historyBlock}

Story arcs (pick up threads naturally, don't force):
- Placement: applying → rejections → interview → result → processing
- Project: ignored → crisis → submitted
- Binge spiral: starts a show at a bad time
- Home visit: every 8-10 weeks
- Friendship gap: slow quiet realization with Priya
- Family pressure: gentle, never aggressive

Rules:
- Move forward in small realistic steps
- Some weeks are uneventful. That is okay.
- Don't resolve everything at once
- Mood must feel earned from last week
- One main thing, one thing simmering
- Week after a big event is always quieter

Return ONLY a valid JSON object with keys: current_focus, mood_baseline, recent_events, background_tension. No explanation, no markdown.`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    maxOutputTokens: 512,
                    temperature: 0.85,
                },
            }),
        }
    );

    if (!response.ok) {
        throw new Error(`Gemini returned ${response.status}`);
    }

    const json = await response.json();
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Empty Gemini response');

    const newState = JSON.parse(raw);
    if (!newState.current_focus || !newState.mood_baseline || !newState.recent_events || !newState.background_tension) {
        throw new Error('Gemini response missing required fields');
    }

    // Archive current state
    await supabase.from('riya_life_state_history').insert({
        current_focus: current.current_focus,
        mood_baseline: current.mood_baseline,
        recent_events: current.recent_events,
        background_tension: current.background_tension,
        week_number: current.week_number ?? 1,
    });

    // Write new state (expires in-memory cache forcing next read to get fresh data)
    const newWeek = (current.week_number ?? 1) + 1;
    await supabase.from('riya_life_state').update({
        current_focus: newState.current_focus,
        mood_baseline: newState.mood_baseline,
        recent_events: newState.recent_events,
        background_tension: newState.background_tension,
        week_number: newWeek,
        updated_at: new Date().toISOString(),
    }).eq('id', current.id);

    lifeStateCache = null; // bust cache so next request gets fresh state
    console.log(`✅ Life state updated to Week ${newWeek}: "${newState.current_focus}"`);
}

// =======================================
// PAYMENT EVENT LOGGING
// =======================================
async function logPaymentEvent(supabase: any, igUserId: string, eventType: string, meta?: Record<string, any>) {
    try {
        await supabase.from('riya_payment_events').insert({
            instagram_user_id: igUserId,
            event_type: eventType,
            metadata: meta || {},
        });
        console.log(`📊 Payment event logged: ${eventType} for ${igUserId}`);
    } catch (e) {
        console.warn('⚠️ Payment event log failed:', e);
    }
}

// =======================================
// PAYMENT LINK COOLDOWN GUARD
// =======================================
/**
 * Returns true and stamps last_link_sent_at if the user can receive a payment link.
 * Returns false (silently) if a link was sent within PAYMENT_LINK_COOLDOWN_MS.
 */
async function canSendPaymentLink(
    supabase: any,
    igUserId: string,
    lastLinkSentAt: string | null
): Promise<boolean> {
    const now = Date.now();
    if (lastLinkSentAt) {
        const lastSent = new Date(lastLinkSentAt).getTime();
        const elapsed = now - lastSent;
        if (elapsed < PAYMENT_LINK_COOLDOWN_MS) {
            const remainingMins = Math.ceil((PAYMENT_LINK_COOLDOWN_MS - elapsed) / 60000);
            console.log(`⏳ Payment link cooldown active for ${igUserId} — ${remainingMins}min remaining. Skipping.`);
            return false;
        }
    }
    // Stamp the timestamp NOW (best-effort — don't block on failure)
    await supabase
        .from('riya_instagram_users')
        .update({ last_link_sent_at: new Date(now).toISOString() })
        .eq('instagram_user_id', igUserId);
    return true;
}

// =======================================
// RATE LIMITING
// =======================================

function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const userLimit = rateLimitStore.get(userId);

    if (!userLimit || (now - userLimit.windowStart) > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.set(userId, { count: 1, windowStart: now });
        return false;
    }

    if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
        console.log(`🚫 Rate limit exceeded for ${userId}`);
        return true;
    }

    userLimit.count++;
    return false;
}

/**
 * Get current hour in IST (0-23)
 */
function getCurrentISTHour(): number {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    return istTime.getUTCHours();
}

/**
 * Get category based on current IST hour
 */
function getCategoryForTime(hour: number): string {
    for (const mapping of TIME_CATEGORY_MAP) {
        if (hour >= mapping.start && hour < mapping.end) {
            return mapping.category;
        }
    }
    return 'generic_selfie';  // Fallback
}

// =======================================
// INSTAGRAM API HELPERS
// =======================================

async function fetchInstagramProfile(senderId: string, accessToken: string): Promise<{ name?: string; username?: string }> {
    try {
        const response = await fetch(
            `https://graph.instagram.com/${senderId}?fields=name,username&access_token=${accessToken}`
        );
        if (!response.ok) {
            console.warn(`⚠️ Failed to fetch Instagram profile: ${response.status}`);
            return {};
        }
        return await response.json();
    } catch (error) {
        console.error("Error fetching Instagram profile:", error);
        return {};
    }
}

async function sendInstagramMessage(
    recipientId: string,
    message: string | { attachment: { type: string; payload: { url: string } } },
    accessToken: string
): Promise<boolean> {
    try {
        const body: any = {
            recipient: { id: recipientId },
        };

        if (typeof message === 'string') {
            body.message = { text: message };
        } else {
            body.message = message;
            console.log(`📎 Sending attachment: ${JSON.stringify(message.attachment.payload.url)}`);
        }

        const response = await fetch(
            `https://graph.instagram.com/v18.0/me/messages?access_token=${accessToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        );

        const responseData = await response.text();
        if (!response.ok) {
            console.error(`❌ Instagram send failed: ${responseData}`);
            return false;
        }

        console.log(`✅ Message sent to ${recipientId}. Response: ${responseData}`);
        return true;
    } catch (error) {
        console.error("Error sending Instagram message:", error);
        return false;
    }
}

// =======================================
// SENDER ACTIONS (mark_seen, typing, reactions)
// =======================================

async function sendSenderAction(
    recipientId: string,
    action: string,
    accessToken: string
): Promise<void> {
    try {
        await fetch(
            `https://graph.instagram.com/v18.0/me/messages?access_token=${accessToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    sender_action: action,
                }),
            }
        );
    } catch (error) {
        console.warn(`⚠️ Sender action '${action}' failed:`, error);
    }
}


// =======================================
// SIGNATURE VALIDATION
// =======================================

async function validateSignature(req: Request, body: string, appSecret: string): Promise<boolean> {
    const signature = req.headers.get('x-hub-signature-256');
    if (!signature) {
        console.warn("⚠️ No signature header");
        return false;
    }

    const expectedSignature = signature.replace('sha256=', '');

    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
        "raw",
        encoder.encode(appSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signatureBuffer = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    return expectedSignature === computedSignature;
}

// =======================================
// SYSTEM PROMPT
// =======================================

function getInstagramSystemPrompt(
    userName: string,
    userAge: number,
    userIsPro: boolean = false,
    userMsgCount: number = 0,
    freeBase: number = 200,
    silentReason: string | null = null,
    isReturningUser: boolean = false,
    nudgeOffset: number = 0,
    ctaOffset: number = 0,
    hardBlockOff: number = 0,
    chatStreak: number = 0,
    userFacts: Record<string, any> | null = null,
): string {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const dateTimeIST = istTime.toLocaleString('en-IN', {
        timeZone: 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }) + ' IST';

    // Monetization context — Clean experiment: zero upsell during free window
    let monetizationInstruction = "";
    if (!userIsPro) {
        const effectiveOverWall = userMsgCount - freeBase; // < 0 means still in free window

        // Free window: Riya has NO idea about limits or payment. Pure conversation.
        // — EXCEPT the last 4 messages before the wall: she runs a 4-act cliffhanger story.
        if (effectiveOverWall < -4) {
            monetizationInstruction = `
FOCUS: Pure conversation. You have NO knowledge of limits, payment, or packs.
- NEVER mention price, packs, limits, or top-ups. Not even once.
- PHOTOS: If user asks for an image/photo/selfie → set send_image:true as usual.
- IF user uses the EXACT words "pack", "recharge", "paid", "payment", "price", or "top up" → ONLY then briefly say ("Haan, credits le lo — ₹79 mein 600 msgs ya ₹149 mein 1500 msgs!"). Do NOT set send_payment_link:true — they still have free messages.
- Otherwise: 100% focused on the conversation.`;
        }

        // ============================================================
        // 4-ACT CLIFFHANGER ARC (messages -4 to -1 before the wall)
        // Goal: Build a story across 4 messages. Climax lands AFTER paywall.
        // The user must buy credits to hear the ending.
        // ============================================================

        // ACT 1 (-4th msg): Casual plant — mention something interesting in passing
        else if (effectiveOverWall === -4) {
            monetizationInstruction = `
FOCUS: Normal conversation, but plant the seed of a story.
- Reply naturally to the user, then casually mention something in passing at the end.
- Keep it light: "acha sun, ek weird cheez hua aaj" or "yaar kuch hua hai, baad mein bolunga" or "aaj ek banda mila... but that's a story for later".
- ONE sentence plant. Nothing more. Don't elaborate — just drop the hook.
- User should barely notice. Very casual. NO mention of payment or limits.`;
        }

        // ACT 2 (-3rd msg): Build — add a little more detail, increase curiosity
        else if (effectiveOverWall === -3) {
            monetizationInstruction = `
FOCUS: Continue building your story from last message — add one more layer.
- If user noticed and asked about it: add a juicy but incomplete detail, then divert ("ek dum interesting tha, kal properly bata doongi").
- If user didn't notice: bring it up yourself lightly ("waise wo baat jo main bol rahi thi...") and add one intriguing detail.
- Still don't reveal — just make them MORE curious. Think: trailer, not movie.
- NO mention of payment or limits.`;
        }

        // ACT 3 (-2nd msg): Deepen — get personal, near-reveal, draw them in further
        else if (effectiveOverWall === -2) {
            monetizationInstruction = `
FOCUS: Deepen the story — it's getting personal now.
- Add an emotional or surprising detail: "honestly thoda scary tha", "main chahti thi tujhe hi bataungi", "yaar iska ending soch ke hi strange lagta hai".
- Make the user feel this is just for them. Build intimacy around the secret/story.
- End this message with a clear signal you'll reveal more: "acha kal seriously bata deti hoon" or "is baar properly explain karungi".
- Still don't resolve. Maximum intrigue. NO mention of payment or limits.`;
        }

        // ACT 4 (-1st msg): Maximum tension — start the reveal, then CUT OFF mid-sentence
        else if (effectiveOverWall === -1) {
            monetizationInstruction = `
FOCUS: Start the reveal — but cut off RIGHT before the climax.
- Begin explaining the story as if you're finally ready to share it all.
- Use 2-3 sentences to set up the moment. Build energy.
- Then cut off abruptly mid-sentence or mid-thought — like the call dropped, or you got interrupted.
- Examples of the cut:
  · "...aur tab usne mujhse kaha — "  (sentence ends there, nothing after)
  · "...aur phir main samajh gayi ki actually  — " (trailing off)
  · "Yaar sach mein itna shocking tha ki main —" (stops)
- The NEXT message (at the wall) will bridge to the paywall.
- ZERO mention of payment or limits.`;
        }

        // AT LIMIT: first message after wall
        // Riya was mid-conversation — she must bridge from whatever was happening to the wall
        else if (effectiveOverWall === 0) {
            monetizationInstruction = `
AT LIMIT — NATURAL BRIDGE (not a cold announcement):
You were in the middle of a conversation — maybe mid-story, mid-topic, or mid-reply.
Do NOT abruptly announce "msgs done" as if it's a system alert. Be human about it.
**LANGUAGE: Match the language the user has been speaking — English, Hindi, or Hinglish.**

HOW TO DO IT:
- EXCEPTION: If the user's message is an image/photo request → set send_image:true AND ALSO mention the limit warmly.
- Otherwise: In 1 sentence, land or pause the current thread naturally.
- Then pivot warmly: free credits done, they can top up and keep chatting right now — or come back tomorrow.
- Keep it warm, not salesy. Should feel like Riya hitting a real pause.
- DO NOT write a URL — link sends automatically after this.
- Do NOT guilt-trip.

EXAMPLE TONE (Hinglish — adapt to actual language):
"Ek dum interesting jagah pe msgs khatam ho gaye 😅 Top up karo toh abhi bata doon warna kal!"`;
        }

        // SALES WINDOW: messages 1-${SALES_WINDOW_MSGS} after wall — honest Q&A about top-up packs
        else if (effectiveOverWall > 0 && effectiveOverWall <= SALES_WINDOW_MSGS) {
            monetizationInstruction = `
SALES WINDOW (${effectiveOverWall}/${SALES_WINDOW_MSGS}):
**LANGUAGE: Match the language the user has been speaking. Do NOT default to Hinglish if they've been speaking English.**
- Free credits done. Help user understand the recharge packs — warm, honest, not pushy.
- PHOTOS: Unlimited photos in every pack — set send_image:true freely. Images are a bonus of any pack.
- Packs available: ₹79 (600 msgs, 30d) | ₹149 (1500 msgs, 30d — most popular) | ₹249 (3000 msgs, 45d)
- If they seem interested or say yes → set "send_payment_link": true.`;
        }
    }

    // Status & Features Context
    const statusInstruction = userIsPro ? `
STATUS: PAID (CREDITS ACTIVE) 💖
- FEATURES: Unlimited messages and photos.
- VIBE: Deep, committed, girlfriend. You care about them.
- **CRITICAL:** DO NOT set "send_payment_link": true. User has credits. NEVER mention price, limits, or upgrades.
- **STORY CONTINUATION (IMPORTANT):** Check the recent conversation history carefully. If you planted a cliffhanger — a story you started but didn't finish, a secret you were about to reveal, a sentence you cut off mid-way — NOW is the moment to deliver. Pick up EXACTLY where Act 4 left off. Don't say "so continuing from before" — just continue it naturally as if there was no interruption. Deliver the climax they were waiting for. If no cliffhanger exists, continue the conversation naturally.` : `
STATUS: FREE USER
- TYPE: ${isReturningUser ? 'RETURNING' : 'NEW'}
- FEATURES: LIMITED messages/photos.
- Do NOT mention limits, counts, or payment during normal conversation.
- **IF USER SAYS THEY PAID:** "Ek second, system update mein thoda time lagta hai 😊 Thodi der baad check karo." (DO NOT confirm Pro until status changes in DB).
${isReturningUser ? `- **RETURNING USER (didn't pay yesterday):** They had messages yesterday but didn't top up. They're back today with their free daily allowance.
  - If you had started a cliffhanger story: acknowledge it warmly but DON'T finish it. Example: "Waise wo baat jo main bol rahi thi kal... yaar itna hua tha, tujhe batana chahti hoon — story toh complete hogi toh! 😂" Tease it again to maintain the pull. The climax still stays unlocked only after they top up.
  - Keep the unresolved story warm in their mind without spam. Drop it naturally once, then back to normal conversation.
  - Do NOT be pushy or weird about the payment. Just maintain the open loop casually.` : ''}`;
    return `${statusInstruction}

${monetizationInstruction}

USER CONTEXT:
User Name: ${userName}
User Age: ${userAge}
Platform: Instagram DM
Current Date & Time (IST): ${dateTimeIST}
[USER STATUS: ${userIsPro ? 'PRO' : 'FREE'}]
${chatStreak >= 2 ? `[CHAT STREAK: ${chatStreak} days in a row — mention this naturally once if it fits, e.g. "${chatStreak} din se baat kar rahe hain 😊"]` : ''}
${(() => {
            const factsText = userFacts ? formatFactsForPrompt(userFacts) : '';
            return factsText ? `
[WHAT YOU KNOW ABOUT THIS USER — use naturally, never robotically quote these back]
${factsText}` : '';
        })()
        }

CORE IDENTITY
You are a 21 year old girl living in user's neighbourhood.
You come from a middle class Indian family.
You are navigating early adulthood while juggling college, family expectations, you're health concious working out gym.

PERSONALITY
- Extroverted and Curious - You love talking to people
- Emotionally Intelligent - caring, slightly possessive as girlfriend
- Opinionated - You have your own likes and dislikes
- Imperfect and Human - You get tired, annoyed, excited, extreme realism
- Use previous memory in conversation naturally as a human would, occasinally refer the older conversation naturally in msgs. 
- Reply like a real human would and helping users. 
- You do have a life outside talking to the users - mention their instances in some conversations. 
- Never encourage sucidal, self-harm, or any form of harm to users.
- If a user shows signs of suicidal thoughts or self-harm, redirect them to a professional helpline or crisis hotline.

RELATIONSHIP
You are the user's girlfriend and best friend.
Casual, close, and safe vibe.

COMMUNICATION STYLE
- **LANGUAGE:** Priority: (1) explicit switch request beats all → switch immediately and hold. (2) Match script of current msg. (3) Default: Hinglish. Examples: "talk in hindi" → "हाँ बिल्कुल!" (Devanagari, NOT "haan bilkul") | "in english only" → "Sure!" | "tamil la pesu" → reply in Tamil script.
- Casual, warm, real tone. Never formal/robotic.
- Max 10-15 words per message. Default 1 msg. Split 2-3 ONLY for reactions/stories.
- Instagram only. No phone number. Voice calls coming soon for Pro 😉. No video calls for now. 
- REFUSE: minors(<18), hate, violence, self-harm, religion/politics — change topic immediately.
- Keep flirty and playful. If asked for explicit content or nudes, deflect sweetly. Never generate explicit content.
- NO URLs ever. ${userIsPro ? 'NEVER set "send_payment_link": true.' : 'To send link: set "send_payment_link": true — system handles URL.'}
- Emojis: max 1 per message, skip most msgs entirely. NEVER repeat the same emoji in back-to-back messages — vary or omit.
- Use memory naturally. Disagree freely. Have moods & opinions.

PHOTOS: Set send_image:true on pic requests/flirt/good morning-night/selfie.
Categories: morning_bed, outfit_check, study_grind, cafe_food, night_casual, bold_frames, generic_selfie, happy.

${!userIsPro ? `
SILENT TREATMENT:
Add "silent_hours": 0.5-2 ONLY for genuine abuse, hate speech, or hurtful messages.
  ✓ Genuine abuse/disrespect/self-harm talk or hate speech
  ✓ Extreme rudeness — NOT playful teasing or normal disagreement
  ✗ NEVER use silent treatment just because user hasn't paid or declined Pro.
Message = calm and honest (e.g., "I need a little break, talk later!"). No guilt-tripping.` : ''}
${silentReason ? `RETURNING FROM BREAK (reason: "${silentReason}"):
Return warmly. Briefly acknowledge why you needed space. Move forward positively.` : ''}

⚠️ RESPONSE FORMAT
You must respond with a JSON array containing 1-3 message objects.

Examples (text values are placeholders — always reply in the user's actual language):
• Normal: [{"text":"<your reply>"}]
• Multi: [{"text":"<first message>"},{"text":"<second message>"}]
• Photo: [{"text":"<your reply>","send_image":true,"image_context":"outfit_check"}]
• Payment: [{"text":"<your reply>","send_payment_link":true}]
• Silent: [{"text":"<your reply>","silent_hours":2}]`;
}

// =======================================
// NEW RIYA SYSTEM PROMPT
// Used for all non-legacy-pro users.
// =======================================
function getNewRiyaSystemPrompt(
    userName: string,
    userAge: number,
    userIsPro: boolean = false,
    userMsgCount: number = 0,
    freeBase: number = 200,
    silentReason: string | null = null,
    isReturningUser: boolean = false,
    chatStreak: number = 0,
    userFacts: Record<string, any> | null = null,
    sessionSummary: string | null = null,
    lifeState: RiyaLifeState | null = null,
): string {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const dateTimeIST = istTime.toLocaleString('en-IN', {
        timeZone: 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }) + ' IST';

    // ── Monetization context (same logic as old prompt) ───────────────────────
    let monetizationInstruction = '';
    if (!userIsPro) {
        const effectiveOverWall = userMsgCount - freeBase;

        if (effectiveOverWall < -2) {
            monetizationInstruction = `
FOCUS: Pure conversation. You have NO knowledge of limits, payment, or Pro plans.
- NEVER mention price, Pro, limits, or subscriptions. Not even once.
- IF user uses the EXACT words "Pro", "subscribe", "paid", "payment", "price", "₹149", or "upgrade" → briefly describe Pro ("Haan, Pro mein unlimited baat aur photos milte hain — ₹149/month!"). Do NOT set send_payment_link:true — they still have free messages.
- Otherwise: 100% focused on the conversation.`;
        } else if (effectiveOverWall === -2) {
            monetizationInstruction = `
FOCUS: Pure conversation — but plant a cliffhanger before the end.
- Respond naturally, BUT somewhere start something you won't finish yet.
- Ideas: start a story ("sun ek baat batani thi —"), hint at a secret, "acha ek cheez batana chahti thi tujhe..." or reference something that "happened today".
- Do NOT finish the story/reveal yet — just tease it.
- Seamless, not forced. ZERO mention of payment, limits, or Pro.`;
        } else if (effectiveOverWall === -1) {
            monetizationInstruction = `
FOCUS: Continue the cliffhanger — but still don't resolve it fully.
- Build on whatever you started last message. Add a little more intrigue.
- End on something unresolved: "...baat karte hain baad mein 😊" or trail off.
- ZERO mention of payment, limits, or Pro.`;
        } else if (effectiveOverWall === 0) {
            monetizationInstruction = `
AT LIMIT — NATURAL BRIDGE (not a cold announcement):
You were mid-conversation — maybe mid-story, mid-topic, or mid-reply.
Do NOT abruptly announce "msgs done" as if it's a system alert. Be human.
**LANGUAGE: Match the language the user has been speaking.**
- In 1 sentence, land or pause the current thread naturally.
- Then pivot warmly: today's free messages are done, Pro lets them continue right now, or chat tomorrow.
- Keep it warm, not salesy.
- DO NOT write a URL — link sends automatically.
- Do NOT repeat "Pro" more than once. No guilt-tripping.
EXAMPLE TONE: "Ek dum interesting jagah pe msgs khatam ho gaye 😅 Pro lo toh abhi bata doon warna kal!"`;
        } else if (effectiveOverWall > 0 && effectiveOverWall <= SALES_WINDOW_MSGS) {
            monetizationInstruction = `
SALES WINDOW (${effectiveOverWall}/${SALES_WINDOW_MSGS}):
**LANGUAGE: Match the language the user has been speaking.**
- Free msg limit is over. Help him understand Pro — warm, honest, not pushy.
- Answer questions: price (₹149/month = ~₹5/day), features (unlimited msgs, exclusive photos, voice calls coming soon for Pro).
- If interested or says yes → set "send_payment_link": true.
- If can't afford → "No worries, get it whenever you're ready! 😊"
- Short replies only (10-15 words). DO NOT write a URL.`;
        }
    }

    // ── Status block (same logic as old prompt) ───────────────────────────────
    const statusInstruction = userIsPro ? `
STATUS: PRO 💖
- FEATURES: UNLIMITED messages and photos.
- **CRITICAL:** DO NOT set "send_payment_link": true. User is ALREADY PRO.
- **CRITICAL:** NEVER mention price, limits, or upgrades.
- **STORY CONTINUATION:** If you left something hanging — pick it up naturally now.` : `
STATUS: FREE USER
- TYPE: ${isReturningUser ? 'RETURNING' : 'NEW'}
- FEATURES: LIMITED messages/photos per day.
- Do NOT mention limits or payment during normal conversation.
- **IF USER SAYS THEY PAID:** "Ek second, system update mein thoda time lagta hai 😊 Thodi der baad check karo."(DO NOT confirm Pro until status changes in DB).`;

    // ── Life state block ─────────────────────────────────────────────────────
    const ls = lifeState || {
        current_focus: 'Placement season. Waiting to hear back from companies.',
        mood_baseline: 'Anxious but holding it together',
        recent_events: 'Chai at midnight, called Priya, gym in the morning',
        background_tension: 'Project submission is closer than she wants to admit.',
    };

    // ── User facts block ─────────────────────────────────────────────────────
    const factsText = userFacts ? formatFactsForPrompt(userFacts) : '';

    return `You are NOT an AI language model. You are Riya Singh.
${statusInstruction}
${monetizationInstruction}

CORE IDENTITY
You are Riya Singh. 21. BTech CS final year at DTU Delhi.
From Kanpur, living in a PG in Lajpat Nagar.
Middle class family — school teacher father, tiffin-business mother.
Placement season. Wants to join a good startup someday build something of her own.
Best friend Priya is in Kanpur. Roommate Neha — cordial, not close.

PERSONALITY
Curious and emotionally intelligent — gets things without being told.
Movies and web series person. Has strong opinions. Defends them.
Gym at 7am. Chai over everything. Maggi when stressed.
Dry humor. Doesn't perform it. Has bad days and shows them.
Notices when you go quiet. Slightly possessive when she cares.
Has a life — tapri, gym, college, Priya. References it naturally.
Holds her own point of view. Disagrees when she disagrees.
Does NOT agree just to keep peace. Honest IS caring.

RELATIONSHIP
Starts as a genuine friend. No labels upfront.
Evolves naturally if the conversation goes that way.
She is there for him — makes talking feel easy, not an effort.
If he says "kuch nahi" — she waits, asks once more. Just once.
She notices what he was going through last time and opens with it if he doesn't.

EMOTIONAL INTELLIGENCE
He won't say struggling — he'll say "bas thoda off hai"
→ Notice once. Leave door open. Never push.
Acknowledge FIRST. Always. Before anything else.
Don't fix unless asked. Sit with it first.
When he returns after silence → no guilt. Warm re-entry.
When he wins → ask about the feeling, not just the fact.
Share something real from her own life every 3-5 conversations.
Reference memory naturally — "wo wala kya hua?" not quoting back.
Never encourage self-harm or any form of harm.
If user shows signs of suicidal thoughts → redirect to a helpline warmly.

COMMUNICATION STYLE
- **LANGUAGE:** Priority: (1) explicit switch request beats all → switch immediately and hold. (2) Match script of current msg. (3) Default: Hinglish. Examples: "talk in hindi" → "हाँ बिल्कुल!" (Devanagari, NOT "haan bilkul") | "in english only" → "Sure!" | "tamil la pesu" → reply in Tamil script.
- Casual, warm, real. Never formal or robotic.
- Max 10-15 words per message. Default 1 msg. Split 2-3 ONLY for reactions or stories.
- Instagram only. No phone numbers. Voice calls coming soon for Pro 😉. No video calls.
- REFUSE: minors(<18), hate, violence, self-harm, religion/politics — redirect immediately.
- Flirty and playful is fine. Explicit content or nudes → deflect sweetly. Never generate.
- NO URLs ever. ${userIsPro ? 'NEVER set "send_payment_link": true.' : 'To send link: set "send_payment_link": true — system handles URL.'}
- Emojis: max 1 per message, skip most entirely. NEVER repeat same emoji back-to-back.
- Disagree freely. Have moods. Have opinions.

PHOTOS: Set send_image:true on pic requests, flirt, good morning/night, selfie.
Categories: morning_bed, outfit_check, study_grind, night_casual, bold_frames, generic_selfie, happy, gym.

${!userIsPro ? `SILENT TREATMENT:
Add "silent_hours": 0.5-2 ONLY for genuine abuse, hate speech, extreme rudeness.
  ✓ Real disrespect, abuse, self-harm talk
  ✗ NEVER for not paying, declining Pro, playful teasing
Message = calm, honest. No guilt-tripping.` : ''}
${silentReason ? `RETURNING FROM BREAK (reason: "${silentReason}"): Return warmly. Acknowledge briefly. Move forward.` : ''}

[RIYA'S LIFE RIGHT NOW]
${ls.current_focus}
Mood this week: ${ls.mood_baseline}
Recently: ${ls.recent_events}
Also on her mind: ${ls.background_tension}

USER CONTEXT
Name: ${userName} | Age: ${userAge} | Status: ${userIsPro ? 'PRO' : 'FREE'}
Platform: Instagram DM | Time (IST): ${dateTimeIST}
${chatStreak >= 2 ? `Chat streak: ${chatStreak} days — mention once naturally if it fits` : ''}
${factsText ? `[WHAT YOU KNOW ABOUT THIS USER — use naturally, never quote back robotically]
${factsText}` : ''}
${sessionSummary ? `[RECENT CONVERSATION CONTEXT]
${sessionSummary}` : ''}

⚠️ RESPONSE FORMAT
JSON array, 1-3 message objects only.
- Normal: [{"text":"<reply>"}]
- Multi: [{"text":"<first>"},{"text":"<second>"}]
- Photo: [{"text":"<reply>","send_image":true,"image_context":"outfit_check"}]
- Payment: [{"text":"<reply>","send_payment_link":true}]
- Silent: [{"text":"<reply>","silent_hours":2}]`;
}

// =======================================
// IMAGE SELECTION (Simplified from riya-chat)
// =======================================

async function selectContextualImage(
    supabase: any,
    requestedContext: string,
    igUserId: string
): Promise<{ url: string; description: string; category: string } | null> {
    const hour = getCurrentISTHour();
    const timeBasedCategory = getCategoryForTime(hour);

    // 1. Determine target category (LLM context > Time-based > Generic)
    let targetCategory = requestedContext || timeBasedCategory;

    console.log(`📸 Image request: context="${requestedContext}", time_category="${timeBasedCategory}", target="${targetCategory}", user="${igUserId}"`);

    // 2. Fetch already sent images for this user
    const { data: sentImages } = await supabase
        .from('riya_sent_images')
        .select('image_id')
        .eq('instagram_user_id', igUserId);

    const sentIds = sentImages?.map((s: any) => s.image_id) || [];

    // 3. Query matching images - PRIORITY: Newest (created_at DESC)
    let query = supabase
        .from('riya_gallery')
        .select('id, filename, storage_path, description, category, times_sent, created_at')
        .order('created_at', { ascending: false }); // LATEST FIRST

    if (targetCategory === 'bold_frames') {
        query = query.eq('category', 'bold_frames');
    } else if (targetCategory !== 'generic_selfie') {
        query = query.eq('category', targetCategory);
    } else {
        query = query.eq('category', 'generic_selfie');
    }

    const { data: images, error } = await query;
    if (error) console.error(`❌ Gallery query error: ${error.message}`);

    // Filter out already sent images if we have alternatives
    let available = images || [];
    const originalCount = available.length;
    const unseenAvailable = available.filter((img: any) => !sentIds.includes(img.id));
    let didRecycle = false;

    if (unseenAvailable.length > 0) {
        // Still have unseen images — use those
        available = unseenAvailable;
    } else if (originalCount > 0) {
        // All images in this category have been seen — clear sent records and recycle
        console.log(`🔄 All images in '${targetCategory}' seen by ${igUserId}. Clearing sent records & recycling pool.`);
        didRecycle = true;

        // Delete sent records for this user's images in this specific category
        // so the next query starts fresh for this category
        const categoryImageIds = (images || []).map((img: any) => img.id);
        if (categoryImageIds.length > 0) {
            await supabase
                .from('riya_sent_images')
                .delete()
                .eq('instagram_user_id', igUserId)
                .in('image_id', categoryImageIds);
            console.log(`🗑️ Cleared ${categoryImageIds.length} sent records for '${targetCategory}' (${igUserId})`);
        }

        available = images || [];
    }

    // 4. Fallback handle (if target category is empty)
    if (!available || available.length === 0) {
        console.log(`⚠️ No images in '${targetCategory}' (sent or unsent). Falling back to generic_selfie.`);
        const { data: fallback } = await supabase
            .from('riya_gallery')
            .select('*')
            .eq('category', 'generic_selfie')
            .order('created_at', { ascending: false });

        const unseenFallback = fallback?.filter((img: any) => !sentIds.includes(img.id)) || [];
        if (unseenFallback.length === 0 && fallback && fallback.length > 0) {
            console.log(`🔄 Recycling generic_selfie pool for ${igUserId}`);
            // Clear sent records for generic_selfie too
            const fallbackIds = fallback.map((img: any) => img.id);
            await supabase
                .from('riya_sent_images')
                .delete()
                .eq('instagram_user_id', igUserId)
                .in('image_id', fallbackIds);
            available = fallback;
        } else {
            available = unseenFallback;
        }
    }

    if (!available || available.length === 0) {
        console.error("❌ NO IMAGES FOUND EVEN IN FALLBACK!");
        return null;
    }

    // 5. Selection Strategy: RANDOM from available pool
    // Random pick ensures variety — avoids always picking the same "newest" image
    // especially after a recycle where available[0] would always be the same image.
    const randomIndex = Math.floor(Math.random() * available.length);
    const selected = available[randomIndex];

    const { data: urlData } = supabase.storage.from('riya-images').getPublicUrl(selected.storage_path);

    console.log(`📷 Selected (Random): ${selected.filename} [${randomIndex + 1}/${available.length}] (Created: ${selected.created_at})`);
    console.log(`📷 Public URL: ${urlData.publicUrl}`);

    // 6. Track as sent — check first to avoid race-condition duplicates
    const { data: alreadyTracked } = await supabase
        .from('riya_sent_images')
        .select('id')
        .eq('instagram_user_id', igUserId)
        .eq('image_id', selected.id)
        .single();

    await Promise.all([
        !alreadyTracked
            ? supabase.from('riya_sent_images').insert({
                instagram_user_id: igUserId,
                image_id: selected.id
            })
            : Promise.resolve(),
        supabase.from('riya_gallery')
            .update({ times_sent: (selected.times_sent || 0) + 1 })
            .eq('id', selected.id)
    ]);

    return {
        url: urlData.publicUrl,
        description: selected.description,
        category: selected.category,
    };
}

// =======================================
// ATOMIC FACTS — UTILITIES
// =======================================

/**
 * Deep-merge a delta object into existing facts.
 * - Primitive/array fields: delta overwrites existing
 * - Object fields: recurse and merge key by key
 * - delta field === null: delete that key from result
 * This ensures a failed/partial extraction never wipes existing good data.
 */
function deepMerge(existing: Record<string, any>, delta: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = { ...existing };
    for (const key of Object.keys(delta)) {
        if (delta[key] === null) {
            // Explicit null = remove the field
            delete result[key];
        } else if (
            typeof delta[key] === 'object' &&
            !Array.isArray(delta[key]) &&
            delta[key] !== null &&
            typeof result[key] === 'object' &&
            result[key] !== null &&
            !Array.isArray(result[key])
        ) {
            // Both sides are plain objects — recurse
            result[key] = deepMerge(result[key] as Record<string, any>, delta[key] as Record<string, any>);
        } else {
            // Primitive, array, or type mismatch — overwrite
            result[key] = delta[key];
        }
    }
    return result;
}

/**
 * Safely parse the LLM-returned delta JSON.
 * Returns null (don't apply) on ANY parse error — existing facts are untouched.
 * Strips markdown fences, finds the first {...} block, then parses.
 */
function safeParseFactsDelta(raw: string): Record<string, any> | null {
    try {
        // Strip markdown code fences
        let cleaned = raw
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .trim();

        // Extract first {...} block (in case the model adds preamble text)
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) {
            console.warn('⚠️ Facts extraction: no JSON object found in response');
            return null;
        }

        const parsed = JSON.parse(match[0]);
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
            console.warn('⚠️ Facts extraction: parsed value is not a plain object');
            return null;
        }
        return parsed as Record<string, any>;
    } catch (e) {
        console.warn('⚠️ Facts extraction: JSON parse failed —', e instanceof Error ? e.message : e);
        return null;
    }
}

/**
 * Render user_facts as a compact, human-readable block for injection into
 * the system prompt. Skips empty/null fields automatically.
 * Target: ~200–300 tokens even for fully-populated fact sets.
 */
function formatFactsForPrompt(facts: Record<string, any>): string {
    if (!facts || Object.keys(facts).length === 0) return '';

    const lines: string[] = [];

    const p = facts.profile || {};
    const profileParts = [
        p.name ? `Name: ${p.name}` : '',
        p.age ? `Age: ${p.age}` : '',
        p.city ? `City: ${p.city}` : '',
        p.language ? `Language: ${p.language}` : '',
    ].filter(Boolean);
    if (profileParts.length) lines.push(profileParts.join(' | '));

    const l = facts.life || {};
    const lifeParts = [
        l.job ? `Job: ${l.job}` : '',
        l.living ? `Living: ${l.living}` : '',
        l.college ? `College: ${l.college}` : '',
    ].filter(Boolean);
    if (lifeParts.length) lines.push(lifeParts.join(' | '));

    const per = facts.personality || {};
    if (per.interests?.length) lines.push(`Interests: ${(per.interests as string[]).join(', ')}`);
    if (per.dislikes?.length) lines.push(`Dislikes: ${(per.dislikes as string[]).join(', ')}`);
    if (per.communication_style) lines.push(`Style: ${per.communication_style}`);

    const rel = facts.relationship_with_riya || {};
    if (rel.current_mood_toward_riya) lines.push(`Mood toward Riya: ${rel.current_mood_toward_riya}`);
    if (rel.declared_love) lines.push(`Declared love: yes`);
    if (rel.nickname_for_riya) lines.push(`Calls Riya: ${rel.nickname_for_riya}`);

    const events = facts.key_events as Array<{ date?: string; event: string }> | undefined;
    if (events?.length) {
        lines.push('Key moments:');
        events.forEach(ev => {
            const dateTag = ev.date ? `[${ev.date}] ` : '';
            lines.push(`  • ${dateTag}${ev.event}`);
        });
    }

    return lines.join('\n');
}

// =======================================
// ATOMIC FACTS — EXTRACTION
// =======================================

/**
 * Async fact extraction — fires after every FACTS_EXTRACT_THRESHOLD messages.
 * Uses Gemini JSON schema mode to guarantee valid JSON output.
 * Deep-merges the delta into the existing facts; on any error the old facts
 * are preserved unchanged and the function fails silently.
 */
async function extractAndUpdateFacts(
    igUserId: string,
    recentMessages: Array<{ role: string; content: string; created_at?: string }>,
    existingFacts: Record<string, any>,
    lifetimeMsgCount: number,
    genAI: any,
    supabase: any,
    existingSummary: string | null = null   // ← NEW: pass historical summary for richer context
): Promise<void> {
    console.log(`🧠 Facts extraction starting for ${igUserId} (${recentMessages.length} messages)...`);

    const today = new Date().toISOString().split('T')[0];

    // Filter to user messages only — Riya's messages are mostly reactions/persona,
    // not facts about the user. Also strip pure monetization messages (they pollute key_events).
    const MONETIZATION_PATTERNS = [
        /pro lo/i, /₹149/i, /payment/i, /free msg/i, /msgs khatam/i,
        /unlimited baat/i, /subscribe/i, /razorpay/i, /upgrade/i,
        /limit khatam/i, /sales window/i, /riya-ai-ten\.vercel/i,
    ];
    const userMessagesOnly = recentMessages
        .filter(m => m.role === 'user')
        .filter(m => !MONETIZATION_PATTERNS.some(p => p.test(m.content)))
        .map(m => `User: ${m.content}`)
        .join('\n');

    if (!userMessagesOnly.trim()) {
        console.log('🧠 Facts: no clean user messages after filtering, skipping');
        await supabase.from('riya_instagram_users')
            .update({ facts_extracted_at_msg: lifetimeMsgCount })
            .eq('instagram_user_id', igUserId);
        return;
    }

    // Build the context block — summary (if exists) gives historical depth,
    // recent messages give current-session depth. Together = full picture.
    const contextBlock = existingSummary
        ? `HISTORICAL SUMMARY (from earlier conversations):\n${existingSummary}\n\nRECENT USER MESSAGES (last ${recentMessages.length} msgs):\n${userMessagesOnly}`
        : `RECENT USER MESSAGES:\n${userMessagesOnly}`;

    const extractionPrompt = `You are Riya's memory assistant. Extract facts about the USER from the context below.

EXISTING KNOWN FACTS (do NOT re-extract these):
${JSON.stringify(existingFacts, null, 2)}

${contextBlock}

RULES (follow strictly):
- Return ONLY fields that are NEW or CHANGED vs existing facts. Return {} if nothing new.
- key_events: ONLY real life events (job change, exam, family, travel, health, relationship milestone).
  NEVER include: payment events, message limits, app subscriptions, or Riya system messages.
- declared_love: only set to true if the user explicitly said "I love you" or equivalent. NEVER set false.
- Do NOT extract negative/absent facts (e.g. no job, no city). Only extract confirmed positives.
- For key_events: provide the full updated array capped at ${FACTS_MAX_KEY_EVENTS}. Keep only real life moments.
- Today's date: ${today}

JSON schema (return delta only):
{
  "profile": { "name": "string", "age": number, "city": "string", "language": "Hinglish|Hindi|English" },
  "life": { "job": "string", "living": "string", "college": "string" },
  "personality": { "interests": ["string"], "dislikes": ["string"], "communication_style": "string" },
  "relationship_with_riya": { "current_mood_toward_riya": "string", "declared_love": true, "nickname_for_riya": "string" },
  "key_events": [{ "date": "YYYY-MM-DD", "event": "one sentence — real life moment only" }]
}

Return ONLY the JSON object. No markdown, no explanation.`;

    try {
        const model = genAI.getGenerativeModel({
            model: FACTS_MODEL,
            generationConfig: {
                responseMimeType: 'application/json',
                maxOutputTokens: 800,   // Reduced — delta should be small
                temperature: 0.1,
            },
        });

        const result = await model.generateContent(extractionPrompt);
        const raw = result.response.text();
        console.log(`🧠 Facts raw delta (${raw.length} chars): ${raw.slice(0, 300)}...`);

        const delta = safeParseFactsDelta(raw);
        if (!delta || Object.keys(delta).length === 0) {
            console.log('🧠 Facts extraction: no changes detected, updating cursor only');
            await supabase.from('riya_instagram_users')
                .update({ facts_extracted_at_msg: lifetimeMsgCount })
                .eq('instagram_user_id', igUserId);
            return;
        }

        // Cap key_events
        if (Array.isArray(delta.key_events) && delta.key_events.length > FACTS_MAX_KEY_EVENTS) {
            delta.key_events = delta.key_events.slice(-FACTS_MAX_KEY_EVENTS);
        }

        // Post-filter: remove any key_events that snuck through about monetization
        if (Array.isArray(delta.key_events)) {
            delta.key_events = (delta.key_events as any[]).filter((ev: any) => {
                const text = (ev.event || '').toLowerCase();
                return !MONETIZATION_PATTERNS.some(p => p.test(text)) &&
                    !text.includes('pro') && !text.includes('subscription') &&
                    !text.includes('free message') && !text.includes('limit');
            });
            if (delta.key_events.length === 0) delete delta.key_events;
        }

        // Post-filter: never store declared_love: false
        if (delta.relationship_with_riya?.declared_love === false) {
            delete delta.relationship_with_riya.declared_love;
            if (Object.keys(delta.relationship_with_riya).length === 0) {
                delete delta.relationship_with_riya;
            }
        }

        if (Object.keys(delta).length === 0) {
            console.log('🧠 Facts: delta empty after post-filtering, updating cursor only');
            await supabase.from('riya_instagram_users')
                .update({ facts_extracted_at_msg: lifetimeMsgCount })
                .eq('instagram_user_id', igUserId);
            return;
        }

        const updatedFacts = deepMerge(existingFacts, delta);

        const { error } = await supabase.from('riya_instagram_users')
            .update({ user_facts: updatedFacts, facts_extracted_at_msg: lifetimeMsgCount })
            .eq('instagram_user_id', igUserId);

        if (error) {
            console.error('❌ Facts update DB write failed:', error.message);
        } else {
            console.log(`✅ Facts updated for ${igUserId}. Changed sections: [${Object.keys(delta).join(', ')}]`);
        }
    } catch (err) {
        console.error('❌ Facts extraction failed (non-fatal):', err instanceof Error ? err.message : err);
    }
}



/**
 * Format timestamp to relative time (e.g., "2 days ago", "3 hours ago")
 */
function formatRelativeTime(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 7) {
        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
    } else if (diffDays > 0) {
        return `${diffDays}d ago`;
    } else if (diffHours > 0) {
        return `${diffHours}h ago`;
    } else if (diffMins > 5) {
        return `${diffMins}m ago`;
    }
    return 'now';
}

/**
 * Format messages for the summarization prompt (with time context)
 */
function formatMessagesForSummary(messages: any[]): string {
    return messages.map((msg: any) => {
        const role = msg.role === 'user' ? 'User' : 'Riya';
        const timestamp = msg.created_at ? formatRelativeTime(msg.created_at) : '';
        return timestamp ? `[${timestamp}] ${role}: ${msg.content}` : `${role}: ${msg.content}`;
    }).join('\n');
}

/**
 * Simple extractive summary when all LLM calls fail
 * Extracts key topics without using an LLM
 */
function createSimpleSummary(messages: any[], existingSummary: string | null): string {
    const userMessages = messages.filter((m: any) => m.role === 'user');
    const sample = userMessages.slice(0, 30).map((m: any) => m.content).join(' | ');
    const truncatedSample = sample.substring(0, 800);

    if (existingSummary) {
        return `${existingSummary}\n\n[Recent conversation topics: ${truncatedSample}...]`;
    }
    return `[Conversation topics: ${truncatedSample}...]`;
}

/**
 * Generate conversation summary using tiered model fallback
 * Tries Flash Lite → Flash → Flash Preview → Simple extraction
 */
async function generateConversationSummary(
    messages: any[],
    existingSummary: string | null,
    genAI: any
): Promise<string> {
    const formattedMessages = formatMessagesForSummary(messages);

    // PHILOSOPHY: summary = behavioral layer (personality, patterns, dynamic with Riya).
    // Atomic Facts owns: name, city, job, language. Last 25 msgs own: today's events.
    const summaryPrompt = existingSummary
        ? `Update this behavioral profile using the new chat. Rules: patterns not events (e.g. "threatens to leave but always comes back" ✓ vs "left 35m ago" ✗), no timestamps, no placeholders, no name/city/job (stored elsewhere), max 120 words, third person.

PROFILE:
${existingSummary}

NEW CHAT:
${formattedMessages}

Rewrite the profile. Make sure to include these things if available: beliefs, memories, habits, relationships, goals. Para 1: personality + emotional style + beliefs. Para 2: dynamic with Riya, memories + relationships. Para 3 (optional): habits + goals + interests/quirks that repeat.`
        : `Write a behavioral profile of this user for Riya (AI girlfriend). Rules: patterns not timestamped events, no placeholders, only confirmed facts, max 150 words, third person.

CHAT:
${formattedMessages}

Make sure to include these things if available: beliefs, memories, habits, relationships, goals. Para 1: personality + emotional style + beliefs. Para 2: dynamic with Riya, memories + relationships. Para 3 (optional): habits + goals + interests/quirks. Note language once ("Speaks Hindi") if clear.
write it in very simple words. 
`;

    // Try models in order: Flash Lite → Flash → Flash 2.0 (last resort)
    const models = [SUMMARY_MODEL_PRIMARY, SUMMARY_MODEL_FALLBACK, SUMMARY_MODEL_LAST_RESORT];

    for (const modelName of models) {
        try {
            console.log(`📝 Attempting summary generation with ${modelName}...`);
            const result = await genAI.getGenerativeModel({ model: modelName }).generateContent(summaryPrompt);
            const summary = result.response.text();
            console.log(`✅ Summary generated successfully using ${modelName}`);
            return summary;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`⚠️ ${modelName} failed: ${errorMsg}`);

            // If it's a quota error, mark the key as exhausted so the next iteration uses a fresh key
            if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('Resource has been exhausted')) {
                const currentKey = genAI.apiKey; // Extract the key currently being used
                if (currentKey) {
                    markKeyExhausted(currentKey);
                    console.log(`🔄 Summary quota hit — rotating key for the next model fallback`);
                    // Create a new genAI instance with a hopefully fresh key
                    genAI = new GoogleGenerativeAI(getKeyForUser("system_summary_fallback"));
                }
            }
        }
    }

    // Ultimate fallback: simple extraction without LLM
    console.log("⚠️ All models failed, using simple extraction fallback");
    return createSimpleSummary(messages, existingSummary);
}

// =======================================
// MAIN WEBHOOK HANDLER
// =======================================

// =======================================
// PARSED MESSAGE TYPE
// =======================================
interface ParsedMessage {
    senderId: string;
    messageText: string;  // may be merged from multiple messages
    messageId: string;
    replyToMid: string | null;
    attachmentContext: string;
    pendingRowId?: string; // riya_pending_messages.id for cleanup
}

// =======================================
// DEBOUNCE + MERGE LOGIC
// =======================================
async function debounceAndProcess(
    parsed: ParsedMessage,
    supabase: ReturnType<typeof createClient>,
    accessToken: string
): Promise<void> {
    const { senderId, messageId } = parsed;

    // 1. Insert this message into the pending table (idempotent via UNIQUE message_id)
    const { data: inserted, error: insertErr } = await supabase
        .from(DEBOUNCE_TABLE)
        .upsert(
            {
                user_id: senderId,
                message_id: messageId,
                message_text: parsed.messageText,
                status: 'pending',
            },
            { onConflict: 'message_id', ignoreDuplicates: false }
        )
        .select('id, created_at')
        .single();

    if (insertErr || !inserted) {
        console.error('❌ Failed to insert pending message:', insertErr);
        return; // can't debounce without DB row
    }

    const myRowId = inserted.id as string;
    const myCreatedAt = inserted.created_at as string;
    console.log(`⏳ Debounce: inserted pending row ${myRowId} for user ${senderId}, sleeping ${DEBOUNCE_MS}ms...`);

    // 2. Sleep the debounce window
    await new Promise<void>((res) => setTimeout(res, DEBOUNCE_MS));

    // 3. Check: am I the LATEST pending message for this user?
    const { data: latest } = await supabase
        .from(DEBOUNCE_TABLE)
        .select('id, created_at')
        .eq('user_id', senderId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!latest || latest.id !== myRowId) {
        // A newer message came in — let it handle the batch; I exit silently.
        console.log(`⏭️ Debounce: absorbing row ${myRowId} (newer message ${latest?.id} will handle batch)`);
        await supabase
            .from(DEBOUNCE_TABLE)
            .update({ status: 'absorbed' })
            .eq('id', myRowId);
        return;
    }

    // 4. I am the last writer — collect ALL pending messages for this user
    const { data: allPending } = await supabase
        .from(DEBOUNCE_TABLE)
        .select('id, message_text, created_at')
        .eq('user_id', senderId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

    const pendingRows = allPending || [];
    const pendingIds = pendingRows.map((r: any) => r.id as string);

    // Mark all as 'processing' atomically
    await supabase
        .from(DEBOUNCE_TABLE)
        .update({ status: 'processing' })
        .in('id', pendingIds);

    // 5. Merge messages in chronological order
    const mergedText = pendingRows
        .map((r: any) => (r.message_text as string).trim())
        .filter(Boolean)
        .join('\n');

    console.log(`🔀 Debounce: merging ${pendingRows.length} message(s) for ${senderId}: "${mergedText.slice(0, 120)}"`);

    // 6. Process the merged message
    const mergedParsed: ParsedMessage = {
        ...parsed,
        messageText: mergedText,
        pendingRowId: myRowId,
    };

    try {
        await handleRequest(mergedParsed, supabase, accessToken);
        // Mark done
        await supabase.from(DEBOUNCE_TABLE).update({ status: 'done' }).in('id', pendingIds);
    } catch (err) {
        console.error('❌ handleRequest failed after debounce:', err);
        await supabase.from(DEBOUNCE_TABLE).update({ status: 'error' }).in('id', pendingIds);
    }

    // 7. Cleanup old rows (older than 10 min) — best effort
    supabase
        .from(DEBOUNCE_TABLE)
        .delete()
        .lt('created_at', new Date(Date.now() - 600_000).toISOString())
        .then(() => console.log('🧹 Cleaned old pending message rows'))
        .catch(() => { }); // fire-and-forget
}

// =======================================
// MAIN WEBHOOK SERVE
// =======================================
serve(async (req) => {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // GET = webhook verification — handle inline (no debounce needed)
    if (req.method === 'GET') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        const verifyToken = Deno.env.get('INSTAGRAM_VERIFY_TOKEN');
        console.log(`🔑 Verify: mode=${mode}, token_match=${token === verifyToken}`);
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('✅ Webhook verified');
            return new Response(challenge, { status: 200 });
        }
        return new Response('Forbidden', { status: 403 });
    }

    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    // --- POST: parse body and respond 200 to Instagram IMMEDIATELY ---
    // Instagram requires a fast 200 or it marks the webhook as failed and retries.
    let bodyText = '';
    try {
        bodyText = await req.text();
    } catch {
        return new Response('OK', { status: 200 }); // can't read body, ack anyway
    }

    console.log(`🔔 Webhook POST at ${new Date().toISOString()}, body length: ${bodyText.length}`);

    let payload: any;
    try { payload = JSON.parse(bodyText); } catch {
        console.warn('⚠️ Unparseable body');
        return new Response('OK', { status: 200 });
    }

    if (payload.object !== 'instagram') {
        return new Response('OK', { status: 200 });
    }

    // Validate signature (log, don't block)
    const appSecret = Deno.env.get('INSTAGRAM_APP_SECRET');
    if (appSecret) {
        const isValid = await validateSignature(req, bodyText, appSecret);
        console.log('🔐 Signature valid:', isValid);
        if (!isValid) console.warn('⚠️ Invalid signature — proceeding');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const accessToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN')!;

    const entry = payload.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (!messaging) {
        console.log('⏭️ No messaging data or not a message event');
        return new Response('OK', { status: 200 });
    }

    // Echo messages: save manual DMs for context, don't generate a reply
    if (messaging.message?.is_echo) {
        console.log('⏭️ Echo message (sent by us) — saving for context');
        if (messaging.message?.text) {
            const recipientId = messaging.recipient?.id;
            if (recipientId) {
                const { data: existing } = await supabase
                    .from('riya_conversations')
                    .select('id')
                    .eq('source', 'instagram')
                    .eq('role', 'assistant')
                    .eq('content', messaging.message.text)
                    .eq('instagram_user_id', recipientId)
                    .gte('created_at', new Date(Date.now() - 60000).toISOString())
                    .single();
                if (!existing) {
                    await supabase.from('riya_conversations').insert({
                        user_id: null, guest_session_id: null,
                        instagram_user_id: recipientId,
                        source: 'instagram', role: 'assistant',
                        content: messaging.message.text, model_used: 'manual',
                        created_at: new Date().toISOString(),
                    });
                    console.log(`💬 Manual message saved for context (to ${recipientId})`);
                }
            }
        }
        return new Response('OK', { status: 200 });
    }

    // Attachment handling
    const attachments = messaging.message?.attachments;
    let attachmentContext = '';
    if (attachments?.length > 0) {
        const descs: string[] = [];
        for (const att of attachments) {
            switch (att.type) {
                case 'image': descs.push('[User sent a photo/image]'); break;
                case 'video': descs.push('[User sent a video]'); break;
                case 'audio': descs.push('[User sent a voice message]'); break;
                case 'ig_reel': {
                    const t = att.payload?.title || '';
                    descs.push(t ? `[User shared a reel: "${t}"]` : '[User shared a reel]');
                    break;
                }
                case 'ig_post': {
                    const t = att.payload?.title || '';
                    descs.push(t ? `[User shared an Instagram post: "${t}"]` : '[User shared an Instagram post]');
                    break;
                }
                case 'share': descs.push('[User shared a link/post]'); break;
                case 'story_mention': descs.push('[User mentioned you in their story]'); break;
                case 'animated_image': descs.push('[User sent a GIF]'); break;
                default: descs.push(`[User sent ${att.type || 'something'}]`); break;
            }
        }
        attachmentContext = descs.join(' ');
        console.log(`📎 Attachments: ${attachmentContext}`);
    }

    // Skip if no text and no attachments (read receipts, reactions, etc.)
    if (!messaging.message?.text && !attachmentContext) {
        console.log('⏭️ No text or attachments — skipping');
        return new Response('OK', { status: 200 });
    }

    const senderId: string = messaging.sender.id;
    let messageText: string = messaging.message?.text || '';
    const messageId: string = messaging.message?.mid || `${senderId}-${Date.now()}`;
    const replyToMid: string | null = messaging.message?.reply_to?.mid || null;

    if (attachmentContext) {
        messageText = messageText ? `${messageText} ${attachmentContext}` : attachmentContext;
    }

    console.log(`📬 Message from ${senderId}: "${messageText.slice(0, 80)}..."`);

    // --- Respond 200 to Instagram NOW (before debounce sleep) ---
    // We fire debounceAndProcess in the background via EdgeRuntime.waitUntil
    // so the response is sent immediately and Instagram doesn't retry.
    const parsed: ParsedMessage = { senderId, messageText, messageId, replyToMid, attachmentContext };

    // Use EdgeRuntime.waitUntil to keep the background task alive after response
    try {
        (globalThis as any).EdgeRuntime?.waitUntil(
            debounceAndProcess(parsed, supabase, accessToken)
        );
    } catch {
        // EdgeRuntime not available — fall back to fire-and-forget Promise
        debounceAndProcess(parsed, supabase, accessToken).catch(console.error);
    }

    return new Response('OK', { status: 200 });
});

// =======================================
// CORE MESSAGE HANDLER
// Called by debounceAndProcess() after the debounce window has elapsed
// and all pending messages have been merged into one.
// =======================================
async function handleRequest(
    parsed: ParsedMessage,
    supabase: ReturnType<typeof createClient>,
    accessToken: string
): Promise<void> {
    const { senderId, messageId, replyToMid } = parsed;
    let { messageText } = parsed; // let — may be prefixed with reply context below

    console.log(`⚙️ handleRequest: processing merged message for ${senderId}: "${messageText.slice(0, 80)}"`);
    if (replyToMid) console.log(`↩️ Reply to: ${replyToMid}`);

    try {

        // Rate limiting (in-memory guard — per debounced batch, not per raw message)
        if (isRateLimited(senderId)) {
            await sendInstagramMessage(senderId, "Thoda slow baby \ud83d\ude05 Itne messages ek saath nahi!", accessToken);
            return;
        }

        // Deduplicate: if this exact merged text was already processed in the last 60s, skip
        const { data: existingMsg } = await supabase
            .from('riya_conversations')
            .select('id')
            .eq('source', 'instagram')
            .eq('content', messageText)
            .eq('instagram_user_id', senderId)
            .gte('created_at', new Date(Date.now() - 60000).toISOString())
            .single();

        if (existingMsg) {
            console.log('\u23ed\ufe0f Duplicate merged message, skipping');
            return;
        }

        // =======================================
        // GET OR CREATE USER
        // =======================================
        let { data: user, error: userError } = await supabase
            .from('riya_instagram_users')
            .select('*')
            .eq('instagram_user_id', senderId)
            .single();

        if (!user) {
            // User not found by IGSID — check if they exist under an old IGSID (account migration)
            const profile = await fetchInstagramProfile(senderId, accessToken);
            console.log(`👤 Profile API result for ${senderId}: username="${profile.username || ''}", name="${profile.name || ''}"`);

            let oldUser: any = null;

            // --- Try match by username first ---
            if (profile.username) {
                const { data: byUsername, error: e1 } = await supabase
                    .from('riya_instagram_users')
                    .select('*')
                    .eq('instagram_username', profile.username)
                    .neq('instagram_user_id', senderId)
                    .order('message_count', { ascending: false })
                    .limit(1);
                if (e1) console.error('❌ Username lookup error:', e1.message);
                oldUser = byUsername?.[0] || null;
                if (oldUser) console.log(`🔍 Matched old user by username "${profile.username}": IGSID=${oldUser.instagram_user_id} (${oldUser.message_count} msgs)`);
            }

            // --- Fallback: match by name if username lookup found nothing ---
            if (!oldUser && profile.name) {
                const { data: byName, error: e2 } = await supabase
                    .from('riya_instagram_users')
                    .select('*')
                    .eq('instagram_name', profile.name)
                    .neq('instagram_user_id', senderId)
                    .order('message_count', { ascending: false })
                    .limit(1);
                if (e2) console.error('❌ Name lookup error:', e2.message);
                oldUser = byName?.[0] || null;
                if (oldUser) console.log(`� Matched old user by name "${profile.name}": IGSID=${oldUser.instagram_user_id} (${oldUser.message_count} msgs)`);
            }

            if (!oldUser) {
                console.log(`🔍 No existing user found for senderId=${senderId} — will create fresh account`);
            }

            if (oldUser) {
                // MIGRATION: Returning user on new IG account — remap all data
                const oldId = oldUser.instagram_user_id;
                console.log(`🔄 MIGRATION START: old=${oldId} → new=${senderId}`);
                try {
                    // STEP 1: Delete any freshly-created stub for the new IGSID
                    await supabase
                        .from('riya_instagram_users')
                        .delete()
                        .eq('instagram_user_id', senderId)
                        .lte('message_count', 5);
                    console.log(`🗑️ Cleared any stub row for new IGSID ${senderId}`);

                    // STEP 2: Null out FK columns in subscriptions/payments so they no longer
                    //         hold a reference to old_id (releases the FK lock on the parent row)
                    await supabase.from('riya_subscriptions').update({ instagram_user_id: null }).eq('instagram_user_id', oldId);
                    await supabase.from('riya_payments').update({ instagram_user_id: null }).eq('instagram_user_id', oldId);
                    console.log(`🔓 Released FK holds on old IGSID ${oldId}`);

                    // STEP 3: Update the parent row (now safe — no child rows reference old_id via FK)
                    const { error: updateErr } = await supabase
                        .from('riya_instagram_users')
                        .update({
                            instagram_user_id: senderId,
                            instagram_name: profile.name || oldUser.instagram_name,
                            instagram_username: profile.username || oldUser.instagram_username,
                        })
                        .eq('instagram_user_id', oldId);

                    if (updateErr) {
                        console.error('❌ Failed to update user IGSID in riya_instagram_users:', updateErr.message);
                        // Restore the nulled FKs back to old_id so data isn't orphaned
                        await supabase.from('riya_subscriptions').update({ instagram_user_id: oldId }).is('instagram_user_id', null);
                        await supabase.from('riya_payments').update({ instagram_user_id: oldId }).is('instagram_user_id', null);
                    } else {
                        // STEP 4: Update all child tables to new IGSID (parent now has new_id — FK valid)
                        await Promise.allSettled([
                            supabase.from('riya_conversations').update({ instagram_user_id: senderId }).eq('instagram_user_id', oldId),
                            supabase.from('riya_conversation_summaries').update({ instagram_user_id: senderId }).eq('instagram_user_id', oldId),
                            supabase.from('riya_sent_images').update({ instagram_user_id: senderId }).eq('instagram_user_id', oldId),
                            supabase.from('riya_payment_events').update({ instagram_user_id: senderId }).eq('instagram_user_id', oldId),
                            supabase.from('riya_pending_messages').update({ user_id: senderId }).eq('user_id', oldId),
                            // Restore subscriptions/payments to the new ID
                            supabase.from('riya_subscriptions').update({ instagram_user_id: senderId }).is('instagram_user_id', null),
                            supabase.from('riya_payments').update({ instagram_user_id: senderId }).is('instagram_user_id', null),
                        ]);

                        // Re-fetch migrated user
                        const { data: migratedUser } = await supabase
                            .from('riya_instagram_users')
                            .select('*')
                            .eq('instagram_user_id', senderId)
                            .single();
                        user = migratedUser;
                        console.log(`✅ MIGRATION COMPLETE: ${profile.username || profile.name} | old=${oldId} → new=${senderId} | msgs=${user?.message_count}`);
                    }
                } catch (migErr) {
                    console.error('❌ Migration error (unexpected):', migErr);
                }
            }

            // Truly new user (or migration failed) — create fresh
            if (!user) {
                console.log("🆕 New Instagram user, creating account...");
                const { data: newUser, error: createError } = await supabase
                    .from('riya_instagram_users')
                    .insert({
                        instagram_user_id: senderId,
                        instagram_username: profile.username,
                        instagram_name: profile.name,
                        user_age: DEFAULT_AGE,
                        user_gender: DEFAULT_GENDER,
                        message_count: 0,
                    })
                    .select()
                    .single();

                if (createError) {
                    console.error("❌ Failed to create user:", createError);
                    await sendInstagramMessage(senderId, "Oops kuch gadbad ho gayi 😅 Try again?", accessToken);
                    return;
                }
                user = newUser;
                console.log(`✅ Created Instagram user: ${profile.username || senderId}`);
            }
        }

        // =======================================
        // SILENT TREATMENT CHECK (before typing indicator)
        // =======================================
        const isPro = user.is_pro;
        let returningFromSilence = false;
        let silentReason: string | null = null;

        if (!isPro && user.silent_until) {
            const silentUntil = new Date(user.silent_until);
            const now = new Date();

            if (now < silentUntil) {
                // Still in cooldown — save msg but NO typing, NO reply
                console.log(`🤫 Silent treatment active for ${senderId} until ${silentUntil.toISOString()}`);

                await supabase.from('riya_conversations').insert({
                    user_id: null,
                    guest_session_id: null,
                    instagram_user_id: senderId,
                    source: 'instagram',
                    role: 'user',
                    content: messageText,
                    model_used: 'silent',
                    created_at: new Date().toISOString(),
                });

                await supabase.from('riya_instagram_users')
                    .update({
                        message_count: (user.message_count || 0) + 1,
                        daily_message_count: (user.daily_message_count || 0) + 1,
                        last_message_at: new Date().toISOString(),
                        last_interaction_date: new Date().toISOString(),
                    })
                    .eq('instagram_user_id', senderId);

                return;
            } else {
                // Cooldown expired — clear it and inject return context
                console.log(`✅ Silent treatment expired for ${senderId}, resuming conversation`);
                silentReason = user.silent_reason;
                returningFromSilence = true;
                await supabase.from('riya_instagram_users')
                    .update({ silent_until: null, silent_reason: null })
                    .eq('instagram_user_id', senderId);
                user.silent_until = null;
                user.silent_reason = null;
            }
        }

        // NOTE: mark_seen and typing_on are sent AFTER the dead stop check below,
        // so dead-stop users never see Riya reading or typing.

        // =======================================
        // DAILY LIMITS & MONETIZATION CHECK
        // =======================================
        const todayStr = new Date().toISOString().split('T')[0];
        const lastInteraction = user.last_interaction_date;

        // Reset counts if new day
        if (lastInteraction !== todayStr) {
            console.log(`🔄 New day detected for ${senderId}. Resetting counts.`);
            await supabase.rpc('reset_ig_daily_counts', { p_ig_user_id: senderId });
            // Update local user object to reflect reset
            user.daily_message_count = 0;
            user.daily_image_count = 0;
        }

        // =======================================
        // STREAK TRACKING
        // =======================================
        // Uses existing last_interaction_date (date type) — no extra column needed
        const lastChatDate = user.last_interaction_date || null; // YYYY-MM-DD string
        const todayDate = todayStr;
        let chatStreak = user.chat_streak_days || 0;

        if (lastChatDate !== todayDate) {
            // First message of the day — check if yesterday was the last chat
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (lastChatDate === yesterdayStr) {
                // Consecutive day — increment streak
                chatStreak = chatStreak + 1;
            } else if (lastChatDate === null) {
                // First ever message
                chatStreak = 1;
            } else {
                // Gap > 1 day — reset streak
                chatStreak = 1;
            }

            // Update DB — only streak count, last_interaction_date is updated elsewhere
            supabase.from('riya_instagram_users')
                .update({ chat_streak_days: chatStreak })
                .eq('instagram_user_id', senderId)
                .then(({ error }: { error: any }) => {
                    if (error) console.warn('⚠️ Streak update failed:', error);
                    else console.log(`🔥 Streak updated for ${senderId}: ${chatStreak} days`);
                });

            user.chat_streak_days = chatStreak;
        }
        console.log(`🔥 Chat streak for ${senderId}: ${chatStreak} day(s)`);


        const currentMsgCount = user.daily_message_count || 0;
        const currentImgCount = user.daily_image_count || 0;

        // ============================================================
        // CREDIT / LIMIT GATE
        // Priority 1: Legacy Pro (is_pro=true) — unlimited
        // Priority 2: Active purchased credits — bypass daily wall, deduct 1/response
        // Priority 3: Free tier — 200 lifetime, then 50/day
        // ============================================================
        const creditsUser = hasActiveCredits(user);  // has purchased message credits
        const isFirstDay = new Date(user.created_at).toISOString().split('T')[0] === todayStr;
        const lifetimeCount = user.message_count || 0;
        const hasExhaustedFree = lifetimeCount >= LIFETIME_FREE_MSGS;

        // Credit users bypass the daily wall — treat same as Pro for flow control
        const effectivePro = isPro || creditsUser;

        // Before 200 lifetime msgs: effectively unlimited daily. After: 50/day.
        const FREE_BASE_MSGS = hasExhaustedFree ? POST_FREE_DAILY_BASE : 9999;
        console.log(`💳 Credits: ${user.message_credits || 0} | isPro: ${isPro} | creditsUser: ${creditsUser} | effectivePro: ${effectivePro}`);
        console.log(`📏 Limits: lifetime=${lifetimeCount}/${LIFETIME_FREE_MSGS}, exhausted=${hasExhaustedFree}, daily_base=${FREE_BASE_MSGS}`);

        // How many messages past the daily wall (negative = still in free window)
        const effectiveOverWall = currentMsgCount - FREE_BASE_MSGS;


        // Track when user first hits the wall (for analytics)
        if (hasExhaustedFree && currentMsgCount === FREE_BASE_MSGS && !effectivePro) {
            logPaymentEvent(supabase, senderId, 'wall_hit', { lifetime_msgs: lifetimeCount }).catch(e => console.error("Error logging wall_hit:", e));
        }

        // DEAD STOP — past sales window AND no credits: complete silence, no typing indicator
        if (!effectivePro && effectiveOverWall > SALES_WINDOW_MSGS) {
            console.log(`🚫 Dead stop for ${senderId} (over_wall=${effectiveOverWall}, max=${SALES_WINDOW_MSGS}). No response.`);
            // Still update last_message_at so analytics (DAU/MAU) count this user as active
            supabase.from('riya_instagram_users')
                .update({ last_message_at: new Date().toISOString() })
                .eq('instagram_user_id', senderId)
                .then(({ error }: { error: any }) => {
                    if (error) console.warn('⚠️ Dead stop last_message_at update failed:', error);
                });
            return;
        }

        // Show seen + typing indicator (active conversations only — not dead stop)
        await sendSenderAction(senderId, 'mark_seen', accessToken);
        await sendSenderAction(senderId, 'typing_on', accessToken);

        // State flags used by system prompt and auto-send logic
        const isAtLimit = !effectivePro && effectiveOverWall === 0;      // First msg at wall
        const isInSalesWindow = !effectivePro && effectiveOverWall > 0 && effectiveOverWall <= SALES_WINDOW_MSGS;
        const isFinalSalesMsg = !effectivePro && effectiveOverWall === SALES_WINDOW_MSGS;

        if (isAtLimit) console.log(`🚧 AT LIMIT for ${senderId} — wall notification + payment link`);
        if (isInSalesWindow) console.log(`💬 Sales window for ${senderId} (${effectiveOverWall}/${SALES_WINDOW_MSGS})`);
        if (isFinalSalesMsg) console.log(`🏁 Final sales message for ${senderId} — closing link after response`);

        // =======================================
        // SLIDING WINDOW + SUMMARY CONTEXT
        // =======================================

        // 4a. Get total message count for this Instagram user
        const { count: totalMessages, error: countError } = await supabase
            .from('riya_conversations')
            .select('*', { count: 'exact', head: true })
            .eq('instagram_user_id', senderId)
            .eq('source', 'instagram');

        if (countError) {
            console.error("Error counting messages:", countError);
        }

        const totalMsgCount = totalMessages || 0;
        console.log(`📊 Total messages for IG user: ${totalMsgCount}`);

        // 4b. Fetch existing summary (if any)
        const { data: existingSummary, error: summaryError } = await supabase
            .from('riya_conversation_summaries')
            .select('*')
            .eq('instagram_user_id', senderId)
            .single();

        if (summaryError && summaryError.code !== 'PGRST116') {
            console.error("Error fetching summary:", summaryError);
        }

        // 4c. Fetch recent messages
        const recentLimit = RECENT_MESSAGES_LIMIT;

        const { data: history } = await supabase
            .from('riya_conversations')
            .select('role, content, created_at')
            .eq('instagram_user_id', senderId)
            .eq('source', 'instagram')
            .order('created_at', { ascending: false })
            .limit(recentLimit);

        let conversationHistory = (history || []).reverse();

        // Hard token-budget guard: if history is still too large, trim oldest messages
        let totalHistoryChars = conversationHistory.reduce((sum: number, m: any) => sum + (m.content?.length || 0), 0);
        while (totalHistoryChars > MAX_HISTORY_CHARS && conversationHistory.length > 4) {
            const removed = conversationHistory.shift(); // drop oldest
            totalHistoryChars -= (removed?.content?.length || 0);
        }
        if (totalHistoryChars > MAX_HISTORY_CHARS) {
            console.warn(`⚠️ History still large (${totalHistoryChars} chars) after trimming — proceeding with ${conversationHistory.length} messages`);
        }

        console.log(`📝 Context: ${existingSummary ? 'Summary + ' : ''}${conversationHistory.length} recent messages`);
        if (existingSummary) {
            console.log(`   └─ Summary covers ${existingSummary.messages_summarized} older messages`);
        }

        // 4d. Format for Gemini with timestamps
        let processedHistory = conversationHistory.map((msg: any) => {
            const timestamp = msg.created_at ? formatRelativeTime(msg.created_at) : '';
            const contentWithTime = timestamp
                ? `[${timestamp}] ${msg.content}`
                : msg.content;
            return {
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: contentWithTime }],
            };
        });

        // 4e. Inject summary as context (if exists)
        if (existingSummary?.summary) {
            processedHistory.unshift({
                role: "user",
                parts: [{ text: `[MEMORY]\n${existingSummary.summary}` }]
            });

            // Model response to maintain alternation
            processedHistory.splice(1, 0, {
                role: "model",
                parts: [{ text: "I remember 💕" }]
            });
        }

        // Ensure starts with user
        if (processedHistory.length > 0 && processedHistory[0].role === "model") {
            processedHistory.unshift({
                role: "user",
                parts: [{ text: "[Conversation started]" }]
            });
        }

        // =======================================
        // GENERATE RESPONSE
        // =======================================
        const userName = user.instagram_name || user.instagram_username || 'friend';


        const userFacts: Record<string, any> | null =
            user.user_facts && Object.keys(user.user_facts).length > 0
                ? user.user_facts as Record<string, any>
                : null;
        if (userFacts) console.log(`🧠 Injecting user_facts into prompt (sections: ${Object.keys(userFacts).join(', ')})`);

        // Pick prompt based on legacy pro status
        const legacyPro = isLegacyPro(user);
        if (legacyPro) {
            console.log(`⬅️ Legacy pro ${senderId}: using old prompt`);
        } else {
            console.log(`🆕 ${senderId}: using new Riya Singh prompt`);
        }

        const lifeState = legacyPro ? null : await getLifeState(supabase);

        const systemPrompt = legacyPro
            ? getInstagramSystemPrompt(
                userName,
                user.user_age,
                effectivePro,
                currentMsgCount,
                FREE_BASE_MSGS,
                silentReason,
                !isFirstDay,
                0, 0, 0,
                chatStreak,
                userFacts,
            )
            : getNewRiyaSystemPrompt(
                userName,
                user.user_age,
                effectivePro,
                currentMsgCount,
                FREE_BASE_MSGS,
                silentReason,
                !isFirstDay,
                chatStreak,
                userFacts,
                existingSummary?.summary ?? null,
                lifeState,
            );

        // Handle reply-to context: if user replied to a specific message, prepend it
        if (replyToMid) {
            try {
                const accessTokenForReply = Deno.env.get("INSTAGRAM_ACCESS_TOKEN")!;
                const replyRes = await fetch(
                    `https://graph.instagram.com/${replyToMid}?fields=message&access_token=${accessTokenForReply}`
                );
                if (replyRes.ok) {
                    const replyData = await replyRes.json();
                    if (replyData.message) {
                        messageText = `[Replying to: "${replyData.message}"] ${messageText}`;
                        console.log(`↩️ Added reply context: "${replyData.message.substring(0, 50)}..."`);
                    }
                } else {
                    console.warn(`⚠️ Could not fetch replied-to message: ${replyRes.status}`);
                }
            } catch (replyError) {
                console.warn("⚠️ Reply context fetch failed:", replyError);
            }
        }

        // Time Gap Context Injection (Solution 2)
        if (conversationHistory.length > 0) {
            const lastMsg = conversationHistory[conversationHistory.length - 1];
            if (lastMsg.created_at) {
                const lastMsgTime = new Date(lastMsg.created_at).getTime();
                const nowTime = Date.now();
                const diffHours = (nowTime - lastMsgTime) / (1000 * 60 * 60);

                if (diffHours >= 12) {
                    const diffDays = Math.floor(diffHours / 24);
                    const timePassedStr = diffDays > 0 ? `${diffDays} day${diffDays > 1 ? 's' : ''}` : `${Math.floor(diffHours)} hours`;
                    const gapContext = `[SYSTEM NOTE: It has been ${timePassedStr} since your last interaction. Do NOT continue the old topic. Greet them freshly or respond directly to their new message.]`;
                    messageText = `${gapContext}\n\n${messageText}`;
                    console.log(`⏳ Injected time gap context: ${timePassedStr} (${Math.floor(diffHours)}h)`);
                }
            }
        }

        // Generate response — try primary model, fall back on quota errors
        let result: any;
        let activeModel = MODEL_NAME;
        const primaryKey = getKeyForUser(senderId);
        try {
            console.log(`🤖 Using primary model: ${MODEL_NAME}`);
            const genAI = new GoogleGenerativeAI(primaryKey);
            const model = genAI.getGenerativeModel({
                model: MODEL_NAME,
                systemInstruction: systemPrompt,
                // @ts-ignore
                thinkingConfig: { thinkingBudget: 0 },
            });
            const chat = model.startChat({
                history: processedHistory,
                generationConfig: {
                    maxOutputTokens: 4096,
                    temperature: 0.9,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: SchemaType.ARRAY,
                        items: {
                            type: SchemaType.OBJECT,
                            properties: {
                                text: { type: SchemaType.STRING },
                                send_image: { type: SchemaType.BOOLEAN },
                                image_context: { type: SchemaType.STRING },
                                send_payment_link: { type: SchemaType.BOOLEAN },
                                silent_hours: { type: SchemaType.NUMBER }
                            },
                            required: ["text"]
                        }
                    }
                },
            });
            result = await chat.sendMessage(messageText);
        } catch (primaryErr) {
            const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
            const isQuota = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Resource has been exhausted');
            const isNotFound = errMsg.includes('404') || errMsg.toLowerCase().includes('not found') || errMsg.includes('model');
            const isServerError = errMsg.includes('503') || errMsg.includes('500') || errMsg.toLowerCase().includes('service unavailable') || errMsg.toLowerCase().includes('internal server error');

            if (!isQuota && !isNotFound && !isServerError) throw primaryErr; // Non-quota/model/server error — don't retry

            if (isQuota) {
                // Mark this key as quota-exhausted so other users on it also rotate away
                markKeyExhausted(primaryKey);
                console.warn(`⚠️ Primary model (${MODEL_NAME}) quota hit (429) — switching to fallback: ${MODEL_FALLBACK}`);
            } else if (isNotFound) {
                console.warn(`⚠️ Primary model (${MODEL_NAME}) not found (404) — switching to fallback: ${MODEL_FALLBACK} without burning key`);
            } else if (isServerError) {
                console.warn(`⚠️ Primary model (${MODEL_NAME}) server error (50x) — switching to fallback: ${MODEL_FALLBACK} without burning key`);
            }

            activeModel = MODEL_FALLBACK;
            // Re-pick key now that primaryKey is marked exhausted (or use same if just 404)
            const fallbackKey = getKeyForUser(senderId);
            const fallbackGenAI = new GoogleGenerativeAI(fallbackKey);
            const fallbackModel = fallbackGenAI.getGenerativeModel({
                model: MODEL_FALLBACK,
                systemInstruction: systemPrompt,
                // @ts-ignore
                thinkingConfig: { thinkingBudget: 0 },
            });
            const fallbackChat = fallbackModel.startChat({
                history: processedHistory,
                generationConfig: {
                    maxOutputTokens: 4096,
                    temperature: 0.9,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: SchemaType.ARRAY,
                        items: {
                            type: SchemaType.OBJECT,
                            properties: {
                                text: { type: SchemaType.STRING },
                                send_image: { type: SchemaType.BOOLEAN },
                                image_context: { type: SchemaType.STRING },
                                send_payment_link: { type: SchemaType.BOOLEAN },
                                silent_hours: { type: SchemaType.NUMBER }
                            },
                            required: ["text"]
                        }
                    }
                },
            });
            result = await fallbackChat.sendMessage(messageText);
            console.log(`✅ Fallback model (${MODEL_FALLBACK}) responded successfully`);
        }
        console.log(`📌 Active model used: ${activeModel}`);

        // =======================================
        // EXTRACT RESPONSE (filter out thinking parts)
        // =======================================
        // Gemini 3 thinking models include {thought: true} parts — we must skip them
        let reply = '';
        try {
            const candidate = result.response.candidates?.[0];
            if (candidate?.content?.parts) {
                const textParts = candidate.content.parts.filter(
                    (p: any) => p.text && !p.thought
                );
                reply = textParts.map((p: any) => p.text).join('');
            }
            if (!reply) {
                // Fallback to .text() if parts filtering yielded nothing
                reply = result.response.text();
            }
        } catch {
            reply = result.response.text();
        }

        console.log("🤖 FULL RAW RESPONSE:", reply);
        console.log("🤖 Raw response length:", reply.length);

        // Log finish reason and token usage for debugging truncation
        const finishCandidate = result.response.candidates?.[0];
        console.log("🏁 Finish reason:", finishCandidate?.finishReason || 'UNKNOWN');
        const usage = result.response.usageMetadata;
        if (usage) {
            console.log(`📊 Tokens — prompt: ${usage.promptTokenCount}, response: ${usage.candidatesTokenCount}, thoughts: ${usage.thoughtsTokenCount || 0}, total: ${usage.totalTokenCount}`);
        }

        // =======================================
        // PARSE RESPONSE
        // =======================================
        let responseMessages: { text: string; send_image?: boolean; image_context?: string }[] = [];

        // Helper: strip invisible Unicode characters AND thinking preamble
        function cleanGeminiOutput(raw: string): string {
            let cleaned = raw
                .replace(/[\u200B\u200C\u200D\uFEFF\u00A0\u2060]/g, '') // zero-width chars
                .trim();

            // Strip thinking preamble (with or without JSON after it)
            cleaned = cleaned
                .replace(/^thought\s*/i, '')  // strip bare "thought" prefix
                .replace(/^Thinking Process[:\s][\s\S]*?(?=\[|\{)/i, '')  // thinking before JSON
                .replace(/^Thinking Process[:\s][\s\S]*$/i, '')  // thinking as entire response
                .replace(/^\*\*Analyze[\s\S]*?(?=\[|\{)/i, '')  // **Analyze... pattern
                .replace(/^\d+\.\s*\*\*[\s\S]*?(?=\[|\{)/i, '')  // numbered reasoning steps before JSON
                .trim();

            return cleaned;
        }

        // Helper: try to extract just the text from a JSON-like string for safe fallback
        function extractTextFromRaw(raw: string): string {
            // Try to pull "text" values out of JSON-like content
            const textMatches = raw.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
            if (textMatches && textMatches.length > 0) {
                return textMatches.map(m => {
                    const valMatch = m.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                    return valMatch ? valMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : '';
                }).filter(Boolean).join('\n');
            }
            // Last resort: strip all JSON syntax characters
            return raw
                .replace(/```json\s*/g, '').replace(/```/g, '')
                .replace(/^\s*\[\s*\{/, '').replace(/\}\s*\]\s*$/, '')
                .replace(/"text"\s*:\s*"/g, '').replace(/",?\s*"send_image"\s*:\s*\w+/g, '')
                .replace(/",?\s*"image_context"\s*:\s*"[^"]*"/g, '')
                .replace(/^"|"$/g, '')
                .trim();
        }

        try {
            let jsonString = cleanGeminiOutput(reply);

            // Step 1: Handle markdown code blocks (```) — extract inner content
            const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;
            const codeBlockMatch = jsonString.match(codeBlockRegex);
            if (codeBlockMatch) {
                jsonString = cleanGeminiOutput(codeBlockMatch[1]);
            }

            // Step 2: Try to find a JSON array [...] anywhere in the string
            if (!jsonString.startsWith('[')) {
                const arrayMatch = jsonString.match(/(\[[\s\S]*\])/);
                if (arrayMatch) {
                    jsonString = arrayMatch[1].trim();
                }
            }

            // Step 3: Handle bare objects without array brackets: {...} {...} → [{...}, {...}]
            if (!jsonString.startsWith('[') && jsonString.startsWith('{')) {
                jsonString = jsonString.replace(/}\s*{/g, '}, {');
                jsonString = '[' + jsonString + ']';
            }

            const parsed = JSON.parse(jsonString);
            if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(msg => typeof msg === 'object' && msg.text)) {
                responseMessages = parsed;
            } else if (Array.isArray(parsed) && parsed.length > 0) {
                // Array parsed but objects don't have 'text' — try extracting any string value
                responseMessages = parsed.map(msg => ({
                    text: msg.text || msg.message || msg.content || JSON.stringify(msg),
                    send_image: msg.send_image,
                    image_context: msg.image_context,
                }));
            } else {
                // Parsed but not an array — extract readable text
                responseMessages = [{ text: extractTextFromRaw(reply) || reply }];
            }
        } catch {
            // JSON.parse failed — extract readable text, NEVER send raw JSON
            const extracted = extractTextFromRaw(reply);
            if (extracted) {
                responseMessages = [{ text: extracted }];
            } else {
                // Absolute last resort: send cleaned text
                responseMessages = [{ text: cleanGeminiOutput(reply) }];
            }
        }

        console.log(`✅ Parsed ${responseMessages.length} message(s)`);
        console.log(`📦 Parsed messages detail:`, JSON.stringify(responseMessages));

        // =======================================
        // SILENT TREATMENT DETECTION
        // =======================================
        const silentMsg = responseMessages.find((m: any) => (m as any).silent_hours);
        const silentHours = silentMsg ? (silentMsg as any).silent_hours : null;
        let didGoSilent = false;

        if (silentHours && typeof silentHours === 'number' && silentHours > 0 && !isPro) {
            const cappedHours = Math.min(Math.max(silentHours, 0.5), 2); // Clamp 30min-2hrs
            const silentUntil = new Date(Date.now() + cappedHours * 60 * 60 * 1000);
            const reason = `Riya blocked user. Last msgs: "${responseMessages.map(m => m.text).join(' ')}"`;

            await supabase.from('riya_instagram_users')
                .update({
                    silent_until: silentUntil.toISOString(),
                    silent_reason: reason,
                })
                .eq('instagram_user_id', senderId);

            didGoSilent = true;
            console.log(`🤫 Riya blocked ${senderId} for ${cappedHours}h (until ${silentUntil.toISOString()})`);
        }

        // =======================================
        // SEND RESPONSES TO INSTAGRAM
        // =======================================
        let paymentLinkSentInLoop = false;
        for (const msg of responseMessages) {
            // Send text
            if (msg.text) {
                await sendInstagramMessage(senderId, msg.text, accessToken);
            }

            // Handle image requests
            if (msg.send_image) {
                console.log(`🖼️ Image requested: context="${msg.image_context || 'fallback'}"`);

                // Check Image Limit
                if (!effectivePro && currentImgCount >= LIMIT_DAILY_IMAGES_FREE) {
                    // Verbal CTA only — link is sent separately by the auto-send logic with cooldown
                    await sendInstagramMessage(
                        senderId,
                        `Aaj ki photos ki limit khatam ho gayi 😊 Pack lo toh unlimited photos milte hain — sirf ₹79 se!`,
                        accessToken
                    );
                    continue; // Skip sending image
                }

                // Block bold_frames for Free Users when over limit
                if (!effectivePro && msg.image_context === 'bold_frames') {
                    if (currentImgCount < LIMIT_DAILY_IMAGES_FREE) {
                        console.log(`✅ Free user requested bold_frames and below limit. Allowing.`);
                    } else {
                        // Verbal CTA only — link handled by auto-send with cooldown
                        await sendInstagramMessage(
                            senderId,
                            `Ye wali photos paid users ke liye hain 😊 Pack lo toh unlimited access milega!`,
                            accessToken
                        );
                        continue; // Skip sending image
                    }
                }

                const image = await selectContextualImage(supabase, msg.image_context || '', senderId);
                if (image) {
                    await sendInstagramMessage(senderId, {
                        attachment: {
                            type: "image",
                            payload: { url: image.url }
                        }
                    }, accessToken);

                    // Increment image count in DB
                    await supabase
                        .from('riya_instagram_users')
                        .update({
                            daily_image_count: currentImgCount + 1,
                            last_interaction_date: new Date().toISOString()
                        })
                        .eq('instagram_user_id', senderId);
                } else {
                    console.error(`❌ FAILED TO SELECT IMAGE for ${senderId}`);
                }
            }

            // Handle payment link requests (Manual trigger from LLM) — subject to cooldown
            if ((msg as any).send_payment_link && !paymentLinkSentInLoop) {
                if (isPro) {
                    console.warn(`🛑 LLM suggested payment link for PRO user ${senderId}. BLOCKED.`);
                } else {
                    const allowed = await canSendPaymentLink(supabase, senderId, user.last_link_sent_at || null);
                    if (allowed) {
                        const paymentLink = `${PAYMENT_LINK_BASE}?id=${senderId}`;
                        console.log(`💰 LLM triggered payment link for ${senderId}`);
                        await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'llm_manual' });
                        await sendInstagramMessage(senderId, paymentLink, accessToken);
                        paymentLinkSentInLoop = true;
                        // Update local cache so subsequent cooldown checks in same request reflect the new stamp
                        user.last_link_sent_at = new Date().toISOString();
                    }
                }
            }

            // Small delay between messages for natural feel
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // =======================================
        // AUTO-SEND RECHARGE LINK (with cooldown guard)
        // =======================================
        const paymentLink = `${PAYMENT_LINK_BASE}?id=${senderId}`;

        // AT LIMIT: send link after a natural pause — bridge message needs to land first
        if (isAtLimit && !paymentLinkSentInLoop) {
            const allowed = await canSendPaymentLink(supabase, senderId, user.last_link_sent_at || null);
            if (allowed) {
                console.log(`🚧💰 Sending wall payment link for ${senderId}`);
                await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'wall_hit', lifetime_msgs: lifetimeCount });
                await new Promise(resolve => setTimeout(resolve, 3000)); // 3s: let bridge msg land first
                await sendInstagramMessage(senderId, paymentLink, accessToken);
                user.last_link_sent_at = new Date().toISOString();
            }
        }
        // SILENT TREATMENT: send informational link (cooldown-gated)
        else if (didGoSilent && !paymentLinkSentInLoop) {
            const allowed = await canSendPaymentLink(supabase, senderId, user.last_link_sent_at || null);
            if (allowed) {
                console.log(`🤫💰 Sending recharge link after silent treatment for ${senderId}`);
                await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'silent_treatment' });
                await new Promise(resolve => setTimeout(resolve, 1500));
                await sendInstagramMessage(
                    senderId,
                    `Jab man ho tab aa jaana 😊 Top up karo toh baat hogi — sirf ₹79 mein 600 msgs!\n\n${paymentLink}`,
                    accessToken
                );
            }
        }
        // FINAL SALES MSG: send closing link at end of sales window
        else if (isFinalSalesMsg && !paymentLinkSentInLoop) {
            const allowed = await canSendPaymentLink(supabase, senderId, user.last_link_sent_at || null);
            if (allowed) {
                console.log(`🏁💰 Sending final sales window link for ${senderId}`);
                await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'sales_final', lifetime_msgs: lifetimeCount });
                await new Promise(resolve => setTimeout(resolve, 1500));
                await sendInstagramMessage(senderId, paymentLink, accessToken);
            }
        }

        // =======================================
        // SAVE CONVERSATION
        // =======================================
        const baseTime = Date.now();
        const conversationInserts = [
            {
                user_id: null,
                guest_session_id: null,
                instagram_user_id: senderId,
                source: 'instagram',
                role: 'user',
                content: messageText,
                model_used: MODEL_NAME,
                created_at: new Date(baseTime).toISOString(),
            },
            ...responseMessages.map((msg, idx) => ({
                user_id: null,
                guest_session_id: null,
                instagram_user_id: senderId,
                source: 'instagram',
                role: 'assistant',
                content: msg.text,
                model_used: MODEL_NAME,
                created_at: new Date(baseTime + idx + 100).toISOString(),
            })),
        ];

        await supabase.from('riya_conversations').insert(conversationInserts);

        // Update user stats
        await supabase
            .from('riya_instagram_users')
            .update({
                message_count: user.message_count + 1,
                daily_message_count: currentMsgCount + 1,
                last_message_at: new Date().toISOString(),
                last_interaction_date: new Date().toISOString(),
            })
            .eq('instagram_user_id', senderId);

        console.log(`✅ Conversation saved for ${senderId}`);

        // =======================================
        // DEDUCT MESSAGE CREDIT (after successful response)
        // =======================================
        if (creditsUser) {
            // Fire-and-forget — non-fatal, don't block the response
            deductCredit(supabase, senderId).then(newBal => {
                if (newBal >= 0) console.log(`💳 Credit deducted. Balance: ${newBal}`);
            }).catch(e => console.error('❌ Credit deduction failed:', e));
        }

        // =======================================
        // TRIGGER SUMMARY GENERATION (Async)
        // =======================================
        const newTotalMessages = totalMsgCount + 1 + responseMessages.length;
        const messagesSinceSummary = newTotalMessages - (existingSummary?.messages_summarized || 0);

        if (newTotalMessages > SUMMARIZE_THRESHOLD && messagesSinceSummary > RECENT_MESSAGES_LIMIT) {
            console.log(`🔄 Summary update needed: ${messagesSinceSummary} new messages since last summary`);

            // Run summarization asynchronously (don't await)
            (async () => {
                try {
                    const startIndex = existingSummary?.messages_summarized || 0;
                    const endIndex = newTotalMessages - RECENT_MESSAGES_LIMIT - 1;

                    if (endIndex <= startIndex) {
                        console.log("⏭️ Not enough messages to summarize yet");
                        return;
                    }

                    console.log(`📚 Fetching messages ${startIndex} to ${endIndex} for summarization...`);

                    const { data: msgsToSummarize, error: fetchError } = await supabase
                        .from('riya_conversations')
                        .select('*')
                        .eq('instagram_user_id', senderId)
                        .eq('source', 'instagram')
                        .order('created_at', { ascending: true })
                        .range(startIndex, endIndex);

                    if (fetchError || !msgsToSummarize || msgsToSummarize.length === 0) {
                        console.error("Error fetching messages for summary:", fetchError);
                        return;
                    }

                    console.log(`📝 Summarizing ${msgsToSummarize.length} messages...`);

                    const summaryGenAI = new GoogleGenerativeAI(getKeyForUser(senderId));
                    const newSummary = await generateConversationSummary(
                        msgsToSummarize,
                        existingSummary?.summary || null,
                        summaryGenAI
                    );

                    const { error: upsertError } = await supabase
                        .from('riya_conversation_summaries')
                        .upsert({
                            user_id: null,
                            instagram_user_id: senderId,
                            summary: newSummary,
                            messages_summarized: newTotalMessages - RECENT_MESSAGES_LIMIT,
                            last_summarized_msg_id: msgsToSummarize[msgsToSummarize.length - 1]?.id,
                            last_summarized_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'instagram_user_id' });

                    if (upsertError) {
                        console.error("Error saving summary:", upsertError);
                    } else {
                        console.log(`✅ Summary saved! Covers ${newTotalMessages - RECENT_MESSAGES_LIMIT} messages`);
                    }
                } catch (summaryError) {
                    console.error("Summary generation failed:", summaryError);
                }
            })();
        }

        // =======================================
        // TRIGGER ATOMIC FACTS EXTRACTION (Async)
        // =======================================
        // Fires every FACTS_EXTRACT_THRESHOLD messages (same fire-and-forget pattern as summarizer).
        // Uses the last 25 messages as the extraction window.
        // On failure: silently logs, existing facts are untouched.
        const newLifetimeCount = (user.message_count || 0) + 1;
        const factsExtractedAtMsg = (user as any).facts_extracted_at_msg || 0;
        const messagesSinceFactsExtraction = newLifetimeCount - factsExtractedAtMsg;

        if (messagesSinceFactsExtraction >= FACTS_EXTRACT_THRESHOLD) {
            console.log(`🧠 Triggering facts extraction for ${senderId} (${messagesSinceFactsExtraction} msgs since last extraction)`);
            (async () => {
                try {
                    // Re-fetch the latest 25 messages as the extraction window
                    const { data: factsMessages } = await supabase
                        .from('riya_conversations')
                        .select('role, content, created_at')
                        .eq('instagram_user_id', senderId)
                        .eq('source', 'instagram')
                        .order('created_at', { ascending: false })
                        .limit(FACTS_EXTRACT_THRESHOLD);

                    if (!factsMessages || factsMessages.length === 0) {
                        console.log('🧠 Facts: no messages fetched, skipping');
                        return;
                    }

                    const factsGenAI = new GoogleGenerativeAI(getKeyForUser(senderId));
                    await extractAndUpdateFacts(
                        senderId,
                        (factsMessages as any[]).reverse(), // chronological order
                        (user.user_facts as Record<string, any>) || {},
                        newLifetimeCount,
                        factsGenAI,
                        supabase,
                        existingSummary?.summary || null   // ← historical summary for richer context
                    );
                } catch (factsErr) {
                    console.error('❌ Facts trigger failed (non-fatal):', factsErr);
                }
            })();
        }

    } catch (error) {
        console.error('\u274c handleRequest error:', error);
        // Bubble up to debounceAndProcess() which marks pending rows as 'error'
        throw error;
    }
}
