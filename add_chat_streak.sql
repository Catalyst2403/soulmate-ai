-- Migration: Add streak tracking columns to riya_instagram_users
-- Tracks consecutive days of chatting for Duolingo-style loss aversion.

ALTER TABLE riya_instagram_users
ADD COLUMN IF NOT EXISTS chat_streak_days INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_chat_date DATE DEFAULT NULL;

-- Index for quick streak lookups on daily reset
CREATE INDEX IF NOT EXISTS idx_riya_instagram_users_last_chat_date
  ON riya_instagram_users (last_chat_date)
  WHERE last_chat_date IS NOT NULL;
