-- Add image_data column to riya_conversations for persisting images on reload
-- This stores the image URL and metadata so images appear after page reload

ALTER TABLE public.riya_conversations 
ADD COLUMN IF NOT EXISTS image_data JSONB DEFAULT NULL;

-- Add comment
COMMENT ON COLUMN public.riya_conversations.image_data IS 'JSON containing image URL and metadata for displaying images on reload';
