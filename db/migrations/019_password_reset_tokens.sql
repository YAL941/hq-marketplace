CREATE TABLE user_password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_password_reset_tokens_user_created
    ON user_password_reset_tokens (user_id, created_at DESC);

ALTER TABLE user_password_reset_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_password_reset_tokens FROM PUBLIC;

CREATE OR REPLACE FUNCTION create_user_password_reset_token(
    p_email CITEXT,
    p_token_hash TEXT,
    p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (user_email CITEXT, user_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id BIGINT;
BEGIN
    SELECT u.user_id, u.email, u.full_name
      INTO v_user_id, user_email, user_name
      FROM users u
     WHERE u.email = p_email
       AND u.status = 'active';

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE user_password_reset_tokens
       SET consumed_at = now()
     WHERE user_id = v_user_id
       AND consumed_at IS NULL;

    INSERT INTO user_password_reset_tokens (token_hash, user_id, expires_at)
    VALUES (p_token_hash, v_user_id, p_expires_at);
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION consume_user_password_reset_token(
    p_token_hash TEXT,
    p_password_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id BIGINT;
BEGIN
    UPDATE user_password_reset_tokens
       SET consumed_at = now()
     WHERE token_hash = p_token_hash
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING user_id INTO v_user_id;

    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE users
       SET password_hash = p_password_hash,
           updated_at = now()
     WHERE user_id = v_user_id
       AND status = 'active';

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION create_user_password_reset_token(CITEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_user_password_reset_token(TEXT, TEXT) FROM PUBLIC;
