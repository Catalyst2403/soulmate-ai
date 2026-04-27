-- ============================================================
-- MIGRATION: Payment fulfillment claim fields
-- Date: 2026-04-25
-- Purpose: Replace the invalid transient "processing" payment
--          status with explicit claim / fulfilled timestamps.
-- ============================================================

ALTER TABLE public.riya_payments
  ADD COLUMN IF NOT EXISTS fulfillment_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfillment_source TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_error TEXT;

COMMENT ON COLUMN public.riya_payments.fulfillment_claimed_at IS
  'Set when a worker claims a pending payment for fulfillment. Cleared on retryable failure.';
COMMENT ON COLUMN public.riya_payments.fulfilled_at IS
  'Set only after credits/subscription activation has completed successfully.';
COMMENT ON COLUMN public.riya_payments.fulfillment_source IS
  'Which worker last claimed or fulfilled the order, e.g. razorpay-webhook or verify-razorpay-payment.';
COMMENT ON COLUMN public.riya_payments.fulfillment_error IS
  'Last fulfillment error message for observability and manual recovery.';
