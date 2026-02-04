-- ============================================
-- FIX: RLS POLICY FOR SUBSCRIPTION INSERT
-- Run this in Supabase SQL Editor
-- ============================================

-- First, drop the broken policy
DROP POLICY IF EXISTS "Users can create their own subscription" ON public.riya_subscriptions;

-- Create fixed policy using auth.email() instead of querying auth.users
CREATE POLICY "Users can create their own subscription"
  ON public.riya_subscriptions
  FOR INSERT
  WITH CHECK (
    -- User can only insert a subscription for themselves
    user_id IN (
      SELECT id FROM public.riya_users 
      WHERE email = auth.email()
    )
  );

-- Verify
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'riya_subscriptions';
