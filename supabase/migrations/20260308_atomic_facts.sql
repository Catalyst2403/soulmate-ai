-- Migration: Atomic Facts Memory System
-- Created: 2026-03-08
-- Branch: feature/atomic-memory
--
-- Adds two columns to riya_instagram_users:
--   user_facts             JSONB  — structured facts extracted from conversations
--   facts_extracted_at_msg INT    — lifetime msg count at last extraction (used as trigger cursor)
--
-- Run this BEFORE the retroactive script (20260308_atomic_facts_retroactive.sql).

-- 1. Add user_facts column
ALTER TABLE riya_instagram_users
  ADD COLUMN IF NOT EXISTS user_facts JSONB DEFAULT '{}';

-- 2. GIN index for fast JSONB containment queries (e.g. analytics)
CREATE INDEX IF NOT EXISTS idx_ig_user_facts
  ON riya_instagram_users USING GIN (user_facts);

-- 3. Add extraction cursor column
ALTER TABLE riya_instagram_users
  ADD COLUMN IF NOT EXISTS facts_extracted_at_msg INTEGER DEFAULT 0;

-- 4. Comments
COMMENT ON COLUMN riya_instagram_users.user_facts IS
  'Structured atomic facts about the user: profile, life, personality, relationship_with_riya, key_events. Updated via deep-merge every 25 messages (async).';

COMMENT ON COLUMN riya_instagram_users.facts_extracted_at_msg IS
  'Lifetime message count at which user_facts was last extracted. Trigger fires when (message_count - facts_extracted_at_msg) >= 25.';
