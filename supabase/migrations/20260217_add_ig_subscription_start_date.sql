-- Migration: Add subscription_start_date to riya_instagram_users
-- Created: 2026-02-17
-- Purpose: Track when an Instagram user's subscription started

ALTER TABLE riya_instagram_users
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMPTZ;

-- Index for querying by start date if needed
CREATE INDEX IF NOT EXISTS idx_ig_users_sub_start ON riya_instagram_users(subscription_start_date);
