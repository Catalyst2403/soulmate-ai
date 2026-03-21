-- ============================================================
-- MIGRATION: Add pack_name column to riya_payments
-- Date: 2026-03-17
-- Reason: create-razorpay-order was inserting pack_name into
--         riya_payments but the column didn't exist, causing
--         payment records to fail silently and credits never
--         being credited after successful Razorpay payment.
-- ============================================================

ALTER TABLE riya_payments
  ADD COLUMN IF NOT EXISTS pack_name TEXT;

COMMENT ON COLUMN riya_payments.pack_name IS 'Credit pack name: basic | romantic | soulmate. NULL for legacy subscription plans.';

-- Optional: backfill existing rows from plan_type where it matches a pack
UPDATE riya_payments
SET pack_name = plan_type
WHERE plan_type IN ('basic', 'romantic', 'soulmate')
  AND pack_name IS NULL;
