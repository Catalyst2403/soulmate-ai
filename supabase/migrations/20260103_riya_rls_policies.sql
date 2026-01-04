-- Add RLS Policies for Riya Subscription Tables
-- Created: 2026-01-03
-- Fixes: 406 Not Acceptable errors when querying from browser

-- ============================================
-- Enable RLS on all Riya tables
-- ============================================
ALTER TABLE public.riya_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riya_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riya_payments ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies for riya_subscriptions
-- Users can read their own subscription using authenticated email
-- ============================================
CREATE POLICY "Users can view their own subscription"
  ON public.riya_subscriptions
  FOR SELECT
  USING (
    -- Check if user_id matches a riya_user with the authenticated user's email
    user_id IN (
      SELECT id FROM public.riya_users 
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Service role has full access (for Edge Functions)
CREATE POLICY "Service role has full access to subscriptions"
  ON public.riya_subscriptions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- RLS Policies for riya_daily_usage  
-- Users can read their own usage stats using authenticated email
-- ============================================
CREATE POLICY "Users can view their own daily usage"
  ON public.riya_daily_usage
  FOR SELECT
  USING (
    -- Check if user_id matches a riya_user with the authenticated user's email
    user_id IN (
      SELECT id FROM public.riya_users 
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Service role has full access (for Edge Functions)
CREATE POLICY "Service role has full access to daily usage"
  ON public.riya_daily_usage
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- RLS Policies for riya_payments
-- Users can read their own payment history using authenticated email
-- ============================================
CREATE POLICY "Users can view their own payments"
  ON public.riya_payments
  FOR SELECT
  USING (
    -- Check if user_id matches a riya_user with the authenticated user's email
    user_id IN (
      SELECT id FROM public.riya_users 
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Service role has full access (for Edge Functions)
CREATE POLICY "Service role has full access to payments"
  ON public.riya_payments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
