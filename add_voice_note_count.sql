-- Voice note count tracking
-- Run this in Supabase SQL editor before deploying the voice notes feature

ALTER TABLE riya_instagram_users
  ADD COLUMN IF NOT EXISTS total_voice_notes_sent INTEGER DEFAULT 0;

-- Optional: useful query to see top users by voice notes
-- SELECT instagram_user_id, total_voice_notes_sent, message_count
-- FROM riya_instagram_users
-- WHERE total_voice_notes_sent > 0
-- ORDER BY total_voice_notes_sent DESC;
