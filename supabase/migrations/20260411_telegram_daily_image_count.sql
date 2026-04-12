-- ============================================================
-- MIGRATION: Add daily_image_count to telegram_users
-- Date: 2026-04-11
-- Mirrors the daily_image_count column on riya_instagram_users.
-- Also updates reset_telegram_daily_counts to reset this column.
-- ============================================================

-- 1. Add daily_image_count column
ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS daily_image_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.telegram_users.daily_image_count IS
  'Number of images sent to this user today. Reset daily by reset_telegram_daily_counts. Mirrors riya_instagram_users.daily_image_count.';

-- 2. Update reset_telegram_daily_counts RPC to also reset daily_image_count
CREATE OR REPLACE FUNCTION public.reset_telegram_daily_counts(p_tg_user_id TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE public.telegram_users
    SET
        daily_message_count   = 0,
        daily_image_count     = 0,
        last_interaction_date = CURRENT_DATE
    WHERE telegram_user_id = p_tg_user_id;
END;
$$ LANGUAGE plpgsql;
