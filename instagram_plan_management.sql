-- ==========================================
-- INSTAGRAM PRO PLAN MANAGEMENT
-- ==========================================

-- ------------------------------------------
-- 1. DEACTIVATE PRO PLAN
-- ------------------------------------------
-- Replace 'TARGET_USERNAME' with the actual Instagram username
DO $$
DECLARE
    v_target_username text := 'TARGET_USERNAME'; 
BEGIN
    UPDATE riya_instagram_users
    SET 
        is_pro = false,
        subscription_end_date = NOW() - INTERVAL '1 second' -- Expire immediately
    WHERE instagram_username = v_target_username;

    -- Mark active subscription as cancelled
    UPDATE riya_subscriptions
    SET 
        status = 'cancelled',
        expires_at = NOW(),
        updated_at = NOW()
    WHERE instagram_user_id = (SELECT instagram_user_id FROM riya_instagram_users WHERE instagram_username = v_target_username)
      AND status = 'active';

    RAISE NOTICE 'Deactivated Pro Plan for %', v_target_username;
END $$;


-- ------------------------------------------
-- 2. ACTIVATE PRO PLAN
-- ------------------------------------------
-- Replace 'TARGET_USERNAME' with the actual Instagram username
DO $$
DECLARE
    v_target_username text := 'TARGET_USERNAME'; 
    v_duration interval := '30 days';
    v_instagram_user_id text;
    v_new_end_date timestamptz;
BEGIN
    -- Get User ID
    SELECT instagram_user_id INTO v_instagram_user_id
    FROM riya_instagram_users
    WHERE instagram_username = v_target_username;

    IF v_instagram_user_id IS NULL THEN
        RAISE EXCEPTION 'User % not found', v_target_username;
    END IF;

    v_new_end_date := NOW() + v_duration;

    -- Update User
    UPDATE riya_instagram_users
    SET 
        is_pro = true,
        subscription_end_date = v_new_end_date
    WHERE instagram_user_id = v_instagram_user_id;

    -- Update/Insert Subscription Record
    IF EXISTS (SELECT 1 FROM riya_subscriptions WHERE instagram_user_id = v_instagram_user_id) THEN
        UPDATE riya_subscriptions
        SET
            plan_type = 'manual_grant',
            status = 'active',
            expires_at = v_new_end_date,
            updated_at = NOW()
        WHERE instagram_user_id = v_instagram_user_id;
    ELSE
        INSERT INTO riya_subscriptions (
            instagram_user_id, plan_type, status, amount_paid, starts_at, expires_at
        ) VALUES (
            v_instagram_user_id, 'manual_grant', 'active', 0, NOW(), v_new_end_date
        );
    END IF;

    RAISE NOTICE 'Activated Pro Plan for % until %', v_target_username, v_new_end_date;
END $$;
