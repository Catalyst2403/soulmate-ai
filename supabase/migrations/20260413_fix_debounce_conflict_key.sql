-- Fix BUG-2: telegram_pending_messages.message_id is only unique per-chat in Telegram,
-- not globally. Two different users can have the same message_id. Using a single-column
-- unique on message_id causes the second user's message to be silently dropped.
-- Fix: conflict key becomes the composite (user_id, message_id).

ALTER TABLE telegram_pending_messages
    DROP CONSTRAINT IF EXISTS telegram_pending_messages_message_id_key;

DROP INDEX IF EXISTS telegram_pending_messages_message_id_idx;

CREATE UNIQUE INDEX IF NOT EXISTS telegram_pending_messages_user_msg_uniq
    ON telegram_pending_messages (user_id, message_id);
