-- ================================================
-- VERIFY INSTAGRAM RETENTION METRICS
-- Run these queries in Supabase Dashboard -> SQL Editor
-- ================================================

-- ----------------------------------------------------
-- D1 Retention
-- "Users who sent a message at least 24 hours after signing up"
-- ----------------------------------------------------
SELECT 
    'D1 Retention' as metric,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day') as eligible_users,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day' 
                       AND last_message_at >= created_at + INTERVAL '1 day') as retained_users,
    ROUND(
        (COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day' 
                            AND last_message_at >= created_at + INTERVAL '1 day')::numeric 
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day'), 0)) * 100
    , 2) as retention_percentage
FROM riya_instagram_users;

-- ----------------------------------------------------
-- D3 Retention
-- "Users who sent a message at least 3 days after signing up"
-- ----------------------------------------------------
SELECT 
    'D3 Retention' as metric,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '3 days') as eligible_users,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '3 days' 
                       AND last_message_at >= created_at + INTERVAL '3 days') as retained_users,
    ROUND(
        (COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '3 days' 
                            AND last_message_at >= created_at + INTERVAL '3 days')::numeric 
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '3 days'), 0)) * 100
    , 2) as retention_percentage
FROM riya_instagram_users;

-- ----------------------------------------------------
-- D7 Retention
-- "Users who sent a message at least 7 days after signing up"
-- ----------------------------------------------------
SELECT 
    'D7 Retention' as metric,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days') as eligible_users,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' 
                       AND last_message_at >= created_at + INTERVAL '7 days') as retained_users,
    ROUND(
        (COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' 
                            AND last_message_at >= created_at + INTERVAL '7 days')::numeric 
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days'), 0)) * 100
    , 2) as retention_percentage
FROM riya_instagram_users;

-- ----------------------------------------------------
-- D30 Retention
-- "Users who sent a message at least 30 days after signing up"
-- ----------------------------------------------------
SELECT 
    'D30 Retention' as metric,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days') as eligible_users,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days' 
                       AND last_message_at >= created_at + INTERVAL '30 days') as retained_users,
    ROUND(
        (COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days' 
                            AND last_message_at >= created_at + INTERVAL '30 days')::numeric 
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days'), 0)) * 100
    , 2) as retention_percentage
FROM riya_instagram_users;
