-- ============================================================
-- Telegram: Proactive sender tracking columns
-- Date: 2026-05-04
-- Adds last_proactive_sent_at + user_active_hour_ist to telegram_users
-- so a scheduled Edge Function can safely nudge users without spamming.
-- ============================================================

ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS last_proactive_sent_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS user_active_hour_ist   SMALLINT    DEFAULT NULL;

COMMENT ON COLUMN public.telegram_users.last_proactive_sent_at IS
  'When Riya last proactively messaged this Telegram user. Used for per-user cooldown and no-repeat-until-reply.';

COMMENT ON COLUMN public.telegram_users.user_active_hour_ist IS
  'IST hour (0–23) when this user typically first messages each day. Used to avoid wrong-time proactive messaging.';

CREATE INDEX IF NOT EXISTS idx_telegram_users_last_proactive_sent_at
  ON public.telegram_users (last_proactive_sent_at);

