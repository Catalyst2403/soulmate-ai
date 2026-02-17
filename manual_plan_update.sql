-- Manually Upgrade Instagram User to Pro Plan
-- Replace 'TARGET_USERNAME_HERE' with the actual Instagram username you want to upgrade.
-- This script will:
-- 1. Find the user by username
-- 2. Validate they exist
-- 3. Extend or Create their subscription (default: 30 days)
-- 4. Update their user flags (is_pro, subscription_end_date)

DO $$
DECLARE
    -- !!! CHANGE THIS VALUE !!!
    v_target_username text := 'TARGET_USERNAME_HERE'; 
    -- Duration to add (e.g., '1 month', '1 year')
    v_duration interval := '30 days';
    
    -- Internal variables
    v_instagram_user_id text;
    v_current_sub_end timestamptz;
BEGIN
    -- 1. Get the instagram_user_id
    SELECT instagram_user_id, subscription_end_date 
    INTO v_instagram_user_id, v_current_sub_end
    FROM riya_instagram_users
    WHERE instagram_username = v_target_username;

    -- Check if user exists
    IF v_instagram_user_id IS NULL THEN
        RAISE EXCEPTION 'User "%" not found in riya_instagram_users table!', v_target_username;
    END IF;

    RAISE NOTICE 'Found User: % (ID: %)', v_target_username, v_instagram_user_id;

    -- 2. Calculate new end date
    -- If current sub is valid in future, extend from there. Else start from NOW()
    IF v_current_sub_end IS NULL OR v_current_sub_end < NOW() THEN
        v_current_sub_end := NOW();
    END IF;
    
    v_current_sub_end := v_current_sub_end + v_duration;

    -- 3. Update riya_instagram_users table flags
    UPDATE riya_instagram_users
    SET 
        is_pro = true,
        subscription_end_date = v_current_sub_end
    WHERE instagram_user_id = v_instagram_user_id;

    -- 4. Upsert into riya_subscriptions table for record keeping
    -- Check if subscription already exists
    IF EXISTS (SELECT 1 FROM riya_subscriptions WHERE instagram_user_id = v_instagram_user_id) THEN
        UPDATE riya_subscriptions
        SET
            plan_type = 'manual_grant',
            status = 'active',
            expires_at = v_current_sub_end,
            updated_at = NOW()
        WHERE instagram_user_id = v_instagram_user_id;
        RAISE NOTICE 'Updated existing subscription record.';
    ELSE
        INSERT INTO riya_subscriptions (
            instagram_user_id,
            plan_type,
            status,
            amount_paid,
            starts_at,
            expires_at,
            is_first_subscription
        ) VALUES (
            v_instagram_user_id,
            'manual_grant', -- Distinct plan type for manual updates
            'active',
            0, -- 0 cost for manual grant
            NOW(),
            v_current_sub_end,
            false
        );
        RAISE NOTICE 'Created new subscription record.';
    END IF;

    RAISE NOTICE 'SUCCESS: Upgraded % to Pro until %', v_target_username, v_current_sub_end;
END $$;
