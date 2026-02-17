-- Check status of recent 49rs payments and their related subscriptions/users
-- This query helps verify if a payment was successful and if the user was upgraded.

SELECT 
    p.created_at as payment_time,
    p.razorpay_order_id,
    p.razorpay_payment_id,
    p.amount,
    p.status as payment_status,
    p.failure_reason,
    u.instagram_username,
    u.is_pro as user_is_pro,
    u.subscription_end_date as user_sub_end_date,
    s.status as subscription_status,
    s.plan_type as sub_plan_type,
    s.expires_at as sub_expires_at
FROM riya_payments p
LEFT JOIN riya_instagram_users u ON p.instagram_user_id = u.instagram_user_id
LEFT JOIN riya_subscriptions s ON p.subscription_id = s.id
WHERE p.amount = 49 -- checking for the 49rs plan specifically
ORDER BY p.created_at DESC
LIMIT 10;
