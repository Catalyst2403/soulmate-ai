-- Migration: Safe username search RPC for anonymous payment page access
-- Date: 2026-03-21
-- Purpose: Allow the /riya/pay/instagram page (no auth) to search Instagram usernames
--          without exposing the full riya_instagram_users table via RLS.

-- Returns only the 3 columns needed for user identification.
-- Min 2 chars required, prefix match only, max 5 results.
-- SECURITY DEFINER runs with table owner privileges — no RLS changes needed.

CREATE OR REPLACE FUNCTION search_ig_users_by_username(p_query TEXT)
RETURNS TABLE(
    instagram_user_id TEXT,
    instagram_username TEXT,
    instagram_name     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF length(trim(p_query)) < 2 THEN
        RETURN;
    END IF;

    RETURN QUERY
        SELECT
            u.instagram_user_id,
            u.instagram_username,
            u.instagram_name
        FROM riya_instagram_users u
        WHERE u.instagram_username ILIKE (trim(p_query) || '%')
        ORDER BY u.last_message_at DESC NULLS LAST
        LIMIT 5;
END;
$$;

-- Allow anonymous (unauthenticated) callers to invoke this RPC.
-- The function only exposes username + name — no sensitive data.
GRANT EXECUTE ON FUNCTION search_ig_users_by_username(TEXT) TO anon;
