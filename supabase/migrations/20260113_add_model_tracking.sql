-- Add model_used column to track which Gemini model was used for each message
-- This helps with cost analysis and debugging the tiered model system

ALTER TABLE public.riya_conversations 
ADD COLUMN IF NOT EXISTS model_used TEXT;

-- Add index for querying by model
CREATE INDEX IF NOT EXISTS idx_riya_conversations_model ON public.riya_conversations(model_used);

-- Update comments
COMMENT ON COLUMN public.riya_conversations.model_used IS 'Gemini model used: gemini-3-pro-preview, gemini-2.5-flash-lite, etc.';
