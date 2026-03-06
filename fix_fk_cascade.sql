-- Fix FK constraints to support ON UPDATE CASCADE
-- This allows updating instagram_user_id in riya_instagram_users
-- and having it automatically propagate to child tables.
-- Run ONCE in Supabase SQL Editor.

-- 1. riya_subscriptions
ALTER TABLE riya_subscriptions 
  DROP CONSTRAINT IF EXISTS riya_subscriptions_instagram_user_id_fkey;

ALTER TABLE riya_subscriptions 
  ADD CONSTRAINT riya_subscriptions_instagram_user_id_fkey
  FOREIGN KEY (instagram_user_id) 
  REFERENCES riya_instagram_users(instagram_user_id)
  ON UPDATE CASCADE 
  ON DELETE SET NULL;

-- 2. riya_payments
ALTER TABLE riya_payments 
  DROP CONSTRAINT IF EXISTS riya_payments_instagram_user_id_fkey;

ALTER TABLE riya_payments 
  ADD CONSTRAINT riya_payments_instagram_user_id_fkey
  FOREIGN KEY (instagram_user_id) 
  REFERENCES riya_instagram_users(instagram_user_id)
  ON UPDATE CASCADE 
  ON DELETE SET NULL;

-- Verify
SELECT
  tc.table_name, kcu.column_name,
  ccu.table_name AS foreign_table,
  rc.update_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'riya_instagram_users'
ORDER BY tc.table_name;
