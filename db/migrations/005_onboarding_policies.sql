-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 005_onboarding_policies.sql
-- Follow-up to 004: policies needed by the self-service onboarding flow.
-- Migrations 001-004 stay immutable; this file only adds to them.
--
-- Why this file exists: PostgreSQL evaluates the SELECT policies when an
-- INSERT ... RETURNING runs, so a row a caller has just created must also
-- be readable by that caller.
-- =====================================================================

-- The user who registered the business. Needed so the owner can read their
-- own business before the first membership row exists.
ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_businesses_created_by ON businesses (created_by);

DROP TRIGGER IF EXISTS trg_businesses_updated_at ON businesses;
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON businesses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- the creator sees the business they just registered
DROP POLICY IF EXISTS businesses_creator_read ON businesses;
CREATE POLICY businesses_creator_read ON businesses
    FOR SELECT USING (created_by = app_user_id());

-- a customer can read their own review while it is still pending
DROP POLICY IF EXISTS reviews_own_read ON reviews;
CREATE POLICY reviews_own_read ON reviews
    FOR SELECT USING (user_id = app_user_id());

-- self-registration: a user row may be created, but never as 'deleted'
DROP POLICY IF EXISTS users_registration_insert ON users;
CREATE POLICY users_registration_insert ON users
    FOR INSERT WITH CHECK (status <> 'deleted'::user_status);

-- and the just-registered row is readable during that same transaction.
-- The backend sets app.registering_email before the insert. If the email is
-- already taken the unique constraint aborts the transaction, so this
-- cannot be used to discover existing accounts.
DROP POLICY IF EXISTS users_registration_read ON users;
CREATE POLICY users_registration_read ON users
    FOR SELECT USING (email = NULLIF(current_setting('app.registering_email', TRUE), '')::citext);
