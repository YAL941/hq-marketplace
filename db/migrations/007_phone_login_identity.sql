-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 007_phone_login_identity.sql
-- Makes the existing users.phone column usable as a login identity.
--
-- The column was created back in 001 as a plain nullable TEXT with a
-- permissive format check, but nothing ever made it unique, so two accounts
-- could share a number and the column could not be used to look somebody up.
-- This migration does NOT create a column: it turns the one that is already
-- there into a proper identity.
--
-- Two rules drive the shape of this file:
--   1. every phone is stored in E.164 (+<country><number>), so
--      '061000000', '61 000 0000' and '+252610000000' cannot become three
--      different accounts for the same person;
--   2. uniqueness is scoped to non-null values, because a NULL phone is
--      "this account has no phone", not "two accounts share no phone".
--
-- Rollback restores the 001 constraint and the email-only login lookup.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Uniqueness
-- ---------------------------------------------------------------------
-- A UNIQUE constraint already treats every NULL as distinct, so the same
-- declaration would also work here; the partial index is written explicitly
-- so the intent survives a future "remove the index" mistake and so the
-- planner can use it as a plain btree without the null rows.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique
    ON users (phone)
    WHERE phone IS NOT NULL;

COMMENT ON INDEX users_phone_unique IS
    'A phone number identifies at most one account. NULL means the account has '
    'no phone, which is why the uniqueness is partial.';

-- ---------------------------------------------------------------------
-- 2. Format
-- ---------------------------------------------------------------------
-- The 001 check accepted '^\+?[0-9]{7,15}$', which allows a stored value with
-- no country code at all. That is the value that makes '061000000' and
-- '+252610000000' look like two different people, so the constraint is
-- replaced with the E.164 shape.
--
-- Safe to tighten: the API normalises before it inserts, and no row in this
-- project has a phone yet, so no rewrite is needed. A deployment that does
-- hold legacy numbers must normalise them first or this statement fails loudly,
-- which is the intended outcome rather than a silent conversion.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_format;
ALTER TABLE users
    ADD CONSTRAINT users_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

COMMENT ON CONSTRAINT users_phone_format ON users IS
    'Phones are stored in E.164: a leading +, a non-zero country digit, then '
    'the national number. The API is responsible for normalising user input '
    'before it reaches this column.';

-- ---------------------------------------------------------------------
-- 3. Login lookup by email OR phone
-- ---------------------------------------------------------------------
-- Same signature and same return type as the 004 function, so no caller and no
-- GRANT has to be rewritten; only the body changes.
--
-- Two things CREATE OR REPLACE refuses to do, and both shape this statement:
-- it cannot change a return type, and it cannot rename an input parameter.
-- So the parameter keeps the name `p_email` while it now accepts an email OR
-- an E.164 phone number. The name is the only thing still lying about it.
--
-- There is no reason to add the phone to the result set: the login response
-- never echoes it back.
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
    -- `p_email` is now the identifier, already normalised by the API, so a
    -- plain equality test is correct on both columns. An email can never look
    -- like an E.164 number, so the two branches cannot both match a row.
    -- LIMIT 1 keeps the result single-valued even if a phone and an email were
    -- ever to collide on a malformed row.
    WHERE u.email = p_email
       OR u.phone = p_email
    LIMIT 1;
$$;

COMMENT ON FUNCTION app_user_for_login(TEXT) IS
    'Resolves a login identifier that is either an email address or an E.164 '
    'phone number. Returns the password hash, so the caller must only ever use '
    'it to verify a bcrypt hash and must never echo it back.';

-- ---------------------------------------------------------------------
-- 4. Index support for the new lookup branch
-- ---------------------------------------------------------------------
-- users_phone_unique already covers the phone branch. The email branch is
-- served by users_email_unique from 001.
