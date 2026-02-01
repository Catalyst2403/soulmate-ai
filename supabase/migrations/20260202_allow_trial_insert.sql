-- ============================================
-- ADD INSERT POLICY FOR TRIAL SUBSCRIPTIONS
-- Run this in Supabase SQL Editor
-- Required for auto-trial on signup to work
-- ============================================

-- Allow authenticated users to insert their own subscription (for trial grant)
CREATE POLICY "Users can create their own subscription"
  ON public.riya_subscriptions
  FOR INSERT
  WITH CHECK (
    -- User can only insert a subscription for themselves
    user_id IN (
      SELECT id FROM public.riya_users 
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Verify the policy was created
SELECT 
    policyname, 
    cmd as operation,
    permissive
FROM pg_policies 
WHERE tablename = 'riya_subscriptions';
