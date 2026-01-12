-- Conversation Summaries Table
-- Stores condensed memory of older conversations for cost optimization
-- Created: 2026-01-12

CREATE TABLE IF NOT EXISTS public.riya_conversation_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.riya_users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  messages_summarized INTEGER NOT NULL,       -- Count of messages included in summary
  last_summarized_msg_id UUID,                -- Last message ID included in summary
  last_summarized_at TIMESTAMPTZ,             -- When summary was last updated
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)                             -- One active summary per user
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_user 
  ON public.riya_conversation_summaries(user_id);

-- Comments for documentation
COMMENT ON TABLE public.riya_conversation_summaries IS 'Stores condensed summaries of older conversations to reduce token usage';
COMMENT ON COLUMN public.riya_conversation_summaries.summary IS 'LLM-generated summary of older messages (relationship memory)';
COMMENT ON COLUMN public.riya_conversation_summaries.messages_summarized IS 'Total count of messages condensed into this summary';
COMMENT ON COLUMN public.riya_conversation_summaries.last_summarized_msg_id IS 'ID of the last message included in the summary';
