-- Guest Mode Support Migration
-- Created: 2026-01-13
-- Purpose: Enable unauthenticated guest chat sessions

-- ============================================
-- 1. Add guest_session_id to riya_conversations
-- ============================================

-- Make user_id nullable (for guest messages)
ALTER TABLE public.riya_conversations 
    ALTER COLUMN user_id DROP NOT NULL;

-- Add guest session tracking column
ALTER TABLE public.riya_conversations 
    ADD COLUMN IF NOT EXISTS guest_session_id UUID;

-- Index for efficient guest queries
CREATE INDEX IF NOT EXISTS idx_riya_conversations_guest 
    ON public.riya_conversations(guest_session_id) 
    WHERE guest_session_id IS NOT NULL;

-- ============================================
-- 2. Guest Sessions Table (Analytics)
-- ============================================

CREATE TABLE IF NOT EXISTS public.riya_guest_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID UNIQUE NOT NULL,           -- Same as guest_session_id in conversations
    message_count INTEGER DEFAULT 0,            -- Track messages sent
    converted BOOLEAN DEFAULT FALSE,            -- True if user logged in after
    converted_user_id UUID REFERENCES public.riya_users(id),  -- Link to user if converted
    user_agent TEXT,                            -- Browser info for analytics
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ DEFAULT NOW()
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_riya_guest_sessions_id 
    ON public.riya_guest_sessions(session_id);

CREATE INDEX IF NOT EXISTS idx_riya_guest_sessions_converted 
    ON public.riya_guest_sessions(converted);

-- ============================================
-- 3. Comments
-- ============================================

COMMENT ON TABLE public.riya_guest_sessions IS 'Track guest (unauthenticated) chat sessions for conversion analytics';
COMMENT ON COLUMN public.riya_conversations.guest_session_id IS 'UUID for guest sessions (NULL for authenticated users)';
COMMENT ON COLUMN public.riya_guest_sessions.session_id IS 'Matches guest_session_id in riya_conversations';
COMMENT ON COLUMN public.riya_guest_sessions.converted IS 'True if this guest later created an account';
COMMENT ON COLUMN public.riya_guest_sessions.converted_user_id IS 'Links to riya_users if guest converted to registered user';
