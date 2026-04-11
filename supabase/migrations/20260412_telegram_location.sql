-- Add location columns to telegram_users
-- Populated via IP geolocation on the website redirect page (/riya/tg)
-- before the user is sent to Telegram via deep link.

ALTER TABLE telegram_users
    ADD COLUMN IF NOT EXISTS city   TEXT,
    ADD COLUMN IF NOT EXISTS region TEXT;
