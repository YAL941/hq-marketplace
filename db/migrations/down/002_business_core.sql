-- destructive: true
-- Rollback of 002_business_core.sql
-- DESTRUCTIVE: drops businesses and every business-scoped table.
-- The migration runner refuses to run it in production without
-- --allow-data-loss.

DROP TABLE IF EXISTS business_locations;
DROP TABLE IF EXISTS business_users;
DROP TABLE IF EXISTS businesses;
DROP TABLE IF EXISTS business_categories;

DROP FUNCTION IF EXISTS assert_business_role_scope();
DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS membership_status;
DROP TYPE IF EXISTS verification_status;
DROP TYPE IF EXISTS business_status;
