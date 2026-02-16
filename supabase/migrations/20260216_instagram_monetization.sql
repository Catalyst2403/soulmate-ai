-- Migration: Instagram Monetization Support
-- Created: 2026-02-16
-- Purpose: Add usage tracking for IG users and link subscriptions to them

-- 1. Updates to riya_instagram_users for usage tracking
ALTER TABLE riya_instagram_users 
ADD COLUMN IF NOT EXISTS daily_message_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS daily_image_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_interaction_date DATE DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMPTZ;

-- Index for fast Pro check
CREATE INDEX IF NOT EXISTS idx_ig_users_pro ON riya_instagram_users(is_pro);

-- 2. Updates to riya_subscriptions to allow Instagram Users
-- First, make user_id nullable (it was NOT NULL)
ALTER TABLE riya_subscriptions ALTER COLUMN user_id DROP NOT NULL;

-- Add instagram_user_id column
ALTER TABLE riya_subscriptions 
ADD COLUMN IF NOT EXISTS instagram_user_id TEXT REFERENCES riya_instagram_users(instagram_user_id);

-- Add constaint: Either user_id OR instagram_user_id must represent the owner
ALTER TABLE riya_subscriptions 
ADD CONSTRAINT check_subscription_owner 
CHECK (
    (user_id IS NOT NULL AND instagram_user_id IS NULL) OR 
    (user_id IS NULL AND instagram_user_id IS NOT NULL)
);

-- Index for searching IG subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_ig_user ON riya_subscriptions(instagram_user_id);


-- 3. Updates to riya_payments to tracking IG payments
ALTER TABLE riya_payments ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE riya_payments 
ADD COLUMN IF NOT EXISTS instagram_user_id TEXT REFERENCES riya_instagram_users(instagram_user_id);
-- No Strict constraint on payments as some might be orphan/failed before linking, but good practice to have at least one.


-- 4. Helper Function: Check IG Pro Status (DB Level)
CREATE OR REPLACE FUNCTION public.is_riya_instagram_pro(p_ig_user_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.riya_subscriptions
    WHERE instagram_user_id = p_ig_user_id
      AND status = 'active'
      AND expires_at > NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- 5. Helper Function: Reset IG Counts (Daily)
-- Call this when handling webhook if date changed
CREATE OR REPLACE FUNCTION public.reset_ig_daily_counts(p_ig_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE riya_instagram_users
  SET 
    daily_message_count = 0,
    daily_image_count = 0,
    last_interaction_date = CURRENT_DATE
  WHERE instagram_user_id = p_ig_user_id;
END;
$$ LANGUAGE plpgsql;
