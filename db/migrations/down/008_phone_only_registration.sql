-- Rollback of 008_phone_only_registration.sql
-- Restores the 001 rule that every account has an email, and the 005
-- registration-read policy that matches on the email alone.
--
-- This FAILS if any phone-only account exists, and that failure is the point:
-- rolling the constraint back would either be impossible or would need to
-- invent an email for a real person. Reconcile those accounts first.
-- destructive: false

ALTER TABLE users ALTER COLUMN email SET NOT NULL;

DROP POLICY IF EXISTS users_registration_read ON users;
CREATE POLICY users_registration_read ON users
    FOR SELECT USING (email = NULLIF(current_setting('app.registering_email', TRUE), '')::citext);
