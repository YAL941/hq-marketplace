-- destructive: true
DROP FUNCTION IF EXISTS user_email_is_verified(BIGINT);
DROP FUNCTION IF EXISTS verify_user_email_code(CITEXT, TEXT);
DROP FUNCTION IF EXISTS issue_user_email_verification_code(CITEXT, TEXT, TIMESTAMPTZ);
DROP TABLE IF EXISTS user_email_verification_codes;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
