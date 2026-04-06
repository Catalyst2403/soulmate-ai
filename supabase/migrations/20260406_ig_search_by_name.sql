-- Migration: Improve Instagram user search — username + name, token-aware
-- Date: 2026-04-06
-- Replaces: 20260321_ig_username_search_rpc.sql
-- Changes:
--   1. Also searches instagram_name (was username-only before)
--   2. Substring match on name, prefix match on username
--   3. Token-aware: splits query on whitespace, each token must match somewhere
--   4. NULL-safe via COALESCE
--   5. Better ranking: username prefix > name match > username substring
--   6. Limit raised 5 → 8

CREATE OR REPLACE FUNCTION search_ig_users_by_username(p_query TEXT)
RETURNS TABLE(
    instagram_user_id TEXT,
    instagram_username TEXT,
    instagram_name     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_query  TEXT    := lower(trim(p_query));
    v_tokens TEXT[]  := string_to_array(regexp_replace(v_query, '\s+', ' ', 'g'), ' ');
    v_tok    TEXT;
BEGIN
    -- Require at least 2 non-space characters
    IF length(v_query) < 2 THEN
        RETURN;
    END IF;

    RETURN QUERY
        WITH candidates AS (
            SELECT
                u.instagram_user_id,
                u.instagram_username,
                u.instagram_name,
                u.last_message_at,
                lower(u.instagram_username)                   AS luser,
                lower(COALESCE(u.instagram_name, ''))         AS lname
            FROM riya_instagram_users u
            WHERE
                -- At least one field contains the full query
                lower(u.instagram_username) LIKE ('%' || v_query || '%')
                OR lower(COALESCE(u.instagram_name, '')) LIKE ('%' || v_query || '%')
        )
        SELECT
            c.instagram_user_id,
            c.instagram_username,
            c.instagram_name
        FROM candidates c
        WHERE
            -- Every whitespace-separated token must appear in username OR name
            (
                SELECT bool_and(
                    c.luser LIKE ('%' || t || '%')
                    OR c.lname LIKE ('%' || t || '%')
                )
                FROM unnest(v_tokens) AS t
            )
        ORDER BY
            -- 1. Username starts with the full query (strongest signal)
            CASE WHEN c.luser LIKE (v_query || '%') THEN 0 ELSE 1 END,
            -- 2. Name contains the full query
            CASE WHEN c.lname LIKE ('%' || v_query || '%') THEN 0 ELSE 1 END,
            -- 3. Most recent messagers first
            c.last_message_at DESC NULLS LAST
        LIMIT 8;
END;
$$;

-- Re-grant to anon (SECURITY DEFINER — no RLS changes needed)
GRANT EXECUTE ON FUNCTION search_ig_users_by_username(TEXT) TO anon;
