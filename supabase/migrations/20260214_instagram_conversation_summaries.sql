-- Migration: Add Instagram support to conversation summaries
-- Created: 2026-02-14
-- Fixed: Use proper UNIQUE constraint (not partial index) for ON CONFLICT support

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

-- Drop partial index if it was already created (doesn't work with ON CONFLICT)
DROP INDEX IF EXISTS idx_conv_summaries_ig_user;

-- Add proper unique constraint for Instagram users (supports ON CONFLICT)
ALTER TABLE riya_conversation_summaries 
  ADD CONSTRAINT unique_ig_user_summary UNIQUE (instagram_user_id);
