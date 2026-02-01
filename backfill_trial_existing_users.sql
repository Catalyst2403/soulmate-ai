-- ============================================
-- BACKFILL 14-DAY TRIAL FOR EXISTING FREE USERS
-- Run this ONCE in Supabase SQL Editor
-- ============================================

-- Preview: See which users will get the trial
SELECT 
    u.id,
    u.username,
    u.email,
    u.created_at as user_created
FROM public.riya_users u
WHERE NOT EXISTS (
    SELECT 1 FROM public.riya_subscriptions s 
    WHERE s.user_id = u.id 
    AND s.status = 'active' 
    AND s.expires_at > NOW()
);

-- ============================================
-- UNCOMMENT BELOW TO RUN THE ACTUAL BACKFILL
-- ============================================

/*
INSERT INTO public.riya_subscriptions (
    user_id,
    plan_type,
    status,
    amount_paid,
    expires_at,
    is_first_subscription,
    created_at
)
SELECT 
    u.id,
    'trial',
    'active',
    0,
    NOW() + INTERVAL '14 days',
    TRUE,
    NOW()
FROM public.riya_users u
WHERE NOT EXISTS (
    SELECT 1 FROM public.riya_subscriptions s 
    WHERE s.user_id = u.id 
    AND s.status = 'active' 
    AND s.expires_at > NOW()
);
*/

-- ============================================
-- VERIFY: Check recently granted trials
-- ============================================
-- SELECT u.username, u.email, s.plan_type, s.expires_at, s.amount_paid
-- FROM riya_users u
-- JOIN riya_subscriptions s ON u.id = s.user_id
-- WHERE s.amount_paid = 0
-- ORDER BY s.created_at DESC
-- LIMIT 20;
