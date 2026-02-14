-- Fix: Daily Activity Analytics - Server-side aggregation
-- Problem: PostgREST max-rows (default 1000) silently truncates raw row fetches,
--          causing days with older data to show 0 in the dashboard.
-- Solution: Aggregate in SQL so only ~30 summary rows are returned.
-- Created: 2026-02-11

-- ============================================
-- RPC: Get Daily Activity (Last 30 Days)
-- Returns: date, active_users, user_messages, guest_sessions
-- ============================================

CREATE OR REPLACE FUNCTION public.get_daily_activity(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    activity_date DATE,
    active_users BIGINT,
    user_messages BIGINT,
    guest_sessions BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH user_activity AS (
        -- Aggregate user messages by UTC date
        SELECT 
            (created_at AT TIME ZONE 'UTC')::date AS msg_date,
            COUNT(*) AS msg_count,
            COUNT(DISTINCT user_id) AS unique_users
        FROM public.riya_conversations
        WHERE role = 'user'
          AND created_at >= (NOW() - (p_days || ' days')::interval)
        GROUP BY msg_date
    ),
    guest_activity AS (
        -- Aggregate guest sessions by UTC date
        SELECT 
            (created_at AT TIME ZONE 'UTC')::date AS session_date,
            COUNT(*) AS session_count
        FROM public.riya_guest_sessions
        WHERE message_count > 0
          AND created_at >= (NOW() - (p_days || ' days')::interval)
        GROUP BY session_date
    )
    SELECT 
        COALESCE(u.msg_date, g.session_date) AS activity_date,
        COALESCE(u.unique_users, 0) AS active_users,
        COALESCE(u.msg_count, 0) AS user_messages,
        COALESCE(g.session_count, 0) AS guest_sessions
    FROM user_activity u
    FULL OUTER JOIN guest_activity g ON u.msg_date = g.session_date
    ORDER BY activity_date DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_daily_activity IS 'Aggregates daily user messages, active users, and guest sessions server-side to avoid PostgREST row limits';

-- ============================================
-- RPC: Get Cost Summary (all-time)
-- Returns: total_cost_inr, total_input_tokens, total_output_tokens, unique_users
-- Also affected by PostgREST 1000-row limit
-- ============================================

CREATE OR REPLACE FUNCTION public.get_cost_summary()
RETURNS TABLE (
    total_cost_inr NUMERIC,
    total_input_tokens BIGINT,
    total_output_tokens BIGINT,
    unique_users BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(c.cost_inr::numeric), 0) AS total_cost_inr,
        COALESCE(SUM(c.input_tokens), 0)::bigint AS total_input_tokens,
        COALESCE(SUM(c.output_tokens), 0)::bigint AS total_output_tokens,
        COUNT(DISTINCT c.user_id)::bigint AS unique_users
    FROM public.riya_conversations c
    WHERE c.cost_inr IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_cost_summary IS 'Aggregates cost and token data server-side to avoid PostgREST row limits';
