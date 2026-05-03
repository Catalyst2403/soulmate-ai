-- ============================================================
-- MIGRATION: Telegram UPI Payment Links
-- Date: 2026-05-02
-- Purpose: Track Razorpay Payment Links used for Telegram credit packs.
-- ============================================================

ALTER TABLE public.riya_payments
  ADD COLUMN IF NOT EXISTS razorpay_payment_link_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_link_reference_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_riya_payments_payment_link_id
  ON public.riya_payments (razorpay_payment_link_id)
  WHERE razorpay_payment_link_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_riya_payments_payment_link_reference
  ON public.riya_payments (razorpay_payment_link_reference_id)
  WHERE razorpay_payment_link_reference_id IS NOT NULL;

COMMENT ON COLUMN public.riya_payments.razorpay_payment_link_id IS
  'Razorpay Payment Link id (plink_...) for Telegram UPI payment-link purchases.';

COMMENT ON COLUMN public.riya_payments.razorpay_payment_link_reference_id IS
  'Merchant reference_id sent while creating the Razorpay Payment Link.';

UPDATE public.riya_recharge_packs
SET price_inr = CASE pack_name
  WHEN 'basic' THEN 99
  WHEN 'romantic' THEN 199
  WHEN 'soulmate' THEN 349
  ELSE price_inr
END
WHERE pack_name IN ('basic', 'romantic', 'soulmate');
