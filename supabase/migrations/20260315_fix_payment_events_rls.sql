-- Fix: Allow anonymous/unauthenticated inserts into riya_payment_events
-- This table is written to from the frontend (recharge page) using the anon key.
-- Reads remain restricted to service role only.

-- Enable RLS if not already enabled
ALTER TABLE riya_payment_events ENABLE ROW LEVEL SECURITY;

-- Drop existing restrictive policy if any
DROP POLICY IF EXISTS "Allow anon insert payment events" ON riya_payment_events;

-- Allow anyone (anon key from browser) to INSERT events
CREATE POLICY "Allow anon insert payment events"
ON riya_payment_events
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Service role can do everything (already works by default, but explicit is good)
DROP POLICY IF EXISTS "Service role full access" ON riya_payment_events;
CREATE POLICY "Service role full access"
ON riya_payment_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
