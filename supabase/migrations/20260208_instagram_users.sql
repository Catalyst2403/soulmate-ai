-- Migration: Add Instagram users table and source column
-- Created: 2026-02-08

-- Create table for Instagram users (auto-created on first DM)
CREATE TABLE IF NOT EXISTS riya_instagram_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Instagram identity (from API)
    instagram_user_id TEXT UNIQUE NOT NULL,
    instagram_username TEXT,
    instagram_name TEXT,
    
    -- Defaults (since we can't get age/gender from Instagram)
    user_age INTEGER DEFAULT 23,
    user_gender TEXT DEFAULT 'male',
    
    -- Trial period (14 days)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
    
    -- Analytics
    message_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMPTZ
);

-- Index for fast lookup by Instagram user ID
CREATE INDEX IF NOT EXISTS idx_ig_user_id ON riya_instagram_users(instagram_user_id);

-- Add source column to track where conversations come from
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'riya_conversations' AND column_name = 'source'
    ) THEN
        ALTER TABLE riya_conversations ADD COLUMN source TEXT DEFAULT 'web';
    END IF;
END $$;

-- Add instagram_user_id foreign key column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'riya_conversations' AND column_name = 'instagram_user_id'
    ) THEN
        ALTER TABLE riya_conversations ADD COLUMN instagram_user_id TEXT;
    END IF;
END $$;
