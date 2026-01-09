-- Web Analytics System
-- Tracks page views, visitors, referrers, countries, and devices
-- Created: 2026-01-08

-- Create web_analytics table
CREATE TABLE IF NOT EXISTS public.web_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Session & Page Info
  session_id TEXT NOT NULL,
  page_path TEXT NOT NULL,
  page_title TEXT,
  
  -- Referrer Info
  referrer TEXT,
  referrer_source TEXT, -- Extracted domain (e.g., "google.com")
  
  -- Location Info  
  country TEXT,
  country_code TEXT, -- ISO 2-letter code (e.g., "IN", "US")
  
  -- Device Info
  device_type TEXT CHECK (device_type IN ('Mobile', 'Desktop', 'Tablet')),
  os TEXT, -- Operating system
  browser TEXT,
  
  -- User Info (optional - can correlate with riya_users if logged in)
  user_id UUID REFERENCES public.riya_users(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast analytics queries
CREATE INDEX IF NOT EXISTS idx_web_analytics_session ON public.web_analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_web_analytics_page_path ON public.web_analytics(page_path);
CREATE INDEX IF NOT EXISTS idx_web_analytics_created_at ON public.web_analytics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_analytics_country ON public.web_analytics(country_code);
CREATE INDEX IF NOT EXISTS idx_web_analytics_referrer_source ON public.web_analytics(referrer_source);
CREATE INDEX IF NOT EXISTS idx_web_analytics_device_type ON public.web_analytics(device_type);

-- Enable Row Level Security
ALTER TABLE public.web_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow anonymous inserts (for client-side tracking)
CREATE POLICY "Allow anonymous insert for tracking" ON public.web_analytics
  FOR INSERT WITH CHECK (true);

-- RLS Policy: Allow service role to read all (for analytics dashboard)
CREATE POLICY "Allow service role read all" ON public.web_analytics
  FOR SELECT USING (auth.role() = 'service_role');

-- Comments for documentation
COMMENT ON TABLE public.web_analytics IS 'Stores web analytics events for tracking visitors, page views, and user behavior';
COMMENT ON COLUMN public.web_analytics.session_id IS 'Unique session identifier from browser localStorage';
COMMENT ON COLUMN public.web_analytics.referrer_source IS 'Extracted domain from referrer URL';
COMMENT ON COLUMN public.web_analytics.country_code IS 'ISO 2-letter country code from IP geolocation';
