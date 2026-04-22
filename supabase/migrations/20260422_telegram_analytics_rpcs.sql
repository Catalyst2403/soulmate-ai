-- ============================================================
-- MIGRATION: Telegram Analytics RPCs
-- Date: 2026-04-22
-- Creates get_telegram_daily_activity and
-- get_telegram_aggregate_metrics, mirroring the IG equivalents.
-- ============================================================

-- ── 1. Daily activity: active users + message counts per day ──────────────────
CREATE OR REPLACE FUNCTION public.get_telegram_daily_activity(days_lookback INTEGER DEFAULT 30)
RETURNS TABLE (
    activity_date   DATE,
    active_users    BIGINT,
    message_count   BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT
        (created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS activity_date,
        COUNT(DISTINCT telegram_user_id)                AS active_users,
        COUNT(*)                                        AS message_count
    FROM public.riya_conversations
    WHERE
        source         = 'telegram'
        AND role       = 'user'
        AND telegram_user_id IS NOT NULL
        AND created_at >= NOW() - (days_lookback || ' days')::INTERVAL
    GROUP BY 1
    ORDER BY 1 DESC;
$$;

-- ── 2. Aggregate metrics: rolling averages, MAU, revenue breakdown ────────────
CREATE OR REPLACE FUNCTION public.get_telegram_aggregate_metrics(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    avg_dau                 NUMERIC,
    mau                     BIGINT,
    avg_dau_mau_ratio       NUMERIC,
    avg_new_users_per_day   NUMERIC,
    total_new_users_period  BIGINT,
    avg_msgs_per_active_day NUMERIC,
    total_revenue_period    BIGINT,   -- in paise (×100)
    avg_revenue_per_day     NUMERIC,  -- in paise
    daily_breakdown         JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_since         TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
    v_mau           BIGINT;
    v_avg_dau       NUMERIC;
    v_avg_new       NUMERIC;
    v_total_new     BIGINT;
    v_avg_msgs      NUMERIC;
    v_total_rev     BIGINT;
    v_avg_rev       NUMERIC;
    v_breakdown     JSONB;
BEGIN
    -- MAU: distinct Telegram users active in the period
    SELECT COUNT(DISTINCT telegram_user_id) INTO v_mau
    FROM public.riya_conversations
    WHERE source = 'telegram'
      AND role = 'user'
      AND telegram_user_id IS NOT NULL
      AND created_at >= v_since;

    -- Per-day DAU + messages + new users + revenue
    SELECT
        AVG(daily_dau),
        AVG(daily_msgs),
        SUM(new_users),
        COALESCE(SUM(daily_rev), 0),
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'date',      act_date,
                'dau',       daily_dau,
                'messages',  daily_msgs,
                'new_users', new_users,
                'revenue',   daily_rev
            )
            ORDER BY act_date
        )
    INTO v_avg_dau, v_avg_msgs, v_total_new, v_total_rev, v_breakdown
    FROM (
        SELECT
            (c.created_at AT TIME ZONE 'Asia/Kolkata')::DATE        AS act_date,
            COUNT(DISTINCT c.telegram_user_id)                      AS daily_dau,
            COUNT(*)                                                 AS daily_msgs,
            COUNT(DISTINCT tu.telegram_user_id)
                FILTER (WHERE (tu.created_at AT TIME ZONE 'Asia/Kolkata')::DATE =
                              (c.created_at AT TIME ZONE 'Asia/Kolkata')::DATE)  AS new_users,
            COALESCE(SUM(rp.amount) FILTER (
                WHERE (rp.created_at AT TIME ZONE 'Asia/Kolkata')::DATE =
                      (c.created_at AT TIME ZONE 'Asia/Kolkata')::DATE
            ), 0)                                                    AS daily_rev
        FROM public.riya_conversations c
        LEFT JOIN public.telegram_users tu
            ON tu.telegram_user_id = c.telegram_user_id
        LEFT JOIN public.riya_payments rp
            ON rp.telegram_user_id = c.telegram_user_id
           AND rp.status = 'captured'
        WHERE c.source = 'telegram'
          AND c.role   = 'user'
          AND c.telegram_user_id IS NOT NULL
          AND c.created_at >= v_since
        GROUP BY 1
    ) d;

    v_total_new  := COALESCE(v_total_new, 0);
    v_avg_new    := CASE WHEN p_days > 0 THEN v_total_new::NUMERIC / p_days ELSE 0 END;
    v_avg_rev    := CASE WHEN p_days > 0 THEN v_total_rev::NUMERIC / p_days ELSE 0 END;
    v_avg_dau    := COALESCE(v_avg_dau, 0);
    v_avg_msgs   := COALESCE(v_avg_msgs, 0);
    v_breakdown  := COALESCE(v_breakdown, '[]'::JSONB);

    RETURN QUERY SELECT
        ROUND(v_avg_dau, 1),
        v_mau,
        CASE WHEN v_mau > 0 THEN ROUND((v_avg_dau / v_mau) * 100, 1) ELSE 0 END,
        ROUND(v_avg_new, 1),
        v_total_new,
        ROUND(v_avg_msgs, 1),
        v_total_rev,
        ROUND(v_avg_rev, 2),
        v_breakdown;
END;
$$;
