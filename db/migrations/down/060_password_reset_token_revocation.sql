-- destructive: false
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
