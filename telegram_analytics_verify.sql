-- ============================================================
-- Telegram Analytics — Exact Verification Queries
-- Matches the metrics shown in the dashboard screenshots
-- Run each block in Supabase SQL Editor
-- ============================================================

-- ╔══════════════════════════════════════════════════════════╗
-- ║  1. TOP STAT CARDS                                       ║
-- ║  Expected: Users=17, DAU=7, MAU=17, DAU/MAU=41.2%       ║
-- ║            Total Msgs=3,818, Avg Msgs/User=224.59        ║
-- ╚══════════════════════════════════════════════════════════╝
SELECT
    COUNT(*)                                                                     AS total_users,
    COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '1 day')          AS dau,
    COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '30 days')        AS mau,
    ROUND(
        COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '1 day')::NUMERIC
        / NULLIF(COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '30 days'), 0)
        * 100, 1
    )                                                                            AS dau_mau_pct,
    SUM(message_count)                                                           AS total_messages,
    ROUND(AVG(message_count), 2)                                                 AS avg_msgs_per_user,
    ROUND(SUM(message_count) * 0.08, 2)                                          AS approx_cost_inr
FROM public.telegram_users;

-- ╔══════════════════════════════════════════════════════════╗
-- ║  2. TRIAL / PAID / FREE TIERS                            ║
-- ║  Expected: Trial=5, Paid=0, Free=12                      ║
-- ╚══════════════════════════════════════════════════════════╝
-- Trial = message_count < 50 (TG_TRIAL_LIMIT in edge function)
SELECT
    COUNT(*) FILTER (WHERE message_count < 50)                                   AS in_trial,
    COUNT(*) FILTER (WHERE message_count >= 50 AND message_credits > 0)         AS paid_users,
    COUNT(*) FILTER (WHERE message_count >= 50
        AND (message_credits IS NULL OR message_credits <= 0))                   AS free_users,
    -- Breakdown for sanity check:
    COUNT(*) FILTER (WHERE message_count < 50)
        + COUNT(*) FILTER (WHERE message_count >= 50 AND message_credits > 0)
        + COUNT(*) FILTER (WHERE message_count >= 50
            AND (message_credits IS NULL OR message_credits <= 0))               AS sum_should_equal_total
FROM public.telegram_users;

-- ╔══════════════════════════════════════════════════════════╗
-- ║  3. USER CLASSIFICATION                                  ║
-- ║  Expected: 0-10=2, 11-50=5, 51-100=1, 101-200=1         ║
-- ╚══════════════════════════════════════════════════════════╝
SELECT
    CASE
        WHEN message_count <= 10  THEN '0-10 msgs'
        WHEN message_count <= 50  THEN '11-50 msgs'
        WHEN message_count <= 100 THEN '51-100 msgs'
        WHEN message_count <= 200 THEN '101-200 msgs'
        WHEN message_count <= 500 THEN '201-500 msgs'
        ELSE '500+ msgs'
    END                AS tier,
    COUNT(*)           AS count,
    -- Show which users are in each tier
    STRING_AGG(COALESCE(first_name, telegram_user_id), ', ' ORDER BY message_count) AS users
FROM public.telegram_users
GROUP BY 1
ORDER BY MIN(message_count);

-- ╔══════════════════════════════════════════════════════════╗
-- ║  4. RETENTION                                            ║
-- ║  Expected: D1=58.82%, D3=43.75%, D7=41.67%, D30=0%      ║
-- ╚══════════════════════════════════════════════════════════╝
-- The edge function uses: retained = users whose last_message_at >= created_at + N days
-- Eligible = users whose account is older than N days
SELECT
    'D1' AS period,
    COUNT(*)                                                                     AS eligible,
    COUNT(*) FILTER (WHERE last_message_at >= created_at + INTERVAL '1 day')    AS retained,
    ROUND(
        COUNT(*) FILTER (WHERE last_message_at >= created_at + INTERVAL '1 day')::NUMERIC
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day'), 0) * 100, 2
    )                                                                            AS retention_pct
FROM public.telegram_users
WHERE created_at <= NOW() - INTERVAL '1 day'
UNION ALL
SELECT 'D3',
    COUNT(*),
    COUNT(*) FILTER (WHERE last_message_at >= created_at + INTERVAL '3 days'),
    ROUND(COUNT(*) FILTER (WHERE last_message_at >= created_at + INTERVAL '3 days')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 2)
FROM public.telegram_users WHERE created_at <= NOW() - INTERVAL '3 days'
UNION ALL
SELECT 'D7',
    COUNT(*),
    COUNT(*) FILTER (WHERE last_message_at >= created_at + INTERVAL '7 days'),
    ROUND(COUNT(*) FILTER (WHERE last_message_at >= created_at + INTERVAL '7 days')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 2)
FROM public.telegram_users WHERE created_at <= NOW() - INTERVAL '7 days'
UNION ALL
SELECT 'D30',
    COUNT(*),
    COUNT(*) FILTER (WHERE last_message_at >= created_at + INTERVAL '30 days'),
    ROUND(COUNT(*) FILTER (WHERE last_message_at >= created_at + INTERVAL '30 days')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 2)
FROM public.telegram_users WHERE created_at <= NOW() - INTERVAL '30 days';

-- ╔══════════════════════════════════════════════════════════╗
-- ║  5. PAYMENT FUNNEL                                       ║
-- ║  Expected: Page Visits=12, Unique=5, Clicks=2, Paid=0   ║
-- ╚══════════════════════════════════════════════════════════╝
SELECT
    event_type,
    COUNT(*)                                                          AS total_events,
    COUNT(DISTINCT metadata->>'telegram_user_id')                     AS unique_users
FROM public.riya_payment_events
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND (
      metadata->>'platform' = 'telegram'
      OR (metadata->>'telegram_user_id') IS NOT NULL
  )
GROUP BY event_type
ORDER BY total_events DESC;

-- ╔══════════════════════════════════════════════════════════╗
-- ║  6. RECENT PAYMENT PAGE VISITORS (with usernames)        ║
-- ║  Expected: 5 visitors — Y/@Jk86554, Miten, Sjsjs,       ║
-- ║            Sukhveer, Dashrath                            ║
-- ╚══════════════════════════════════════════════════════════╝
SELECT DISTINCT ON (e.metadata->>'telegram_user_id')
    e.metadata->>'telegram_user_id'    AS tg_id,
    tu.first_name,
    tu.telegram_username,
    tu.message_count,
    tu.message_credits,
    MAX(e.created_at)
        OVER (PARTITION BY e.metadata->>'telegram_user_id') AS last_visit_at,
    COUNT(*)
        OVER (PARTITION BY e.metadata->>'telegram_user_id') AS visit_count
FROM public.riya_payment_events e
LEFT JOIN public.telegram_users tu
    ON tu.telegram_user_id = e.metadata->>'telegram_user_id'
WHERE e.event_type = 'page_visit'
  AND e.created_at >= NOW() - INTERVAL '30 days'
  AND (
      e.metadata->>'platform' = 'telegram'
      OR (e.metadata->>'telegram_user_id') IS NOT NULL
  )
ORDER BY e.metadata->>'telegram_user_id', e.created_at DESC;

-- ╔══════════════════════════════════════════════════════════╗
-- ║  7. AGGREGATE METRICS (30d rolling)                      ║
-- ║  Expected: Avg DAU=5, MAU=18, Stickiness=29.9%          ║
-- ║            Avg New/Day=1, Total New=14                   ║
-- ║            Today DAU=5, 7d Avg DAU=6                     ║
-- ╚══════════════════════════════════════════════════════════╝

-- MAU (unique active users in last 30 days via riya_conversations)
SELECT COUNT(DISTINCT telegram_user_id) AS mau_30d
FROM public.riya_conversations
WHERE source = 'telegram'
  AND role = 'user'
  AND telegram_user_id IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days';

-- Daily DAU from conversations (for avg calculation)
SELECT
    (created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day,
    COUNT(DISTINCT telegram_user_id)                AS dau
FROM public.riya_conversations
WHERE source = 'telegram'
  AND role = 'user'
  AND telegram_user_id IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- Avg DAU + Stickiness (avg DAU / MAU)
WITH daily AS (
    SELECT
        (created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day,
        COUNT(DISTINCT telegram_user_id)                AS dau
    FROM public.riya_conversations
    WHERE source = 'telegram'
      AND role = 'user'
      AND telegram_user_id IS NOT NULL
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY 1
),
mau AS (
    SELECT COUNT(DISTINCT telegram_user_id) AS mau
    FROM public.riya_conversations
    WHERE source = 'telegram'
      AND role = 'user'
      AND telegram_user_id IS NOT NULL
      AND created_at >= NOW() - INTERVAL '30 days'
)
SELECT
    ROUND(AVG(d.dau), 1)                          AS avg_dau,
    m.mau,
    ROUND(AVG(d.dau) / NULLIF(m.mau, 0) * 100, 1) AS stickiness_pct,
    -- Today's DAU
    MAX(d.dau) FILTER (WHERE d.day = CURRENT_DATE) AS today_dau,
    -- 7d avg DAU
    ROUND(AVG(d.dau) FILTER (WHERE d.day >= CURRENT_DATE - 6), 1) AS seven_day_avg_dau
FROM daily d, mau m
GROUP BY m.mau;

-- New users per day (for Avg New/Day and total)
SELECT
    created_at::DATE                                                   AS signup_date,
    COUNT(*)                                                           AS new_users,
    STRING_AGG(COALESCE(first_name, telegram_user_id), ', ')          AS names
FROM public.telegram_users
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- Total new users in period
SELECT COUNT(*) AS total_new_30d FROM public.telegram_users
WHERE created_at >= NOW() - INTERVAL '30 days';

-- ╔══════════════════════════════════════════════════════════╗
-- ║  8. DAILY OVERVIEW CHART                                 ║
-- ║  (messages + active_users per day, last 30 days)         ║
-- ╚══════════════════════════════════════════════════════════╝
SELECT
    (created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS activity_date,
    COUNT(DISTINCT telegram_user_id)                AS active_users,
    COUNT(*)                                        AS messages,
    ROUND(COUNT(*) * 0.08, 2)                       AS approx_cost_inr
FROM public.riya_conversations
WHERE source = 'telegram'
  AND role = 'user'
  AND telegram_user_id IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- ╔══════════════════════════════════════════════════════════╗
-- ║  9. PER-USER MESSAGE BREAKDOWN (for spot-checking)       ║
-- ║  Shows every TG user and their stats                     ║
-- ╚══════════════════════════════════════════════════════════╝
SELECT
    telegram_user_id,
    COALESCE(telegram_username, '—')               AS username,
    COALESCE(first_name, '—')                      AS first_name,
    message_count,
    message_credits,
    CASE
        WHEN message_count < 50                               THEN 'trial'
        WHEN message_credits > 0                              THEN 'paid'
        ELSE 'free'
    END                                             AS plan,
    last_message_at,
    created_at,
    EXTRACT(DAY FROM NOW() - created_at)::INT       AS account_age_days
FROM public.telegram_users
ORDER BY message_count DESC;
