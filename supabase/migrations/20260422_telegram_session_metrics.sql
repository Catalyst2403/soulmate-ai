-- ============================================================
-- MIGRATION: Telegram Session Metrics RPC
-- Date: 2026-04-22
-- Mirrors get_instagram_session_metrics exactly.
-- Session definition: 30-min inactivity gap = new session.
-- Only counts sessions with >1 message (to exclude single-ping sessions).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_telegram_session_metrics(days_lookback INT DEFAULT 30)
RETURNS TABLE (
    avg_session_minutes    NUMERIC,
    median_session_minutes NUMERIC,
    max_session_minutes    NUMERIC,
    total_sessions         BIGINT,
    avg_sessions_per_user  NUMERIC,
    bucket_0_5             BIGINT,
    bucket_5_15            BIGINT,
    bucket_15_30           BIGINT,
    bucket_30_60           BIGINT,
    bucket_60_plus         BIGINT,
    daily_data             JSONB,
    top_sessions           JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH user_messages AS (
        -- All user messages from Telegram in the lookback window
        SELECT
            telegram_user_id AS uid,
            created_at       AS ts
        FROM public.riya_conversations
        WHERE source           = 'telegram'
          AND role             = 'user'
          AND telegram_user_id IS NOT NULL
          AND created_at       >= NOW() - (days_lookback || ' days')::INTERVAL
        ORDER BY telegram_user_id, created_at
    ),
    with_gaps AS (
        -- Gap in minutes since the previous message by the same user
        SELECT
            uid,
            ts,
            EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (PARTITION BY uid ORDER BY ts))) / 60.0 AS gap_minutes
        FROM user_messages
    ),
    with_session_boundary AS (
        -- Mark a new session whenever gap > 30 min or it's the first message
        SELECT
            uid,
            ts,
            gap_minutes,
            CASE WHEN gap_minutes IS NULL OR gap_minutes > 30 THEN 1 ELSE 0 END AS is_new_session
        FROM with_gaps
    ),
    with_session_id AS (
        -- Assign a running session number per user
        SELECT
            uid,
            ts,
            SUM(is_new_session) OVER (PARTITION BY uid ORDER BY ts) AS session_id
        FROM with_session_boundary
    ),
    sessions AS (
        -- Collapse to one row per session: start, end, duration, message count
        SELECT
            uid,
            session_id,
            MIN(ts)                                                    AS session_start,
            MAX(ts)                                                    AS session_end,
            EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) / 60.0            AS duration_minutes,
            COUNT(*)                                                   AS msg_count
        FROM with_session_id
        GROUP BY uid, session_id
    ),
    -- Only multi-message sessions for avg/median/max (single-ping sessions have 0 duration)
    multi_msg_sessions AS (
        SELECT * FROM sessions WHERE msg_count > 1
    ),
    agg AS (
        SELECT
            COALESCE(ROUND(AVG(duration_minutes)::numeric, 2), 0)                                AS avg_dur,
            COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_minutes)::numeric, 2), 0) AS median_dur,
            COALESCE(ROUND(MAX(duration_minutes)::numeric, 2), 0)                                AS max_dur
        FROM multi_msg_sessions
    ),
    totals AS (
        SELECT
            COUNT(*)::bigint          AS total_sess,
            COUNT(DISTINCT uid)::bigint AS unique_users
        FROM sessions
    ),
    buckets AS (
        SELECT
            COUNT(*) FILTER (WHERE duration_minutes < 5)::bigint                              AS b_0_5,
            COUNT(*) FILTER (WHERE duration_minutes >= 5  AND duration_minutes < 15)::bigint  AS b_5_15,
            COUNT(*) FILTER (WHERE duration_minutes >= 15 AND duration_minutes < 30)::bigint  AS b_15_30,
            COUNT(*) FILTER (WHERE duration_minutes >= 30 AND duration_minutes < 60)::bigint  AS b_30_60,
            COUNT(*) FILTER (WHERE duration_minutes >= 60)::bigint                            AS b_60_plus
        FROM sessions
    ),
    daily AS (
        SELECT
            jsonb_agg(
                jsonb_build_object(
                    'date',                d.day_date,
                    'avg_session_minutes', ROUND(d.avg_dur::numeric, 2),
                    'sessions',            d.sess_count
                ) ORDER BY d.day_date DESC
            ) AS daily_json
        FROM (
            SELECT
                session_start::date AS day_date,
                AVG(duration_minutes) AS avg_dur,
                COUNT(*)              AS sess_count
            FROM sessions
            GROUP BY session_start::date
        ) d
    ),
    -- Top 5 users by longest single session, joined with telegram usernames
    top_5 AS (
        SELECT
            jsonb_agg(
                jsonb_build_object(
                    'telegram_user_id',    s.uid,
                    'username',            COALESCE(tu.telegram_username, s.uid),
                    'name',                COALESCE(tu.first_name, 'Telegram User'),
                    'longest_session_min', ROUND(s.duration_minutes::numeric, 1),
                    'total_sessions',      s.sess_count,
                    'total_messages',      s.total_msgs
                ) ORDER BY s.duration_minutes DESC
            ) AS top_json
        FROM (
            SELECT
                uid,
                MAX(duration_minutes) AS duration_minutes,
                COUNT(*)              AS sess_count,
                SUM(msg_count)        AS total_msgs
            FROM sessions
            WHERE msg_count > 1
            GROUP BY uid
            ORDER BY MAX(duration_minutes) DESC
            LIMIT 5
        ) s
        LEFT JOIN public.telegram_users tu ON tu.telegram_user_id = s.uid
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

COMMENT ON FUNCTION public.get_telegram_session_metrics IS
  'Computes Telegram session metrics using gap-based detection (30-min inactivity = new session). '
  'Returns avg/median/max duration, total sessions, distribution buckets, daily trend, and top 5 session users. '
  'Mirrors get_instagram_session_metrics exactly.';
