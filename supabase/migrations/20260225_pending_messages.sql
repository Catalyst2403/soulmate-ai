-- ============================================================
-- Message Debounce Table
-- Used by instagram-webhook to batch rapid successive messages
-- from the same user into a single AI call (last-writer-wins).
-- Rows are ephemeral — auto-cleaned after 10 minutes.
-- ============================================================

CREATE TABLE IF NOT EXISTS riya_pending_messages (
    id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      TEXT        NOT NULL,
    message_id   TEXT        UNIQUE,              -- Instagram mid (prevents double-insert on webhook retry)
    message_text TEXT        NOT NULL,
    status       TEXT        DEFAULT 'pending',   -- pending | processing | done | absorbed
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup: latest pending msg per user, and querying by status
CREATE INDEX IF NOT EXISTS idx_pending_user_created
    ON riya_pending_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_status
    ON riya_pending_messages (status, created_at DESC);

-- RLS: only the service role can read/write (Edge Functions use service role key)
ALTER TABLE riya_pending_messages ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (Edge Functions use service_role key which bypasses RLS,
-- but we add this policy for explicitness)
CREATE POLICY "service_role_all" ON riya_pending_messages
    FOR ALL TO service_role USING (true) WITH CHECK (true);
