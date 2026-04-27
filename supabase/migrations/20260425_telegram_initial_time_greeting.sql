-- Track whether a Telegram user already received the one-time
-- deterministic first-turn time greeting.

ALTER TABLE public.telegram_users
    ADD COLUMN IF NOT EXISTS initial_time_greeting_sent BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.telegram_users tu
SET initial_time_greeting_sent = TRUE
WHERE EXISTS (
    SELECT 1
    FROM public.riya_conversations rc
    WHERE rc.telegram_user_id = tu.telegram_user_id
      AND rc.source = 'telegram'
);
