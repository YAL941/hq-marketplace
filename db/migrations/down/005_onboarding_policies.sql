-- Rollback of 005_onboarding_policies.sql
-- Non-destructive with respect to business data: only the policies and the
-- created_by column are removed.
-- destructive: false

DROP POLICY IF EXISTS businesses_creator_read ON businesses;
DROP POLICY IF EXISTS reviews_own_read ON reviews;
DROP POLICY IF EXISTS users_registration_insert ON users;
DROP POLICY IF EXISTS users_registration_read ON users;

DROP INDEX IF EXISTS ix_businesses_created_by;

ALTER TABLE businesses DROP COLUMN IF EXISTS created_by;
