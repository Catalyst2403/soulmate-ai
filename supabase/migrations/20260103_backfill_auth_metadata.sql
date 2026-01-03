-- Backfill Supabase Auth Metadata with Usernames
-- This updates auth.users metadata for email users who don't have names set
-- Created: 2026-01-03

-- This is a one-time fix to sync usernames from riya_users to auth.users metadata
-- Note: This requires a function because we need to update auth.users which requires elevated permissions

CREATE OR REPLACE FUNCTION backfill_auth_metadata()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- Loop through all riya_users and update corresponding auth.users
  FOR user_record IN 
    SELECT ru.google_id, ru.username
    FROM public.riya_users ru
    WHERE ru.username IS NOT NULL AND ru.username != ''
  LOOP
    -- Update auth.users metadata
    UPDATE auth.users
    SET raw_user_meta_data = 
      COALESCE(raw_user_meta_data, '{}'::jsonb) || 
      jsonb_build_object(
        'full_name', user_record.username,
        'name', user_record.username
      )
    WHERE id::text = user_record.google_id;
  END LOOP;
END;
$$;

-- Execute the backfill
SELECT backfill_auth_metadata();

-- Drop the function after use
DROP FUNCTION IF EXISTS backfill_auth_metadata();

-- Add a comment
COMMENT ON TABLE public.riya_users IS 'User accounts for Riya character system. Usernames are synced to auth.users metadata.';
