-- destructive: true
-- Rollback of 001_platform_identity.sql
-- DESTRUCTIVE: drops the user table. Only safe on an empty database.

DROP TABLE IF EXISTS user_platform_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS users;

DROP FUNCTION IF EXISTS assert_platform_role_scope();
DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS membership_status;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS role_scope;
