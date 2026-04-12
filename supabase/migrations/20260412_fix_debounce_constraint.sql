-- Fix debounce ON CONFLICT error (42P10).
--
-- Root cause: the previous fix migration used CREATE UNIQUE INDEX which only
-- writes to pg_index. PostgREST's upsert resolution queries pg_constraint —
-- it cannot see bare indexes — so ON CONFLICT always fails with 42P10.
--
-- Fix: replace the bare unique index with a proper named UNIQUE CONSTRAINT
-- (ADD CONSTRAINT writes to both pg_constraint AND creates the backing index).

-- Drop the bare index left by the previous migration (harmless if missing)
DROP INDEX IF EXISTS telegram_pending_messages_user_msg_uniq;

-- Also drop the original single-column constraint if it somehow still exists
ALTER TABLE telegram_pending_messages
    DROP CONSTRAINT IF EXISTS telegram_pending_messages_message_id_key;

-- Add a proper named UNIQUE CONSTRAINT on (user_id, message_id).
-- Two different Telegram users can share the same message_id (IDs are per-chat),
-- so the composite key is required to avoid silently dropping messages.
ALTER TABLE telegram_pending_messages
    ADD CONSTRAINT telegram_pending_messages_user_msg_key
    UNIQUE (user_id, message_id);
