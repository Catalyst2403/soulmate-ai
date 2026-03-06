-- Migration: Add streak tracking to riya_instagram_users
-- Uses existing last_interaction_date (date) for day comparison — no extra column needed.

ALTER TABLE riya_instagram_users
ADD COLUMN IF NOT EXISTS chat_streak_days INTEGER DEFAULT 0;
