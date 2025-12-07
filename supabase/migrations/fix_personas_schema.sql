-- This migration ensures all required columns exist in the personas table
-- Run this in your Supabase SQL Editor if you encounter schema errors

-- First, check if vibe column exists (from original schema)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'personas' AND column_name = 'vibe'
    ) THEN
        ALTER TABLE personas ADD COLUMN vibe TEXT NOT NULL DEFAULT '';
    END IF;
END $$;

-- Add new onboarding columns if they don't exist
ALTER TABLE personas 
  ADD COLUMN IF NOT EXISTS identity_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS identity_gender TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS age_archetype TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS relationship TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS lore TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS conflict TEXT DEFAULT '';

-- Ensure system_prompt column exists
ALTER TABLE personas 
  ADD COLUMN IF NOT EXISTS system_prompt TEXT DEFAULT '';

-- Drop old columns if they still exist (from original schema)
ALTER TABLE personas 
  DROP COLUMN IF EXISTS bot_name,
  DROP COLUMN IF EXISTS relationship_type,
  DROP COLUMN IF EXISTS communication_style;

-- Verify the schema
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'personas'
ORDER BY ordinal_position;
