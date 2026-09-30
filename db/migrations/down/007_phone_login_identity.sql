-- Rollback of 007_phone_login_identity.sql
-- Restores the 001 phone handling: no uniqueness, and the permissive
-- '^\+?[0-9]{7,15}$' format check that allowed a value without a country code.
-- Also restores the 004 login lookup, which matched on email only.
--
-- Any phone written after 007 was applied survives as-is, as long as it still
-- matches the older, looser check (the E.164 values 007 enforced are a subset
-- of what 001 allowed, so this direction can never fail on data).
-- destructive: false

DROP INDEX IF EXISTS users_phone_unique;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_format;
ALTER TABLE users
    ADD CONSTRAINT users_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$');

-- The 004 definition, matching on the email column only.
CREATE OR REPLACE FUNCTION app_user_for_login(p_email TEXT)
RETURNS TABLE (
    user_id BIGINT,
    email CITEXT,
    password_hash TEXT,
    status user_status,
    full_name TEXT,
    is_platform_admin BOOLEAN
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
        ) AS is_platform_admin
    FROM users u
    WHERE u.email = p_email;
$$;
