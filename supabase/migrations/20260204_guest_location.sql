-- Guest & Authenticated User Location Tracking Migration
-- Created: 2026-02-04
-- Purpose: Add IP-based geolocation columns to track user locations

-- ============================================
-- 1. Add location columns to riya_guest_sessions
-- ============================================

ALTER TABLE public.riya_guest_sessions
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS country_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS region TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT;

-- Index for analytics queries by country
CREATE INDEX IF NOT EXISTS idx_riya_guest_sessions_country
    ON public.riya_guest_sessions(country)
    WHERE country IS NOT NULL;

-- ============================================
-- 2. Add location columns to riya_users
-- ============================================

ALTER TABLE public.riya_users
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS country_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS region TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT;

-- Index for analytics queries by country
CREATE INDEX IF NOT EXISTS idx_riya_users_country
    ON public.riya_users(country)
    WHERE country IS NOT NULL;

-- ============================================
-- 3. Comments
-- ============================================

-- Guest sessions
COMMENT ON COLUMN public.riya_guest_sessions.country IS 'Country name from IP geolocation (e.g., India)';
COMMENT ON COLUMN public.riya_guest_sessions.country_code IS 'ISO country code (e.g., IN)';
COMMENT ON COLUMN public.riya_guest_sessions.region IS 'State/Region from IP geolocation (e.g., Maharashtra)';
COMMENT ON COLUMN public.riya_guest_sessions.city IS 'City from IP geolocation (e.g., Mumbai)';

-- Authenticated users
COMMENT ON COLUMN public.riya_users.country IS 'Country name from IP geolocation (e.g., India)';
COMMENT ON COLUMN public.riya_users.country_code IS 'ISO country code (e.g., IN)';
COMMENT ON COLUMN public.riya_users.region IS 'State/Region from IP geolocation (e.g., Maharashtra)';
COMMENT ON COLUMN public.riya_users.city IS 'City from IP geolocation (e.g., Mumbai)';
