-- ================================================
-- Fix: Instagram Data Discrepancy (Rate Limit/Pagination Issue)
-- 
-- The previous implementation fetched raw rows from the edge function,
-- which hit the default 1000-row limit. Since there was no sort order,
-- it fetched old messages and ignored new ones (Feb 14/15).
--
-- This generic RPC aggregates data directly in the database.
-- ================================================

CREATE OR REPLACE FUNCTION get_instagram_daily_activity(days_lookback INT DEFAULT 30)
RETURNS TABLE (
    activity_date TEXT,
    message_count BIGINT,
    active_users BIGINT,
    new_users BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH daily_msgs AS (
        SELECT 
            TO_CHAR(created_at, 'YYYY-MM-DD') as d,
            COUNT(*) as msgs,
            COUNT(DISTINCT instagram_user_id) as users
        FROM riya_conversations
        WHERE source = 'instagram' 
        AND role = 'user'
        AND created_at >= NOW() - (days_lookback || ' days')::INTERVAL
        GROUP BY 1
    ),
    daily_new_users AS (
        SELECT
            TO_CHAR(created_at, 'YYYY-MM-DD') as d,
            COUNT(*) as new_count
        FROM riya_instagram_users
        WHERE created_at >= NOW() - (days_lookback || ' days')::INTERVAL
        GROUP BY 1
    )
    SELECT 
        COALESCE(dm.d, dnu.d) as activity_date,
        COALESCE(dm.msgs, 0) as message_count,
        COALESCE(dm.users, 0) as active_users,
        COALESCE(dnu.new_count, 0) as new_users
    FROM daily_msgs dm
    FULL OUTER JOIN daily_new_users dnu ON dm.d = dnu.d
    ORDER BY activity_date DESC;
END;
$$ LANGUAGE plpgsql;
