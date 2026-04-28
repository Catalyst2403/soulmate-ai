-- Add per-user Telegram age for prompt personalization.
-- Existing users before Apr 28 IST keep the old prompt behavior (21).
-- Users created after Apr 27 IST, and all new users, default to 35.

ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS user_age INTEGER;

UPDATE public.telegram_users
SET user_age = CASE
  WHEN created_at >= TIMESTAMPTZ '2026-04-28 00:00:00+05:30' THEN 35
  ELSE 21
END
WHERE user_age IS NULL;

ALTER TABLE public.telegram_users
  ALTER COLUMN user_age SET DEFAULT 35,
  ALTER COLUMN user_age SET NOT NULL;

COMMENT ON COLUMN public.telegram_users.user_age IS
  'User actual/default age used for Telegram Riya prompt personalization.';
