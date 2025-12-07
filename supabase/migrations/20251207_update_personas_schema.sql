-- Migration: Update personas table schema for new onboarding flow
-- This migration updates the personas table to use new field names

-- Drop old columns and add new ones
ALTER TABLE personas 
  DROP COLUMN IF EXISTS bot_name,
  DROP COLUMN IF EXISTS relationship_type,
  DROP COLUMN IF EXISTS communication_style;

-- Add new columns
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS identity_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS identity_gender TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS age_archetype TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS relationship TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lore TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS conflict TEXT NOT NULL DEFAULT '';

-- Note: vibe and system_prompt columns already exist, so we keep them
