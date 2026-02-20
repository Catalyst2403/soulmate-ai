-- Migration: Silent Treatment / Block Feature
-- Created: 2026-02-20
-- Purpose: Allow Riya to block users for a cooldown period (1-4 hours)
--          as a monetization lever when users refuse Pro repeatedly.
--          Pro payment (is_pro = true) auto-unblocks.

ALTER TABLE riya_instagram_users
ADD COLUMN IF NOT EXISTS silent_until TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS silent_reason TEXT DEFAULT NULL;
