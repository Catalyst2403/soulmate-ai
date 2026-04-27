-- Manual recovery runbook for a paid Razorpay order that is still pending.
-- Use only after confirming in Razorpay Dashboard/API that the order was paid.
--
-- Example incident:
--   order_Shc86UI7sKRIpj
--
-- 1) Inspect the current payment row.
SELECT
  razorpay_order_id,
  status,
  fulfilled_at,
  fulfillment_claimed_at,
  fulfillment_source,
  fulfillment_error,
  failure_reason,
  razorpay_payment_id,
  pack_name,
  instagram_user_id,
  telegram_user_id,
  updated_at
FROM public.riya_payments
WHERE razorpay_order_id = 'order_Shc86UI7sKRIpj';

-- 2) If the order is paid in Razorpay but still not fulfilled here,
--    reset it to a clean pending state so the fixed webhook / verify flow
--    can claim and fulfill it exactly once on replay.
UPDATE public.riya_payments
SET
  status = 'pending',
  fulfilled_at = NULL,
  fulfillment_claimed_at = NULL,
  fulfillment_source = NULL,
  fulfillment_error = NULL,
  failure_reason = NULL,
  updated_at = now()
WHERE razorpay_order_id = 'order_Shc86UI7sKRIpj'
  AND fulfilled_at IS NULL;

-- 3) Replay fulfillment outside SQL by either:
--    - re-sending the Razorpay webhook for this order, or
--    - calling verify-razorpay-payment again with the original orderId/paymentId/signature.
--
-- 4) Confirm success.
SELECT
  razorpay_order_id,
  status,
  fulfilled_at,
  fulfillment_source,
  razorpay_payment_id,
  updated_at
FROM public.riya_payments
WHERE razorpay_order_id = 'order_Shc86UI7sKRIpj';
