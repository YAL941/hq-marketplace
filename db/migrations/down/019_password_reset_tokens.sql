-- destructive: false
DROP FUNCTION IF EXISTS consume_user_password_reset_token(TEXT, TEXT);
DROP FUNCTION IF EXISTS create_user_password_reset_token(CITEXT, TEXT, TIMESTAMPTZ);
DROP TABLE IF EXISTS user_password_reset_tokens;
