-- =============================================
-- Riya Sent Images Tracking
-- Tracks which images were sent to which Instagram user to avoid duplicates
-- =============================================

CREATE TABLE IF NOT EXISTS public.riya_sent_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instagram_user_id TEXT NOT NULL,
    image_id UUID NOT NULL REFERENCES public.riya_gallery(id) ON DELETE CASCADE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookups by user and image
CREATE INDEX IF NOT EXISTS idx_riya_sent_images_user ON public.riya_sent_images(instagram_user_id);
CREATE INDEX IF NOT EXISTS idx_riya_sent_images_user_image ON public.riya_sent_images(instagram_user_id, image_id);

-- Comment
COMMENT ON TABLE public.riya_sent_images IS 'Tracking table for images sent to Instagram users to prevent duplicates';
