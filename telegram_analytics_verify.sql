-- ============================================================
-- Telegram Analytics Verification SQLs
-- Run these in Supabase SQL Editor to verify dashboard data
-- ============================================================

-- ── 1. TOTAL USERS + DAU + MAU ────────────────────────────────────────────────
SELECT
    COUNT(*)                                                          AS total_users,
    COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '1 day')  AS dau,
    COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '30 days') AS mau,
    ROUND(
        COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '1 day')::NUMERIC
        / NULLIF(COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '30 days'), 0) * 100,
        1
    )                                                                  AS dau_mau_ratio_pct
FROM public.telegram_users;

-- ── 2. PLAN TIERS (trial / paid / free) ──────────────────────────────────────
SELECT
    COUNT(*) FILTER (WHERE message_count < 50)               AS in_trial,
    COUNT(*) FILTER (WHERE message_count >= 50 AND message_credits > 0) AS paid_users,
    COUNT(*) FILTER (WHERE message_count >= 50 AND (message_credits IS NULL OR message_credits = 0)) AS free_users,
    SUM(message_count)                                        AS total_messages,
    ROUND(AVG(message_count), 2)                              AS avg_msgs_per_user,
    ROUND(SUM(message_count) * 0.08, 2)                      AS approx_cost_inr
FROM public.telegram_users;

-- ── 3. USER CLASSIFICATION TIERS ─────────────────────────────────────────────
SELECT
    CASE
        WHEN message_count <= 10  THEN '0-10 msgs'
        WHEN message_count <= 50  THEN '11-50 msgs'
        WHEN message_count <= 100 THEN '51-100 msgs'
        WHEN message_count <= 200 THEN '101-200 msgs'
        WHEN message_count <= 500 THEN '201-500 msgs'
        ELSE '500+ msgs'
    END AS tier,
    COUNT(*) AS user_count
FROM public.telegram_users
GROUP BY 1
ORDER BY MIN(message_count);

-- ── 4. DAILY ACTIVITY (last 30 days) ─────────────────────────────────────────
SELECT
    (created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS activity_date,
    COUNT(DISTINCT telegram_user_id)                AS active_users,
    COUNT(*)                                        AS messages_sent
FROM public.riya_conversations
WHERE source = 'telegram'
  AND role   = 'user'
  AND telegram_user_id IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- ── 5. RETENTION (approximate, based on last_message_at) ─────────────────────
SELECT
    'D1'                                                                AS period,
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day')     AS eligible,
    COUNT(*) FILTER (
        WHERE created_at <= NOW() - INTERVAL '1 day'
          AND last_message_at >= created_at + INTERVAL '1 day'
    )                                                                   AS retained,
    ROUND(
        COUNT(*) FILTER (
            WHERE created_at <= NOW() - INTERVAL '1 day'
              AND last_message_at >= created_at + INTERVAL '1 day'
        )::NUMERIC
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day'), 0) * 100,
        2
    )                                                                   AS retention_pct
FROM public.telegram_users
UNION ALL
SELECT 'D3',
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '3 days'),
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '3 days' AND last_message_at >= created_at + INTERVAL '3 days'),
    ROUND(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '3 days' AND last_message_at >= created_at + INTERVAL '3 days')::NUMERIC
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '3 days'), 0) * 100, 2)
FROM public.telegram_users
UNION ALL
SELECT 'D7',
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days'),
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' AND last_message_at >= created_at + INTERVAL '7 days'),
    ROUND(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' AND last_message_at >= created_at + INTERVAL '7 days')::NUMERIC
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days'), 0) * 100, 2)
FROM public.telegram_users
UNION ALL
SELECT 'D30',
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days'),
    COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days' AND last_message_at >= created_at + INTERVAL '30 days'),
    ROUND(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days' AND last_message_at >= created_at + INTERVAL '30 days')::NUMERIC
        / NULLIF(COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days'), 0) * 100, 2)
FROM public.telegram_users;

-- ── 6. NEW USERS PER DAY ─────────────────────────────────────────────────────
SELECT
    created_at::DATE AS signup_date,
    COUNT(*)         AS new_users
FROM public.telegram_users
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- ── 7. PAID USERS (with credits > 0) ─────────────────────────────────────────
SELECT
    telegram_user_id,
    COALESCE(telegram_username, telegram_user_id) AS username,
    first_name,
    message_count,
    message_credits,
    total_credits_purchased,
    created_at
FROM public.telegram_users
WHERE message_credits > 0
ORDER BY message_count DESC;

-- ── 8. TOTAL REVENUE (from riya_payments, Telegram only) ─────────────────────
SELECT
    COUNT(*)            AS total_payments,
    SUM(amount) / 100.0 AS total_revenue_inr,
    AVG(amount) / 100.0 AS avg_payment_inr
FROM public.riya_payments
WHERE telegram_user_id IS NOT NULL
  AND status = 'captured';

-- Revenue by day (last 30 days)
SELECT
    created_at::DATE    AS payment_date,
    COUNT(*)            AS payments,
    SUM(amount) / 100.0 AS revenue_inr
FROM public.riya_payments
WHERE telegram_user_id IS NOT NULL
  AND status = 'captured'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- ── 9. PAYMENT FUNNEL ─────────────────────────────────────────────────────────
-- All Telegram payment events (last 30 days)
SELECT
    event_type,
    COUNT(*)                                     AS event_count,
    COUNT(DISTINCT metadata->>'telegram_user_id') AS unique_users
FROM public.riya_payment_events
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND (metadata->>'platform' = 'telegram' OR metadata->>'telegram_user_id' IS NOT NULL)
GROUP BY 1
ORDER BY 2 DESC;

-- ── 10. RECENT PAYMENT PAGE VISITORS with usernames ──────────────────────────
SELECT DISTINCT ON (e.metadata->>'telegram_user_id')
    e.metadata->>'telegram_user_id'              AS telegram_user_id,
    tu.telegram_username,
    tu.first_name,
    tu.message_count,
    tu.message_credits,
    MAX(e.created_at) OVER (PARTITION BY e.metadata->>'telegram_user_id') AS last_visit,
    COUNT(*) OVER (PARTITION BY e.metadata->>'telegram_user_id')          AS visit_count
FROM public.riya_payment_events e
LEFT JOIN public.telegram_users tu
    ON tu.telegram_user_id = e.metadata->>'telegram_user_id'
WHERE e.event_type = 'page_visit'
  AND e.created_at >= NOW() - INTERVAL '30 days'
  AND (e.metadata->>'platform' = 'telegram' OR e.metadata->>'telegram_user_id' IS NOT NULL)
ORDER BY e.metadata->>'telegram_user_id', e.created_at DESC;

-- ── 11. FULL FUNNEL PER USER (who visited, who clicked, who paid) ─────────────
WITH events AS (
    SELECT
        metadata->>'telegram_user_id' AS tg_id,
        event_type,
        created_at
    FROM public.riya_payment_events
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND (metadata->>'platform' = 'telegram' OR metadata->>'telegram_user_id' IS NOT NULL)
)
SELECT
    e.tg_id,
    tu.telegram_username,
    tu.first_name,
    tu.message_count,
    tu.message_credits,
    MAX(e.created_at) FILTER (WHERE e.event_type = 'page_visit')    AS last_visit,
    COUNT(*) FILTER (WHERE e.event_type = 'page_visit')             AS page_visits,
    COUNT(*) FILTER (WHERE e.event_type = 'upgrade_click')          AS upgrade_clicks,
    COUNT(*) FILTER (WHERE e.event_type = 'payment_success')        AS payments
FROM events e
LEFT JOIN public.telegram_users tu ON tu.telegram_user_id = e.tg_id
GROUP BY e.tg_id, tu.telegram_username, tu.first_name, tu.message_count, tu.message_credits
ORDER BY last_visit DESC NULLS LAST;

-- ── 12. VERIFY RPC: get_telegram_daily_activity ───────────────────────────────
SELECT * FROM public.get_telegram_daily_activity(30) ORDER BY activity_date DESC;

-- ── 13. VERIFY RPC: get_telegram_aggregate_metrics ───────────────────────────
SELECT
    avg_dau, mau, avg_dau_mau_ratio,
    avg_new_users_per_day, total_new_users_period,
    total_revenue_period / 100.0 AS total_revenue_inr
FROM public.get_telegram_aggregate_metrics(30);
