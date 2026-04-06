-- Add preferred_language as a first-class column on riya_instagram_users.
-- This is the single source of truth for a user's chat language preference.
-- Written immediately when Riya detects a language switch (via the "lang" field
-- in her JSON response), never touched by the background facts-extraction job.

ALTER TABLE riya_instagram_users
ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT NULL;
