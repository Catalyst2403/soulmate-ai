-- ============================================================
-- MIGRATION: Recharge / Credit-Based Pricing System
-- Date: 2026-03-15
-- Replaces: is_pro (unlimited) flat model
-- New model: message credits purchased in packs, deducted per message
-- Legacy Pro users (is_pro=true) are unaffected — credits system layered on top
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Add credit columns to riya_instagram_users
-- ────────────────────────────────────────────────────────────
ALTER TABLE riya_instagram_users
  ADD COLUMN IF NOT EXISTS message_credits         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_valid_until      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_credits_purchased  INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN riya_instagram_users.message_credits        IS 'Remaining purchased message credits. Deducted by 1 per Gemini response.';
COMMENT ON COLUMN riya_instagram_users.credits_valid_until    IS 'Credits are still usable past this date (credits never hard-expire, but new packs extend validity window).';
COMMENT ON COLUMN riya_instagram_users.total_credits_purchased IS 'Lifetime total credits purchased — for analytics.';

-- ────────────────────────────────────────────────────────────
-- 2. Recharge pack catalog
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riya_recharge_packs (
  id               SERIAL PRIMARY KEY,
  pack_name        TEXT    NOT NULL UNIQUE,   -- 'basic' | 'romantic' | 'soulmate'
  display_name     TEXT    NOT NULL,          -- shown on recharge page
  price_inr        INTEGER NOT NULL,          -- 79, 149, 249
  message_credits  INTEGER NOT NULL,          -- 600, 1500, 3000
  validity_days    INTEGER NOT NULL,          -- 30, 30, 45
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Seed the 3 plans
INSERT INTO riya_recharge_packs (pack_name, display_name, price_inr, message_credits, validity_days, sort_order)
VALUES
  ('basic',    '🌿 Basic',          79,  600,  30, 1),
  ('romantic', '💖 Romantic',       149, 1500, 30, 2),
  ('soulmate', '👑 Soulmate',       249, 3000, 45, 3)
ON CONFLICT (pack_name) DO UPDATE SET
  price_inr       = EXCLUDED.price_inr,
  message_credits = EXCLUDED.message_credits,
  validity_days   = EXCLUDED.validity_days,
  is_active       = EXCLUDED.is_active;

-- ────────────────────────────────────────────────────────────
-- 3. Credit transaction ledger (full audit trail)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riya_credit_transactions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_user_id  TEXT        NOT NULL REFERENCES riya_instagram_users(instagram_user_id) ON DELETE CASCADE,
  transaction_type   TEXT        NOT NULL CHECK (transaction_type IN ('purchase','debit','bonus','refund','expiry_reset')),
  credits_delta      INTEGER     NOT NULL,   -- positive = credited, negative = debited
  balance_after      INTEGER     NOT NULL,
  pack_id            INTEGER     REFERENCES riya_recharge_packs(id),
  note               TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_txn_user ON riya_credit_transactions(instagram_user_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 4. Helper RPC: deduct_message_credit
--    Called after each successful Gemini reply.
--    Returns the new balance (-1 if user has no credits).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION deduct_message_credit(p_ig_user_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance   INTEGER;
  v_new_bal   INTEGER;
BEGIN
  SELECT message_credits INTO v_balance
  FROM riya_instagram_users
  WHERE instagram_user_id = p_ig_user_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance <= 0 THEN
    RETURN -1;  -- no credits
  END IF;

  v_new_bal := v_balance - 1;

  UPDATE riya_instagram_users
  SET message_credits = v_new_bal
  WHERE instagram_user_id = p_ig_user_id;

  INSERT INTO riya_credit_transactions
    (instagram_user_id, transaction_type, credits_delta, balance_after, note)
  VALUES
    (p_ig_user_id, 'debit', -1, v_new_bal, 'message sent');

  RETURN v_new_bal;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. Helper RPC: add_message_credits
--    Called by payment webhook on successful Razorpay payment.
--    Credits accumulate (rollover). Validity is extended if already active.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION add_message_credits(
  p_ig_user_id    TEXT,
  p_pack_id       INTEGER,
  p_credits       INTEGER,
  p_validity_days INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_bal    INTEGER;
  v_new_bal        INTEGER;
  v_current_expiry TIMESTAMPTZ;
  v_new_expiry     TIMESTAMPTZ;
BEGIN
  SELECT message_credits, credits_valid_until, total_credits_purchased
  INTO v_current_bal, v_current_expiry, v_new_bal  -- reuse v_new_bal for total
  FROM riya_instagram_users
  WHERE instagram_user_id = p_ig_user_id
  FOR UPDATE;

  v_new_bal := COALESCE(v_current_bal, 0) + p_credits;

  -- Extend validity from MAX(now, current expiry)
  v_new_expiry := GREATEST(now(), COALESCE(v_current_expiry, now())) + (p_validity_days || ' days')::INTERVAL;

  UPDATE riya_instagram_users
  SET
    message_credits         = v_new_bal,
    credits_valid_until     = v_new_expiry,
    total_credits_purchased = COALESCE(total_credits_purchased, 0) + p_credits
  WHERE instagram_user_id = p_ig_user_id;

  INSERT INTO riya_credit_transactions
    (instagram_user_id, transaction_type, credits_delta, balance_after, pack_id, note)
  VALUES
    (p_ig_user_id, 'purchase', p_credits, v_new_bal, p_pack_id, 'pack purchased');

  RETURN v_new_bal;
END;
$$;
