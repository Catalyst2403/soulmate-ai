-- ============================================================
-- Telegram Bot: Full Schema
-- Created: 2026-04-09
-- Adds telegram_users, telegram_pending_messages,
-- telegram_conversation_summaries, telegram_sent_images,
-- and extends riya_conversations with telegram_user_id.
-- ============================================================

-- ── 1. telegram_users ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_users (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Telegram identity (from update payload)
    telegram_user_id        TEXT        UNIQUE NOT NULL,
    telegram_username       TEXT,
    first_name              TEXT,
    language_code           TEXT,               -- e.g. 'en', 'hi'

    -- Onboarding state
    is_verified             BOOLEAN     NOT NULL DEFAULT FALSE,   -- completed full onboarding
    is_underage             BOOLEAN     NOT NULL DEFAULT FALSE,   -- said No to age check → permanent ban

    -- Usage tracking (mirrors riya_instagram_users)
    message_count           INTEGER     NOT NULL DEFAULT 0,
    daily_message_count     INTEGER     NOT NULL DEFAULT 0,
    last_interaction_date   DATE,
    last_message_at         TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Memory
    user_facts              JSONB       NOT NULL DEFAULT '{}',
    facts_extracted_at_msg  INTEGER     NOT NULL DEFAULT 0,

    -- Engagement
    chat_streak_days        INTEGER     NOT NULL DEFAULT 0,
    preferred_language      TEXT,

    -- Silent treatment
    silent_until            TIMESTAMPTZ,
    silent_reason           TEXT,

    -- Proactive signals (mirrors insta columns, no sender cron for now)
    user_wants_no_proactive BOOLEAN     NOT NULL DEFAULT FALSE,
    proactive_skip_until    TIMESTAMPTZ,
    proactive_scheduled_context TEXT,

    -- Voice stats
    total_voice_notes_sent  INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_telegram_user_id
    ON public.telegram_users (telegram_user_id);

COMMENT ON TABLE public.telegram_users IS
    'User accounts for Telegram Riya bot. One row per Telegram user. Created on first message.';

-- ── 2. Extend riya_conversations with telegram_user_id ────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'riya_conversations' AND column_name = 'telegram_user_id'
    ) THEN
        ALTER TABLE public.riya_conversations ADD COLUMN telegram_user_id TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_riya_conv_telegram_user
    ON public.riya_conversations (telegram_user_id)
    WHERE telegram_user_id IS NOT NULL;

-- ── 3. telegram_pending_messages (debounce) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_pending_messages (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT        NOT NULL,                       -- telegram_user_id
    message_id   TEXT        UNIQUE,                         -- Telegram message_id (prevents retries)
    message_text TEXT        NOT NULL DEFAULT '',
    status       TEXT        NOT NULL DEFAULT 'pending',     -- pending|absorbed|processing|done|error
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_pending_user_created
    ON public.telegram_pending_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tg_pending_status
    ON public.telegram_pending_messages (status, created_at DESC);

ALTER TABLE public.telegram_pending_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tg_pending_service_role_all" ON public.telegram_pending_messages
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.telegram_pending_messages IS
    'Debounce table for Telegram webhook — batches rapid successive messages into one AI call.';

-- ── 4. telegram_conversation_summaries ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_conversation_summaries (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id         TEXT        UNIQUE NOT NULL,
    summary                  TEXT        NOT NULL,
    messages_summarized      INTEGER     NOT NULL DEFAULT 0,
    last_summarized_msg_id   UUID,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_summaries_user
    ON public.telegram_conversation_summaries (telegram_user_id);

COMMENT ON TABLE public.telegram_conversation_summaries IS
    'Rolling conversation summaries for Telegram users. Upserted every ~25 new messages.';

-- ── 5. telegram_sent_images (tracks which gallery images were shown to each user) ──
CREATE TABLE IF NOT EXISTS public.telegram_sent_images (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id TEXT        NOT NULL,
    image_id         UUID        NOT NULL REFERENCES public.riya_gallery(id) ON DELETE CASCADE,
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_sent_images_user
    ON public.telegram_sent_images (telegram_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_sent_images_user_image
    ON public.telegram_sent_images (telegram_user_id, image_id);

COMMENT ON TABLE public.telegram_sent_images IS
    'Tracks gallery images already sent to each Telegram user to avoid repeats.';

-- ── 6. Daily reset RPC for Telegram ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reset_telegram_daily_counts(p_tg_user_id TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.telegram_users
    SET
        daily_message_count   = 0,
        last_interaction_date = CURRENT_DATE
    WHERE telegram_user_id = p_tg_user_id;
END;
$$ LANGUAGE plpgsql;
