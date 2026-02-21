-- Payment page analytics events
-- Tracks: link_sent, page_visit, upgrade_click, payment_success
CREATE TABLE IF NOT EXISTS riya_payment_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    instagram_user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast analytics queries
CREATE INDEX IF NOT EXISTS idx_payment_events_type ON riya_payment_events(event_type);
CREATE INDEX IF NOT EXISTS idx_payment_events_created ON riya_payment_events(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_user ON riya_payment_events(instagram_user_id);

-- RLS: Allow anon inserts (payment page uses anon key)
ALTER TABLE riya_payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert payment events"
    ON riya_payment_events
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- Service role can read for analytics
CREATE POLICY "Allow service role full access"
    ON riya_payment_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
