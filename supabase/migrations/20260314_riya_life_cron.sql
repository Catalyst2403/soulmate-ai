-- Migration: pg_cron schedule for Riya Life State Updater
-- Created: 2026-03-14
-- Purpose: Call the riya-life-updater Edge Function every Monday at 6:30am IST (1:00am UTC)
--
-- PREREQUISITE: pg_cron and pg_net extensions must be enabled in Supabase dashboard
--   Dashboard → Database → Extensions → search "pg_cron" and "pg_net" → Enable both.
--
-- IMPORTANT: Replace <LIFE_UPDATER_SECRET> below with the actual secret value.
-- Set it in Supabase: Dashboard → Edge Functions → Secrets → Add LIFE_UPDATER_SECRET
-- Then run this migration manually after the secret is set.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing schedule with the same name (idempotent)
SELECT cron.unschedule('riya-life-updater-weekly')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'riya-life-updater-weekly'
);

-- Schedule: Every Monday at 1:00am UTC = 6:30am IST
SELECT cron.schedule(
    'riya-life-updater-weekly',
    '0 1 * * 1',
    $$
    SELECT net.http_post(
        url     := 'https://lxwwfnyrbfhhtvumghgh.supabase.co/functions/v1/riya-life-updater',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || current_setting('app.life_updater_secret', true)
        ),
        body    := '{}'::jsonb
    ) AS request_id;
    $$
);

-- Store the secret as a DB setting so the cron job can reference it without hardcoding
-- Run this separately after setting the actual secret value:
--   ALTER DATABASE postgres SET "app.life_updater_secret" = '<YOUR_SECRET_HERE>';
