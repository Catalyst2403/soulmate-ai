-- ============================================================
-- MIGRATION: Telegram Plan Limits — Simplified monetization
-- Date: 2026-04-12
-- - Trial boundary uses message_count (total msgs sent), not free_messages_used
-- - No voice/photo feature gating — daily limit is the only cutoff
-- - Values set high (800/600) for testing; revert to 100/30 for production
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_telegram_user_plan(p_tg_user_id TEXT)
RETURNS TABLE (
  plan              TEXT,
  credits_remaining INTEGER,
  daily_remaining   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- ⚠️ Keep in sync with FREE_TRIAL_LIMIT / FREE_DAILY_LIMIT in telegram-webhook/index.ts
  v_trial_limit   CONSTANT INTEGER := 800;  -- set to 100 for production
  v_daily_limit   CONSTANT INTEGER := 600;  -- set to 30 for production

  v_today         DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_credits       INTEGER;
  v_msg_count     INTEGER;
  v_daily_count   INTEGER;
  v_last_date     DATE;
  v_daily_remaining INTEGER;
  v_plan          TEXT;
BEGIN
  SELECT
    message_credits,
    message_count,
    daily_message_count,
    last_interaction_date
  INTO
    v_credits, v_msg_count, v_daily_count, v_last_date
  FROM public.telegram_users
  WHERE telegram_user_id = p_tg_user_id;

  -- Default if user not found yet
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'trial'::TEXT, 0, v_daily_limit;
    RETURN;
  END IF;

  -- Determine plan based on total message_count
  IF COALESCE(v_msg_count, 0) < v_trial_limit THEN
    v_plan := 'trial';
  ELSIF COALESCE(v_credits, 0) > 0 THEN
    v_plan := 'paid';
  ELSE
    v_plan := 'free';
  END IF;

  -- Daily remaining (only enforced for free tier, but always computed)
  IF v_last_date IS NULL OR v_last_date < v_today THEN
    v_daily_remaining := v_daily_limit;
  ELSE
    v_daily_remaining := GREATEST(0, v_daily_limit - COALESCE(v_daily_count, 0));
  END IF;

  RETURN QUERY SELECT
    v_plan,
    COALESCE(v_credits, 0),
    v_daily_remaining;
END;
$$;
