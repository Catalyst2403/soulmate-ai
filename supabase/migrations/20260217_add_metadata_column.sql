-- Add metadata column to riya_conversations
ALTER TABLE riya_conversations
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
