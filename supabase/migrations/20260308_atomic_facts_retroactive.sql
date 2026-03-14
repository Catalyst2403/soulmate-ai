-- ============================================================
-- RETROACTIVE ATOMIC FACTS MIGRATION
-- Run this ONCE in Supabase SQL editor for existing heavy users
-- ============================================================
-- STEP 1: Apply the schema migration first (20260308_atomic_facts.sql)
-- STEP 2: Then run this script to see which users need seeding
-- STEP 3: Use the Edge Function call (see instructions below) to seed each user
-- ============================================================

-- View all users who need facts seeding (no facts yet, 25+ messages)
SELECT 
    instagram_user_id,
    instagram_name,
    instagram_username,
    message_count,
    facts_extracted_at_msg,
    user_facts
FROM riya_instagram_users
WHERE message_count >= 25
  AND (user_facts IS NULL OR user_facts = '{}')
ORDER BY message_count DESC;

-- Quick stats: how many users need migration
SELECT 
    COUNT(*) AS users_needing_migration,
    SUM(message_count) AS total_messages_to_process,
    MAX(message_count) AS max_messages,
    ROUND(AVG(message_count)) AS avg_messages
FROM riya_instagram_users
WHERE message_count >= 25
  AND (user_facts IS NULL OR user_facts = '{}');

-- ============================================================
-- MANUAL SEED (for debugging one user)
-- Replace 'INSTAGRAM_USER_ID_HERE' with the actual IG user ID
-- Set an empty fact set — the next message trigger will fill it in
-- ============================================================
-- UPDATE riya_instagram_users
-- SET 
--     user_facts = '{}',
--     facts_extracted_at_msg = 0
-- WHERE instagram_user_id = 'INSTAGRAM_USER_ID_HERE';

-- ============================================================
-- NOTE ON STRATEGY FOR EXISTING USERS:
-- The simplest safe approach: set facts_extracted_at_msg = 0 for all users.
-- This means every existing user will trigger a facts extraction on their
-- NEXT message (since newLifetimeCount - 0 >= 25 for anyone with 25+ msgs).
-- The extraction will use their last 25 messages automatically.
-- No bulk processing script needed — the system self-heals on next interaction.
-- ============================================================
UPDATE riya_instagram_users
SET facts_extracted_at_msg = 0
WHERE facts_extracted_at_msg IS NULL;

-- Verify the update
SELECT COUNT(*) AS users_primed_for_extraction
FROM riya_instagram_users
WHERE facts_extracted_at_msg = 0 AND message_count >= 25;
