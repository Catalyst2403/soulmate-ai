-- Riya Analytics: Add Cost Tracking to Conversations
-- Created: 2026-01-07
-- Adds token usage and cost tracking columns for analytics

-- Add minimal token and cost columns to riya_conversations
ALTER TABLE public.riya_conversations ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0;
ALTER TABLE public.riya_conversations ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0;
ALTER TABLE public.riya_conversations ADD COLUMN IF NOT EXISTS cost_inr NUMERIC(10, 4) DEFAULT 0;

-- Add indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_riya_conversations_cost ON public.riya_conversations(cost_inr);
CREATE INDEX IF NOT EXISTS idx_riya_conversations_created_at ON public.riya_conversations(created_at DESC);

-- Add comments for documentation
COMMENT ON COLUMN public.riya_conversations.input_tokens IS 'Input tokens from Gemini API (from usageMetadata.promptTokenCount)';
COMMENT ON COLUMN public.riya_conversations.output_tokens IS 'Output tokens from Gemini API (from usageMetadata.candidatesTokenCount)';
COMMENT ON COLUMN public.riya_conversations.cost_inr IS 'Cost in INR calculated from Gemini 3 Pro pricing ($2/$12 per 1M for ≤200k, $4/$18 for >200k) × 89.83';
