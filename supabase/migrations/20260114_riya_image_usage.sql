-- =============================================
-- Riya Image Usage Tracking
-- Tracks daily image limits per user
-- =============================================

CREATE TABLE IF NOT EXISTS public.riya_image_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.riya_users(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Counters
    images_sent INTEGER NOT NULL DEFAULT 0,
    premium_blocked INTEGER NOT NULL DEFAULT 0,  -- Times shown blurred premium
    
    -- Unique constraint for upsert
    UNIQUE(user_id, usage_date)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_riya_image_usage_lookup 
ON public.riya_image_usage(user_id, usage_date);

-- Comments
COMMENT ON TABLE public.riya_image_usage IS 'Daily image limit tracking per user';
COMMENT ON COLUMN public.riya_image_usage.images_sent IS 'Number of images sent today';
COMMENT ON COLUMN public.riya_image_usage.premium_blocked IS 'Number of times premium images were shown blurred';

-- =============================================
-- Limits (enforced in Edge Function):
-- FREE_DAILY_IMAGE_LIMIT = 3
-- PRO_DAILY_IMAGE_LIMIT = 20
-- =============================================
