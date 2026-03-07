-- Migration: Aggregate Metrics RPCs
-- Created: 2026-03-06
-- Purpose: Cohort-based retention (D1/D2/D7/D30), rolling avg DAU/MAU, blended metrics
--
-- RETENTION METHODOLOGY:
--   "D1 retention" = % of users who were ACTIVE on day 1 after signup
--   (i.e., they sent at least one message in [signup+1day, signup+2days))
--   This is the *industry-standard cohort retention*, NOT just "ever came back after day 1"
--
--   "Rolling avg DAU (30d)" = average of daily unique active users over the last 30 days
--   "Rolling avg MAU"       = unique users active in the last 30 days (this IS MAU by defn)
--   "Avg DAU/MAU"           = avg DAU / MAU (stickiness ratio, target >20% for PMF)

-- ============================================================
-- RPC 1: Instagram Cohort Retention (D1, D2, D7, D30)
-- ============================================================
-- Uses riya_conversations (source='instagram') to check if a user
-- sent messages in the target day window after signup.
-- This is more accurate than last_message_at which only stores the LATEST.

CREATE OR REPLACE FUNCTION public.get_instagram_cohort_retention()
RETURNS TABLE (
    d1_eligible   BIGINT,
    d1_retained   BIGINT,
    d1_rate       NUMERIC,
    d2_eligible   BIGINT,
    d2_retained   BIGINT,
    d2_rate       NUMERIC,
    d7_eligible   BIGINT,
    d7_retained   BIGINT,
    d7_rate       NUMERIC,
    d30_eligible  BIGINT,
    d30_retained  BIGINT,
    d30_rate      NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH cohort AS (
        -- Get each IG user's signup date
        SELECT
            instagram_user_id,
            created_at AS signup_at
        FROM public.riya_instagram_users
    ),
    -- For each retention day, check if user sent >=1 message in that day's window
    d1_check AS (
        SELECT c.instagram_user_id
        FROM cohort c
        WHERE c.signup_at <= NOW() - INTERVAL '1 day'  -- must have been signed up >=1 day ago
          AND EXISTS (
              SELECT 1 FROM public.riya_conversations rv
              WHERE rv.instagram_user_id = c.instagram_user_id
                AND rv.role = 'user'
                AND rv.source = 'instagram'
                AND rv.created_at >= c.signup_at + INTERVAL '1 day'
                AND rv.created_at <  c.signup_at + INTERVAL '2 days'
          )
    ),
    d2_check AS (
        SELECT c.instagram_user_id
        FROM cohort c
        WHERE c.signup_at <= NOW() - INTERVAL '2 days'
          AND EXISTS (
              SELECT 1 FROM public.riya_conversations rv
              WHERE rv.instagram_user_id = c.instagram_user_id
                AND rv.role = 'user'
                AND rv.source = 'instagram'
                AND rv.created_at >= c.signup_at + INTERVAL '2 days'
                AND rv.created_at <  c.signup_at + INTERVAL '3 days'
          )
    ),
    d7_check AS (
        SELECT c.instagram_user_id
        FROM cohort c
        WHERE c.signup_at <= NOW() - INTERVAL '7 days'
          AND EXISTS (
              SELECT 1 FROM public.riya_conversations rv
              WHERE rv.instagram_user_id = c.instagram_user_id
                AND rv.role = 'user'
                AND rv.source = 'instagram'
                AND rv.created_at >= c.signup_at + INTERVAL '7 days'
                AND rv.created_at <  c.signup_at + INTERVAL '8 days'
          )
    ),
    d30_check AS (
        SELECT c.instagram_user_id
        FROM cohort c
        WHERE c.signup_at <= NOW() - INTERVAL '30 days'
          AND EXISTS (
              SELECT 1 FROM public.riya_conversations rv
              WHERE rv.instagram_user_id = c.instagram_user_id
                AND rv.role = 'user'
                AND rv.source = 'instagram'
                AND rv.created_at >= c.signup_at + INTERVAL '30 days'
                AND rv.created_at <  c.signup_at + INTERVAL '31 days'
          )
    ),
    eligibles AS (
        SELECT
            COUNT(*) FILTER (WHERE signup_at <= NOW() - INTERVAL '1 day')  AS elig_d1,
            COUNT(*) FILTER (WHERE signup_at <= NOW() - INTERVAL '2 days') AS elig_d2,
            COUNT(*) FILTER (WHERE signup_at <= NOW() - INTERVAL '7 days') AS elig_d7,
            COUNT(*) FILTER (WHERE signup_at <= NOW() - INTERVAL '30 days') AS elig_d30
        FROM cohort
    )
    SELECT
        e.elig_d1::BIGINT,
        COUNT(DISTINCT d1.instagram_user_id)::BIGINT,
        CASE WHEN e.elig_d1 > 0
             THEN ROUND((COUNT(DISTINCT d1.instagram_user_id)::NUMERIC / e.elig_d1) * 100, 2)
             ELSE 0 END,

        e.elig_d2::BIGINT,
        COUNT(DISTINCT d2.instagram_user_id)::BIGINT,
        CASE WHEN e.elig_d2 > 0
             THEN ROUND((COUNT(DISTINCT d2.instagram_user_id)::NUMERIC / e.elig_d2) * 100, 2)
             ELSE 0 END,

        e.elig_d7::BIGINT,
        COUNT(DISTINCT d7.instagram_user_id)::BIGINT,
        CASE WHEN e.elig_d7 > 0
             THEN ROUND((COUNT(DISTINCT d7.instagram_user_id)::NUMERIC / e.elig_d7) * 100, 2)
             ELSE 0 END,

        e.elig_d30::BIGINT,
        COUNT(DISTINCT d30.instagram_user_id)::BIGINT,
        CASE WHEN e.elig_d30 > 0
             THEN ROUND((COUNT(DISTINCT d30.instagram_user_id)::NUMERIC / e.elig_d30) * 100, 2)
             ELSE 0 END
    FROM eligibles e
    LEFT JOIN d1_check  d1  ON TRUE
    LEFT JOIN d2_check  d2  ON TRUE
    LEFT JOIN d7_check  d7  ON TRUE
    LEFT JOIN d30_check d30 ON TRUE
    GROUP BY e.elig_d1, e.elig_d2, e.elig_d7, e.elig_d30;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_instagram_cohort_retention IS
  'Cohort-based retention: checks if IG user sent a message on day N (±1 day window) after signup. '
  'Industry-standard metric used by Amplitude, Mixpanel, etc. '
  'D1 = % of users active on day 1 after signup, D2 = day 2, D7 = day 7, D30 = day 30.';


-- ============================================================
-- RPC 2: Instagram Rolling Aggregate Metrics (avg DAU, MAU, etc.)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_instagram_aggregate_metrics(p_days INT DEFAULT 30)
RETURNS TABLE (
    -- Rolling averages
    avg_dau             NUMERIC,   -- avg daily active users over last p_days
    mau                 BIGINT,    -- unique users active in last 30 days (= MAU)
    avg_dau_mau_ratio   NUMERIC,   -- avg_dau / mau * 100 (stickiness %)

    -- Daily new users
    avg_new_users_per_day NUMERIC,
    total_new_users_period BIGINT,

    -- Engagement averages
    avg_msgs_per_active_day NUMERIC,  -- avg messages per day (over active days)

    -- Revenue aggregates
    total_revenue_period   NUMERIC,   -- sum of amount_paid in period (paise)
    avg_revenue_per_day    NUMERIC,   -- avg daily revenue in period

    -- Per-day breakdown (for sparklines / charts)
    daily_breakdown JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH period_start AS (
        SELECT NOW() - (p_days || ' days')::INTERVAL AS cutoff
    ),
    -- Daily active users: unique IG users who sent at least 1 msg per day
    daily_active AS (
        SELECT
            (rc.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
            COUNT(DISTINCT rc.instagram_user_id) AS dau_count,
            COUNT(*) FILTER (WHERE rc.role = 'user') AS msg_count
        FROM public.riya_conversations rc, period_start ps
        WHERE rc.source = 'instagram'
          AND rc.role = 'user'
          AND rc.instagram_user_id IS NOT NULL
          AND rc.created_at >= ps.cutoff
        GROUP BY day
    ),
    -- MAU = unique users active in the last 30 days  
    mau_calc AS (
        SELECT COUNT(DISTINCT rc.instagram_user_id)::BIGINT AS mau_count
        FROM public.riya_conversations rc, period_start ps
        WHERE rc.source = 'instagram'
          AND rc.role = 'user'
          AND rc.instagram_user_id IS NOT NULL
          AND rc.created_at >= ps.cutoff
    ),
    -- New users per day
    new_users_daily AS (
        SELECT
            (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
            COUNT(*) AS new_count
        FROM public.riya_instagram_users, period_start ps
        WHERE created_at >= ps.cutoff
        GROUP BY day
    ),
    -- Revenue per day (from riya_subscriptions, IG only)
    revenue_daily AS (
        SELECT
            (starts_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
            SUM(amount_paid) AS rev
        FROM public.riya_subscriptions, period_start ps
        WHERE instagram_user_id IS NOT NULL
          AND starts_at IS NOT NULL
          AND starts_at >= ps.cutoff
        GROUP BY day
    ),
    -- Per-day JSON for sparklines
    daily_json AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'date',         da.day,
                'dau',          da.dau_count,
                'messages',     da.msg_count,
                'new_users',    COALESCE(nu.new_count, 0),
                'revenue',      COALESCE(rd.rev, 0)
            ) ORDER BY da.day DESC
        ) AS breakdown
        FROM daily_active da
        LEFT JOIN new_users_daily nu ON nu.day = da.day
        LEFT JOIN revenue_daily   rd ON rd.day = da.day
    )
    SELECT
        -- avg DAU = average of per-day DAU counts
        COALESCE(ROUND(AVG(da.dau_count)::NUMERIC, 2), 0),

        -- MAU
        m.mau_count,

        -- avg DAU/MAU stickiness %
        CASE WHEN m.mau_count > 0
             THEN ROUND((AVG(da.dau_count)::NUMERIC / m.mau_count) * 100, 2)
             ELSE 0 END,

        -- avg new users per day
        COALESCE(ROUND(AVG(COALESCE(nu.new_count, 0))::NUMERIC, 2), 0),

        -- total new users in period
        COALESCE(SUM(COALESCE(nu.new_count, 0))::BIGINT, 0),

        -- avg messages per day (on active days)
        COALESCE(ROUND(AVG(da.msg_count)::NUMERIC, 2), 0),

        -- total revenue in period
        COALESCE((SELECT SUM(rev) FROM revenue_daily), 0),

        -- avg daily revenue
        COALESCE(ROUND((SELECT AVG(COALESCE(rev,0)) FROM revenue_daily)::NUMERIC, 2), 0),

        -- daily breakdown JSON
        COALESCE(dj.breakdown, '[]'::JSONB)

    FROM daily_active da
    CROSS JOIN mau_calc m
    LEFT JOIN new_users_daily nu ON nu.day = da.day
    CROSS JOIN daily_json dj
    GROUP BY m.mau_count, dj.breakdown;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_instagram_aggregate_metrics IS
  'Rolling aggregate metrics for Instagram: avg DAU over N days, MAU (unique users in 30d), '
  'stickiness ratio (avg DAU/MAU), avg new users/day, revenue aggregates. '
  'Uses IST timezone for day boundaries.';


-- ============================================================
-- RPC 3: Instagram Daily Activity (adds new_users column)
-- Must DROP first because return type changes (new_users column added).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_instagram_daily_activity(INT);

CREATE OR REPLACE FUNCTION public.get_instagram_daily_activity(days_lookback INT DEFAULT 30)
RETURNS TABLE (
    activity_date  DATE,
    active_users   BIGINT,
    message_count  BIGINT,
    new_users      BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH period_start AS (
        SELECT NOW() - (days_lookback || ' days')::INTERVAL AS cutoff
    ),
    msgs AS (
        SELECT
            (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
            COUNT(DISTINCT instagram_user_id) AS uniq_users,
            COUNT(*) AS msgs
        FROM public.riya_conversations, period_start ps
        WHERE source = 'instagram'
          AND role = 'user'
          AND instagram_user_id IS NOT NULL
          AND created_at >= ps.cutoff
        GROUP BY day
    ),
    new_u AS (
        SELECT
            (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
            COUNT(*) AS cnt
        FROM public.riya_instagram_users, period_start ps
        WHERE created_at >= ps.cutoff
        GROUP BY day
    )
    SELECT
        m.day,
        m.uniq_users,
        m.msgs,
        COALESCE(n.cnt, 0)
    FROM msgs m
    LEFT JOIN new_u n ON n.day = m.day
    ORDER BY m.day DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_instagram_daily_activity IS
  'Per-day IG metrics: active users (unique senders), message count, new signups. Uses IST timezone.';
