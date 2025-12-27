-- Add character system support to personas and users tables
-- This allows for pre-defined characters alongside custom companions

-- Add character tracking columns to personas table
ALTER TABLE public.personas
ADD COLUMN IF NOT EXISTS character_id TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS character_type TEXT DEFAULT 'custom' CHECK (character_type IN ('custom', 'character'));

-- Add mobile number to users table for character onboarding
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS mobile_number TEXT;

-- Create index for faster character lookups
CREATE INDEX IF NOT EXISTS idx_personas_character_id ON public.personas(character_id);
CREATE INDEX IF NOT EXISTS idx_personas_character_type ON public.personas(character_type);

-- Comment for clarity
COMMENT ON COLUMN public.personas.character_id IS 'ID of the pre-defined character (e.g., "character123"), NULL for custom personas';
COMMENT ON COLUMN public.personas.character_type IS 'Type of persona: "custom" for user-created, "character" for pre-defined';
COMMENT ON COLUMN public.users.mobile_number IS 'User mobile number (collected during character onboarding)';
