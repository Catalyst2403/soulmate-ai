-- Migration: Add max_session_minutes + top_sessions to session metrics RPC
-- Created: 2026-02-24
-- Purpose: Add longest session time and top 5 session users to analytics dashboard

DROP FUNCTION IF EXISTS public.get_instagram_session_metrics(INT);

CREATE OR REPLACE FUNCTION public.get_instagram_session_metrics(days_lookback INT DEFAULT 30)
RETURNS TABLE (
    avg_session_minutes NUMERIC,
    median_session_minutes NUMERIC,
    max_session_minutes NUMERIC,
    total_sessions BIGINT,
    avg_sessions_per_user NUMERIC,
    bucket_0_5 BIGINT,
    bucket_5_15 BIGINT,
    bucket_15_30 BIGINT,
    bucket_30_60 BIGINT,
    bucket_60_plus BIGINT,
    daily_data JSONB,
    top_sessions JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH user_messages AS (
        SELECT
            instagram_user_id AS uid,
            created_at AS ts
        FROM public.riya_conversations
        WHERE source = 'instagram'
          AND role = 'user'
          AND instagram_user_id IS NOT NULL
          AND created_at >= NOW() - (days_lookback || ' days')::INTERVAL
        ORDER BY instagram_user_id, created_at
    ),
    with_gaps AS (
        SELECT
            uid,
            ts,
            EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (PARTITION BY uid ORDER BY ts))) / 60.0 AS gap_minutes
        FROM user_messages
    ),
    with_session_boundary AS (
        SELECT
            uid,
            ts,
            gap_minutes,
            CASE WHEN gap_minutes IS NULL OR gap_minutes > 30 THEN 1 ELSE 0 END AS is_new_session
        FROM with_gaps
    ),
    with_session_id AS (
        SELECT
            uid,
            ts,
            SUM(is_new_session) OVER (PARTITION BY uid ORDER BY ts) AS session_id
        FROM with_session_boundary
    ),
    sessions AS (
        SELECT
            uid,
            session_id,
            MIN(ts) AS session_start,
            MAX(ts) AS session_end,
            EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) / 60.0 AS duration_minutes,
            COUNT(*) AS msg_count
        FROM with_session_id
        GROUP BY uid, session_id
    ),
    multi_msg_sessions AS (
        SELECT * FROM sessions WHERE msg_count > 1
    ),
    agg AS (
        SELECT
            COALESCE(ROUND(AVG(duration_minutes)::numeric, 2), 0) AS avg_dur,
            COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_minutes)::numeric, 2), 0) AS median_dur,
            COALESCE(ROUND(MAX(duration_minutes)::numeric, 2), 0) AS max_dur
        FROM multi_msg_sessions
    ),
    totals AS (
        SELECT
            COUNT(*)::bigint AS total_sess,
            COUNT(DISTINCT uid)::bigint AS unique_users
        FROM sessions
    ),
    buckets AS (
        SELECT
            COUNT(*) FILTER (WHERE duration_minutes < 5)::bigint AS b_0_5,
            COUNT(*) FILTER (WHERE duration_minutes >= 5 AND duration_minutes < 15)::bigint AS b_5_15,
            COUNT(*) FILTER (WHERE duration_minutes >= 15 AND duration_minutes < 30)::bigint AS b_15_30,
            COUNT(*) FILTER (WHERE duration_minutes >= 30 AND duration_minutes < 60)::bigint AS b_30_60,
            COUNT(*) FILTER (WHERE duration_minutes >= 60)::bigint AS b_60_plus
        FROM sessions
    ),
    daily AS (
        SELECT
            jsonb_agg(
                jsonb_build_object(
                    'date', day_date,
                    'avg_session_minutes', ROUND(avg_dur::numeric, 2),
                    'sessions', sess_count
                ) ORDER BY day_date DESC
            ) AS daily_json
        FROM (
            SELECT
                session_start::date AS day_date,
                AVG(duration_minutes) AS avg_dur,
                COUNT(*) AS sess_count
            FROM sessions
            GROUP BY session_start::date
        ) d
    ),
    -- Top 5 users by longest single session, joined with usernames
    top_5 AS (
        SELECT
            jsonb_agg(
                jsonb_build_object(
                    'instagram_user_id', s.uid,
                    'username', COALESCE(u.instagram_username, 'unknown'),
                    'name', COALESCE(u.instagram_name, ''),
                    'longest_session_min', ROUND(s.duration_minutes::numeric, 1),
                    'total_sessions', s.sess_count,
                    'total_messages', s.total_msgs
                ) ORDER BY s.duration_minutes DESC
            ) AS top_json
        FROM (
            SELECT
                uid,
                MAX(duration_minutes) AS duration_minutes,
                COUNT(*) AS sess_count,
                SUM(msg_count) AS total_msgs
            FROM sessions
            WHERE msg_count > 1
            GROUP BY uid
            ORDER BY MAX(duration_minutes) DESC
            LIMIT 5
        ) s
        LEFT JOIN public.riya_instagram_users u ON u.instagram_user_id = s.uid
    )
    SELECT
        a.avg_dur,
        a.median_dur,
        a.max_dur,
        t.total_sess,
        CASE WHEN t.unique_users > 0
             THEN ROUND((t.total_sess::numeric / t.unique_users), 2)
             ELSE 0
        END,
        b.b_0_5,
        b.b_5_15,
        b.b_15_30,
        b.b_30_60,
        b.b_60_plus,
        COALESCE(dl.daily_json, '[]'::jsonb),
        COALESCE(tp.top_json, '[]'::jsonb)
    FROM agg a, totals t, buckets b, daily dl, top_5 tp;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_instagram_session_metrics IS
  'Computes Instagram session metrics using gap-based detection (30-min inactivity = new session). '
  'Returns avg/median/max duration, total sessions, distribution buckets, daily trend, and top 5 session users.';
