-- ============================================================
-- MIGRATION: Telegram Monetization — Credit System
-- Date: 2026-04-10
-- Extends telegram_users with credit columns,
-- adds telegram_user_id to riya_payments,
-- and creates Telegram-specific RPCs mirroring Instagram ones.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Add credit + free-trial columns to telegram_users
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS message_credits          INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_valid_until       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_credits_purchased   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_messages_used        INTEGER     NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.telegram_users.message_credits         IS 'Remaining purchased message credits. Deducted by 1 per Gemini response.';
COMMENT ON COLUMN public.telegram_users.credits_valid_until     IS 'Credits are usable as long as balance > 0; validity is informational/analytics only.';
COMMENT ON COLUMN public.telegram_users.total_credits_purchased IS 'Lifetime total credits purchased — for analytics.';
COMMENT ON COLUMN public.telegram_users.free_messages_used      IS 'Lifetime count of messages sent during free trial (0–100). Once >= 100, free-tier daily cap applies.';

-- ────────────────────────────────────────────────────────────
-- 2. Add telegram_user_id to riya_payments
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_payments
  ADD COLUMN IF NOT EXISTS telegram_user_id TEXT;

COMMENT ON COLUMN public.riya_payments.telegram_user_id IS 'Set for payments made by Telegram users. Mutually exclusive with user_id / instagram_user_id.';

-- ────────────────────────────────────────────────────────────
-- 3. Make riya_payment_events.instagram_user_id nullable
--    so Telegram events can be inserted without it.
--    Telegram analytics are tracked via metadata.telegram_user_id instead.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_payment_events
  ALTER COLUMN instagram_user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_riya_payments_telegram
    ON public.riya_payments (telegram_user_id)
    WHERE telegram_user_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 4. RPC: deduct_telegram_message_credit
--    Called after each successful Gemini reply for paid users.
--    Returns the new balance, or -1 if no credits remain.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_telegram_message_credit(p_tg_user_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance INTEGER;
  v_new_bal INTEGER;
BEGIN
  SELECT message_credits INTO v_balance
  FROM public.telegram_users
  WHERE telegram_user_id = p_tg_user_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance <= 0 THEN
    RETURN -1;
  END IF;

  v_new_bal := v_balance - 1;

  UPDATE public.telegram_users
  SET message_credits = v_new_bal
  WHERE telegram_user_id = p_tg_user_id;

  RETURN v_new_bal;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. RPC: add_telegram_message_credits
--    Called by verify-razorpay-payment on successful purchase.
--    Credits accumulate (rollover). Validity extended from MAX(now, current_expiry).
--    Returns new balance.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_telegram_message_credits(
  p_tg_user_id    TEXT,
  p_pack_id       INTEGER,
  p_credits       INTEGER,
  p_validity_days INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_bal    INTEGER;
  v_new_bal        INTEGER;
  v_current_expiry TIMESTAMPTZ;
  v_new_expiry     TIMESTAMPTZ;
BEGIN
  SELECT message_credits, credits_valid_until
  INTO v_current_bal, v_current_expiry
  FROM public.telegram_users
  WHERE telegram_user_id = p_tg_user_id
  FOR UPDATE;

  v_new_bal    := COALESCE(v_current_bal, 0) + p_credits;
  v_new_expiry := GREATEST(now(), COALESCE(v_current_expiry, now())) + (p_validity_days || ' days')::INTERVAL;

  UPDATE public.telegram_users
  SET
    message_credits         = v_new_bal,
    credits_valid_until     = v_new_expiry,
    total_credits_purchased = COALESCE(total_credits_purchased, 0) + p_credits
  WHERE telegram_user_id = p_tg_user_id;

  RETURN v_new_bal;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. RPC: increment_telegram_free_usage
--    Called after each message sent by free-trial or free-tier users.
--    Increments free_messages_used (lifetime) and daily_message_count.
--    Resets daily_message_count if last_interaction_date < today (IST).
--    Returns current free_messages_used after increment.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_telegram_free_usage(p_tg_user_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today             DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_last_date         DATE;
  v_daily_count       INTEGER;
  v_free_used         INTEGER;
  v_new_free_used     INTEGER;
  v_new_daily         INTEGER;
BEGIN
  SELECT last_interaction_date, daily_message_count, free_messages_used
  INTO v_last_date, v_daily_count, v_free_used
  FROM public.telegram_users
  WHERE telegram_user_id = p_tg_user_id
  FOR UPDATE;

  -- Reset daily count if new day (IST)
  IF v_last_date IS NULL OR v_last_date < v_today THEN
    v_new_daily := 1;
  ELSE
    v_new_daily := COALESCE(v_daily_count, 0) + 1;
  END IF;

  v_new_free_used := COALESCE(v_free_used, 0) + 1;

  UPDATE public.telegram_users
  SET
    free_messages_used      = v_new_free_used,
    daily_message_count     = v_new_daily,
    last_interaction_date   = v_today
  WHERE telegram_user_id = p_tg_user_id;

  RETURN v_new_free_used;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. RPC: get_telegram_user_plan
--    Returns the user's current plan status for the webhook.
--    plan: 'trial' | 'free' | 'paid'
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_telegram_user_plan(p_tg_user_id TEXT)
RETURNS TABLE (
  plan              TEXT,
  credits_remaining INTEGER,
  daily_remaining   INTEGER,
  free_messages_used INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today             DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_credits           INTEGER;
  v_credits_until     TIMESTAMPTZ;
  v_total_purchased   INTEGER;
  v_free_used         INTEGER;
  v_daily_count       INTEGER;
  v_last_date         DATE;
  v_daily_remaining   INTEGER;
  v_plan              TEXT;
BEGIN
  SELECT
    message_credits,
    credits_valid_until,
    total_credits_purchased,
    free_messages_used,
    daily_message_count,
    last_interaction_date
  INTO
    v_credits, v_credits_until, v_total_purchased,
    v_free_used, v_daily_count, v_last_date
  FROM public.telegram_users
  WHERE telegram_user_id = p_tg_user_id;

  -- Default if user not found yet
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'trial'::TEXT, 0, 30, 0;
    RETURN;
  END IF;

  -- Determine plan
  IF COALESCE(v_free_used, 0) < 100 THEN
    v_plan := 'trial';
  ELSIF COALESCE(v_credits, 0) > 0 THEN
    v_plan := 'paid';
  ELSE
    v_plan := 'free';
  END IF;

  -- Daily remaining for free tier
  IF v_last_date IS NULL OR v_last_date < v_today THEN
    v_daily_remaining := 30;
  ELSE
    v_daily_remaining := GREATEST(0, 30 - COALESCE(v_daily_count, 0));
  END IF;

  RETURN QUERY SELECT
    v_plan,
    COALESCE(v_credits, 0),
    v_daily_remaining,
    COALESCE(v_free_used, 0);
END;
$$;
