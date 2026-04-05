-- Migration: Proactive Messaging System
-- Created: 2026-04-05
-- Branch: feat/riya-proactive-messaging
--
-- Adds proactive messaging columns to riya_instagram_users and a
-- singleton lock table to prevent concurrent cron runs.

-- ── Proactive tracking columns ───────────────────────────────────────────────
ALTER TABLE riya_instagram_users
  ADD COLUMN IF NOT EXISTS last_proactive_sent_at      TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS proactive_no_reply_count    INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proactive_opted_out         BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS proactive_skip_until        TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS proactive_scheduled_context TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS user_active_hour_ist        SMALLINT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recurring_notif_token       TEXT        DEFAULT NULL;

COMMENT ON COLUMN riya_instagram_users.last_proactive_sent_at IS
  'When Riya last proactively messaged this user. Used for 4h cooldown guard.';

COMMENT ON COLUMN riya_instagram_users.proactive_no_reply_count IS
  'Consecutive proactive messages sent with no user reply between them. Auto-stop at 5.';

COMMENT ON COLUMN riya_instagram_users.proactive_opted_out IS
  'True when user explicitly asked Riya not to initiate, or when no_reply_count hit 5. Resets on any user reply.';

COMMENT ON COLUMN riya_instagram_users.proactive_skip_until IS
  'Proactive sender skips this user until this timestamp. Set by model ("not yet, wait until 9pm") or by scheduled followup detection.';

COMMENT ON COLUMN riya_instagram_users.proactive_scheduled_context IS
  'Short note for why proactive_skip_until was set (e.g. "User said they''d be free at 9pm IST"). Injected into proactive prompt.';

COMMENT ON COLUMN riya_instagram_users.user_active_hour_ist IS
  'IST hour (0–23) when this user typically first messages each day. Updated on first message of the day. Used to avoid messaging at wrong times.';

COMMENT ON COLUMN riya_instagram_users.recurring_notif_token IS
  'Instagram Recurring Notifications token from messaging_optins webhook. Allows proactive DMs beyond the 24h window.';

-- ── Proactive lock table ─────────────────────────────────────────────────────
-- Singleton row prevents concurrent cron runs from double-sending.
CREATE TABLE IF NOT EXISTS riya_proactive_lock (
    id         TEXT        PRIMARY KEY DEFAULT 'singleton',
    locked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
);

COMMENT ON TABLE riya_proactive_lock IS
  'Singleton lock for riya-proactive-sender Edge Function. Prevents concurrent cron runs.';
