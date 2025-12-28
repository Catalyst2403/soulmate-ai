-- Riya Subscription & Payment System
-- Created: 2025-12-28
-- Implements: Pro subscription plans with daily message limits for free users

-- ============================================
-- Riya Subscriptions Table
-- Tracks user subscription status and plan details
-- ============================================
CREATE TABLE IF NOT EXISTS public.riya_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.riya_users(id) ON DELETE CASCADE UNIQUE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('trial', 'monthly', 'quarterly', 'half_yearly')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  amount_paid INTEGER NOT NULL,  -- amount in paise (e.g., 2900 = ₹29)
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_first_subscription BOOLEAN DEFAULT TRUE,  -- For trial eligibility
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Riya Daily Usage Table
-- Tracks daily message count for free users
-- ============================================
CREATE TABLE IF NOT EXISTS public.riya_daily_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.riya_users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, usage_date)
);

-- ============================================
-- Riya Payments Table
-- Audit log for all payment attempts
-- ============================================
CREATE TABLE IF NOT EXISTS public.riya_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.riya_users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.riya_subscriptions(id),
  razorpay_order_id TEXT NOT NULL,
  razorpay_payment_id TEXT,
  plan_type TEXT NOT NULL,
  amount INTEGER NOT NULL,  -- amount in paise
  currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_riya_subscriptions_user ON public.riya_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_riya_subscriptions_status ON public.riya_subscriptions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_riya_daily_usage_user_date ON public.riya_daily_usage(user_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_riya_payments_user ON public.riya_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_riya_payments_order ON public.riya_payments(razorpay_order_id);

-- ============================================
-- Helper Function: Check if user is Pro
-- ============================================
CREATE OR REPLACE FUNCTION public.is_riya_pro_user(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.riya_subscriptions
    WHERE user_id = p_user_id
      AND status = 'active'
      AND expires_at > NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Helper Function: Get remaining messages today
-- Returns -1 for Pro users (unlimited)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_riya_remaining_messages(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_is_pro BOOLEAN;
  v_message_count INTEGER;
  v_daily_limit INTEGER := 30;
BEGIN
  -- Check Pro status
  v_is_pro := public.is_riya_pro_user(p_user_id);
  
  IF v_is_pro THEN
    RETURN -1;  -- Unlimited
  END IF;
  
  -- Get today's message count
  SELECT COALESCE(message_count, 0) INTO v_message_count
  FROM public.riya_daily_usage
  WHERE user_id = p_user_id AND usage_date = CURRENT_DATE;
  
  IF v_message_count IS NULL THEN
    v_message_count := 0;
  END IF;
  
  RETURN GREATEST(0, v_daily_limit - v_message_count);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Helper Function: Increment message count
-- Returns remaining messages after increment
-- ============================================
CREATE OR REPLACE FUNCTION public.increment_riya_message_count(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_new_count INTEGER;
  v_daily_limit INTEGER := 30;
BEGIN
  -- Upsert daily usage record
  INSERT INTO public.riya_daily_usage (user_id, usage_date, message_count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET 
    message_count = riya_daily_usage.message_count + 1,
    updated_at = NOW()
  RETURNING message_count INTO v_new_count;
  
  RETURN GREATEST(0, v_daily_limit - v_new_count);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments for Documentation
-- ============================================
COMMENT ON TABLE public.riya_subscriptions IS 'User subscription records for Riya Pro plans';
COMMENT ON TABLE public.riya_daily_usage IS 'Daily message usage tracking for free tier limits';
COMMENT ON TABLE public.riya_payments IS 'Payment audit log for all Razorpay transactions';

COMMENT ON COLUMN public.riya_subscriptions.plan_type IS 'trial=₹29, monthly=₹89, quarterly=₹229, half_yearly=₹399';
COMMENT ON COLUMN public.riya_subscriptions.amount_paid IS 'Amount in paise (100 paise = ₹1)';
COMMENT ON COLUMN public.riya_subscriptions.is_first_subscription IS 'Used to track trial eligibility - only first subscription can be trial';
COMMENT ON COLUMN public.riya_daily_usage.message_count IS 'Number of messages sent today (resets at midnight IST via usage_date)';
