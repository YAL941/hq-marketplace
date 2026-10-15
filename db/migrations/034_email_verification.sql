ALTER TABLE users
    ADD COLUMN email_verified_at TIMESTAMPTZ;

UPDATE users
   SET email_verified_at = COALESCE(created_at, now())
 WHERE email_verified_at IS NULL;

CREATE TABLE user_email_verification_codes (
    user_id BIGINT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_email_verification_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_email_verification_codes FROM PUBLIC;

CREATE OR REPLACE FUNCTION issue_user_email_verification_code(
    p_email CITEXT,
    p_code_hash TEXT,
    p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (account_id BIGINT, user_email CITEXT, user_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id BIGINT;
    v_rows INTEGER;
BEGIN
    SELECT u.user_id, u.email, u.full_name
      INTO v_user_id, user_email, user_name
      FROM users u
     WHERE u.email = p_email
       AND u.email_verified_at IS NULL
       AND u.status = 'pending';

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO user_email_verification_codes (user_id, code_hash, expires_at, attempts, consumed_at, created_at)
    VALUES (v_user_id, p_code_hash, p_expires_at, 0, NULL, now())
    ON CONFLICT (user_id) DO UPDATE
        SET code_hash = EXCLUDED.code_hash,
            expires_at = EXCLUDED.expires_at,
            attempts = 0,
            consumed_at = NULL,
            created_at = now()
        WHERE user_email_verification_codes.created_at <= now() - INTERVAL '1 minute';

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN;
    END IF;

    account_id := v_user_id;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION verify_user_email_code(
    p_email CITEXT,
    p_code_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id BIGINT;
    v_code_hash TEXT;
    v_expires_at TIMESTAMPTZ;
    v_attempts SMALLINT;
    v_consumed_at TIMESTAMPTZ;
BEGIN
    SELECT c.user_id, c.code_hash, c.expires_at, c.attempts, c.consumed_at
      INTO v_user_id, v_code_hash, v_expires_at, v_attempts, v_consumed_at
      FROM user_email_verification_codes c
      JOIN users u ON u.user_id = c.user_id
     WHERE u.email = p_email
       AND u.email_verified_at IS NULL
       AND u.status = 'pending'
     FOR UPDATE OF c;

    IF v_user_id IS NULL
       OR v_consumed_at IS NOT NULL
       OR v_expires_at <= now()
       OR v_attempts >= 5 THEN
        RETURN FALSE;
    END IF;

    IF v_code_hash <> p_code_hash THEN
        UPDATE user_email_verification_codes
           SET attempts = attempts + 1
         WHERE user_id = v_user_id;
        RETURN FALSE;
    END IF;

    UPDATE user_email_verification_codes
       SET consumed_at = now()
     WHERE user_id = v_user_id;

    UPDATE users
       SET email_verified_at = now(),
           status = 'active'
     WHERE user_id = v_user_id
       AND email_verified_at IS NULL
       AND status = 'pending';

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION user_email_is_verified(p_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT u.email_verified_at IS NOT NULL FROM users u WHERE u.user_id = p_user_id),
        FALSE
    );
$$;

GRANT EXECUTE ON FUNCTION issue_user_email_verification_code(CITEXT, TEXT, TIMESTAMPTZ) TO PUBLIC;
GRANT EXECUTE ON FUNCTION verify_user_email_code(CITEXT, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION user_email_is_verified(BIGINT) TO PUBLIC;
