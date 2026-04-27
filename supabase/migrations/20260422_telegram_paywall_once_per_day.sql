-- ============================================================
-- MIGRATION: Telegram paywall once per day
-- Date: 2026-04-22
-- Adds a timestamp so the webhook can send the recharge CTA only
-- once per UTC day after the free daily limit is hit.
-- ============================================================

ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS last_paywall_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_telegram_users_last_paywall_sent_at
  ON public.telegram_users (last_paywall_sent_at)
  WHERE last_paywall_sent_at IS NOT NULL;
