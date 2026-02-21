-- Migration: Instagram Session Time Metrics RPC
-- Created: 2026-02-20
-- Purpose: Calculate session durations from message timestamps using gap-based detection.
--          A new session starts when the gap between consecutive user messages > 30 minutes.
--          Mirrors how ChatGPT, Character AI, and Replika derive session times.

CREATE OR REPLACE FUNCTION public.get_instagram_session_metrics(days_lookback INT DEFAULT 30)
RETURNS TABLE (
    avg_session_minutes NUMERIC,
    median_session_minutes NUMERIC,
    total_sessions BIGINT,
    avg_sessions_per_user NUMERIC,
    bucket_0_5 BIGINT,
    bucket_5_15 BIGINT,
    bucket_15_30 BIGINT,
    bucket_30_60 BIGINT,
    bucket_60_plus BIGINT,
    daily_data JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH user_messages AS (
        -- Step 1: Get all USER messages for Instagram in the lookback window
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
        -- Step 2: Calculate time gap from previous message per user
        SELECT
            uid,
            ts,
            EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (PARTITION BY uid ORDER BY ts))) / 60.0 AS gap_minutes
        FROM user_messages
    ),
    with_session_boundary AS (
        -- Step 3: Mark new session when gap > 30 min or first message
        SELECT
            uid,
            ts,
            gap_minutes,
            CASE WHEN gap_minutes IS NULL OR gap_minutes > 30 THEN 1 ELSE 0 END AS is_new_session
        FROM with_gaps
    ),
    with_session_id AS (
        -- Step 4: Create session IDs via cumulative sum of boundaries
        SELECT
            uid,
            ts,
            SUM(is_new_session) OVER (PARTITION BY uid ORDER BY ts) AS session_id
        FROM with_session_boundary
    ),
    sessions AS (
        -- Step 5: Aggregate per session — duration = last_msg - first_msg
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
    -- Only sessions with >1 message for duration stats (single-msg = 0 min, skews avg)
    multi_msg_sessions AS (
        SELECT * FROM sessions WHERE msg_count > 1
    ),
    -- Aggregates
    agg AS (
        SELECT
            COALESCE(ROUND(AVG(duration_minutes)::numeric, 2), 0) AS avg_dur,
            COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_minutes)::numeric, 2), 0) AS median_dur
        FROM multi_msg_sessions
    ),
    totals AS (
        SELECT
            COUNT(*)::bigint AS total_sess,
            COUNT(DISTINCT uid)::bigint AS unique_users
        FROM sessions
    ),
    -- Distribution buckets (all sessions, including single-msg)
    buckets AS (
        SELECT
            COUNT(*) FILTER (WHERE duration_minutes < 5)::bigint AS b_0_5,
            COUNT(*) FILTER (WHERE duration_minutes >= 5 AND duration_minutes < 15)::bigint AS b_5_15,
            COUNT(*) FILTER (WHERE duration_minutes >= 15 AND duration_minutes < 30)::bigint AS b_15_30,
            COUNT(*) FILTER (WHERE duration_minutes >= 30 AND duration_minutes < 60)::bigint AS b_30_60,
            COUNT(*) FILTER (WHERE duration_minutes >= 60)::bigint AS b_60_plus
        FROM sessions
    ),
    -- Daily average session time (for trend chart)
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
    )
    SELECT
        a.avg_dur,
        a.median_dur,
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
        COALESCE(dl.daily_json, '[]'::jsonb)
    FROM agg a, totals t, buckets b, daily dl;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_instagram_session_metrics IS
  'Computes Instagram session metrics using gap-based detection (30-min inactivity = new session). '
  'Returns avg/median duration, total sessions, distribution buckets, and daily trend data.';
