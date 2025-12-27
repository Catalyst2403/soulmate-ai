-- Riya Character System Tables
-- Completely separate from existing custom companion system
-- Created: 2025-12-27

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Riya Users Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.riya_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  user_age INTEGER NOT NULL,
  user_gender TEXT NOT NULL CHECK (user_gender IN ('male', 'female', 'other')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Riya Conversations Table (Full History)
-- ============================================
CREATE TABLE IF NOT EXISTS public.riya_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.riya_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Riya Sessions Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.riya_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.riya_users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  message_count INTEGER DEFAULT 0
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_riya_users_google_id ON public.riya_users(google_id);
CREATE INDEX IF NOT EXISTS idx_riya_users_email ON public.riya_users(email);
CREATE INDEX IF NOT EXISTS idx_riya_conversations_user ON public.riya_conversations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_riya_sessions_user ON public.riya_sessions(user_id);

-- ============================================
-- Comments for Documentation
-- ============================================
COMMENT ON TABLE public.riya_users IS 'User accounts for Riya character system (separate from custom companions)';
COMMENT ON TABLE public.riya_conversations IS 'Full conversation history for Riya chats (not summarized)';
COMMENT ON TABLE public.riya_sessions IS 'Session tracking for analytics and engagement metrics';

COMMENT ON COLUMN public.riya_users.google_id IS 'Google OAuth user ID for authentication';
COMMENT ON COLUMN public.riya_users.email IS 'User email from Google account (for future communications)';
COMMENT ON COLUMN public.riya_users.user_age IS 'User actual age - determines which Riya age variant (17/23/28/35) to use';
COMMENT ON COLUMN public.riya_users.user_gender IS 'User gender - used in system prompt personalization';
