-- =============================================
-- Fix: Add UNIQUE constraint to riya_sent_images
-- Prevents duplicate rows for the same user+image pair
-- which caused the filter to break after recycle
-- =============================================

-- Add unique constraint so the same image can't be inserted twice for a user
ALTER TABLE public.riya_sent_images
    ADD CONSTRAINT uq_sent_images_user_image UNIQUE (instagram_user_id, image_id);
