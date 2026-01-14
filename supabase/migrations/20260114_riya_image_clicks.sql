-- Image Click Analytics Table
-- Tracks camera button clicks by user type for analytics

CREATE TABLE IF NOT EXISTS public.riya_image_clicks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_type TEXT NOT NULL CHECK (user_type IN ('guest', 'free', 'pro')),
    user_id UUID, -- NULL for guests
    guest_session_id TEXT, -- NULL for logged-in users
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for quick analytics queries
CREATE INDEX IF NOT EXISTS idx_image_clicks_user_type ON public.riya_image_clicks(user_type);
CREATE INDEX IF NOT EXISTS idx_image_clicks_created_at ON public.riya_image_clicks(created_at);

-- Enable RLS
ALTER TABLE public.riya_image_clicks ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for backend inserts)
CREATE POLICY "Service role full access" ON public.riya_image_clicks
    FOR ALL USING (true);

-- Policy: Allow anonymous inserts (for click tracking)
CREATE POLICY "Allow anonymous inserts" ON public.riya_image_clicks
    FOR INSERT WITH CHECK (true);

-- Comment
COMMENT ON TABLE public.riya_image_clicks IS 'Tracks camera button clicks for analytics (guest/free/pro)';
