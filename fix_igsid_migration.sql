-- IGSID Migration: Fix already-duplicated users
-- Run this ONCE in Supabase SQL Editor to merge old → new for users 
-- who have already messaged the new IG account (like Miten)

DO $$
DECLARE
    rec RECORD;
BEGIN
    -- Find duplicates: same username, different IGSID
    -- The "new" row has fewer messages, the "old" row has more
    FOR rec IN
        SELECT 
            new_u.instagram_user_id AS new_id,
            old_u.instagram_user_id AS old_id,
            old_u.instagram_username,
            old_u.message_count AS old_msgs,
            new_u.message_count AS new_msgs
        FROM riya_instagram_users new_u
        JOIN riya_instagram_users old_u 
            ON new_u.instagram_username = old_u.instagram_username
            AND new_u.instagram_user_id != old_u.instagram_user_id
        WHERE new_u.message_count < old_u.message_count
    LOOP
        RAISE NOTICE 'Migrating % : old=% (% msgs) → new=% (% msgs)', 
            rec.instagram_username, rec.old_id, rec.old_msgs, rec.new_id, rec.new_msgs;
        
        -- Remap all related tables from old IGSID → new IGSID
        UPDATE riya_conversations SET instagram_user_id = rec.new_id WHERE instagram_user_id = rec.old_id;
        UPDATE riya_conversation_summaries SET instagram_user_id = rec.new_id WHERE instagram_user_id = rec.old_id;
        UPDATE riya_sent_images SET instagram_user_id = rec.new_id WHERE instagram_user_id = rec.old_id;
        UPDATE riya_payment_events SET instagram_user_id = rec.new_id WHERE instagram_user_id = rec.old_id;
        UPDATE riya_subscriptions SET instagram_user_id = rec.new_id WHERE instagram_user_id = rec.old_id;
        UPDATE riya_payments SET instagram_user_id = rec.new_id WHERE instagram_user_id = rec.old_id;
        UPDATE riya_pending_messages SET user_id = rec.new_id WHERE user_id = rec.old_id;
        
        -- Merge: copy stats from old user to new user, then delete old
        UPDATE riya_instagram_users SET
            message_count = rec.old_msgs,
            is_pro = (SELECT is_pro FROM riya_instagram_users WHERE instagram_user_id = rec.old_id),
            subscription_end_date = (SELECT subscription_end_date FROM riya_instagram_users WHERE instagram_user_id = rec.old_id),
            created_at = (SELECT created_at FROM riya_instagram_users WHERE instagram_user_id = rec.old_id),
            user_age = (SELECT user_age FROM riya_instagram_users WHERE instagram_user_id = rec.old_id),
            daily_message_count = 0,
            daily_image_count = 0
        WHERE instagram_user_id = rec.new_id;
        
        -- Delete the old duplicate row
        DELETE FROM riya_instagram_users WHERE instagram_user_id = rec.old_id;
        
        RAISE NOTICE '✅ Done: % now has % msgs under new IGSID %', rec.instagram_username, rec.old_msgs, rec.new_id;
    END LOOP;
END $$;
