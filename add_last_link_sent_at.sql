-- Migration: Add last_link_sent_at column to riya_instagram_users
-- This tracks when a payment link was last sent to each user,
-- enabling the 6-hour cooldown in the instagram-webhook function.

ALTER TABLE riya_instagram_users
ADD COLUMN IF NOT EXISTS last_link_sent_at TIMESTAMPTZ DEFAULT NULL;

-- Optional index for fast lookups (the column is read on every message for free users)
CREATE INDEX IF NOT EXISTS idx_riya_instagram_users_last_link_sent_at
  ON riya_instagram_users (last_link_sent_at)
  WHERE last_link_sent_at IS NOT NULL;
