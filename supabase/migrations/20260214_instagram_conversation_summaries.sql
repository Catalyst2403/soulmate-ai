-- Migration: Add Instagram support to conversation summaries
-- Created: 2026-02-14

-- Add instagram_user_id column to existing summaries table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'riya_conversation_summaries' AND column_name = 'instagram_user_id'
    ) THEN
        ALTER TABLE riya_conversation_summaries ADD COLUMN instagram_user_id TEXT;
    END IF;
END $$;

-- Add unique index for Instagram users (one summary per IG user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_summaries_ig_user 
  ON riya_conversation_summaries(instagram_user_id) 
  WHERE instagram_user_id IS NOT NULL;
