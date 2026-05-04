-- ============================================================
-- Telegram: track users who blocked the bot
-- Date: 2026-05-04
-- Prevents proactive sender from repeatedly attempting 403-blocked chats.
-- ============================================================

ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS bot_blocked    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bot_blocked_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.telegram_users.bot_blocked IS
  'True when Telegram Bot API returns 403 Forbidden: bot was blocked by the user.';

COMMENT ON COLUMN public.telegram_users.bot_blocked_at IS
  'UTC timestamp when bot_blocked was first detected.';

CREATE INDEX IF NOT EXISTS idx_telegram_users_bot_blocked
  ON public.telegram_users (bot_blocked);

