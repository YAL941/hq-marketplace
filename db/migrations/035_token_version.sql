ALTER TABLE users
    ADD COLUMN token_version BIGINT NOT NULL DEFAULT 0;

UPDATE users
   SET token_version = 0
 WHERE token_version IS NULL;

DROP FUNCTION IF EXISTS app_user_for_login(TEXT);

CREATE OR REPLACE FUNCTION app_user_for_login(p_email TEXT)
RETURNS TABLE (
    user_id BIGINT,
    email CITEXT,
    password_hash TEXT,
    status user_status,
    full_name TEXT,
    is_platform_admin BOOLEAN,
    token_version BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT
        u.user_id,
        u.email,
        u.password_hash,
        u.status,
        u.full_name,
        EXISTS (
            SELECT 1
            FROM user_platform_roles upr
            JOIN roles r ON r.role_id = upr.role_id
            WHERE upr.user_id = u.user_id
              AND r.role_key = 'platform_admin'
              AND r.scope = 'platform'
              AND r.is_active
        ) AS is_platform_admin,
        u.token_version
    FROM users u
    WHERE u.email = p_email
       OR u.phone = p_email
    LIMIT 1;
$$;

COMMENT ON FUNCTION app_user_for_login(TEXT) IS
    'Resolves a login identifier that is either an email address or an E.164 '
    'phone number. Returns the password hash and token_version, so the caller '
    'can bind the issued JWT to the current token version for revocation.';
