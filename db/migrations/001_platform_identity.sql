-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 001_platform_identity.sql
-- Platform-level identity: users, roles, permissions.
-- NOTE: no business data in this migration. Roles carry a `scope`
-- so that platform roles (platform_admin) and business roles
-- (business_owner) never share the same row space.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'pending', 'suspended', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE role_scope AS ENUM ('platform', 'business');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE membership_status AS ENUM ('active', 'invited', 'suspended', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- users — a person. A user is NEVER a business and never a product.
-- Business linkage happens exclusively through business_users.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email              CITEXT      NOT NULL,
    phone              TEXT,
    password_hash      TEXT        NOT NULL,
    full_name          TEXT        NOT NULL,
    avatar_url         TEXT,
    status             user_status NOT NULL DEFAULT 'pending',
    last_login_at      TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
    CONSTRAINT users_full_name_len CHECK (char_length(full_name) BETWEEN 2 AND 200)
);

COMMENT ON TABLE users IS 'Platform-wide people. Multi-tenant linkage is via business_users.';

-- ---------------------------------------------------------------------
-- roles — scoped. platform scope = platform_admin, support.
--             business scope = business_owner, business_manager, business_employee.
-- `customer` is a platform scope role with no business membership.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    role_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_key           TEXT        NOT NULL,
    role_name          TEXT        NOT NULL,
    description        TEXT,
    scope              role_scope NOT NULL,
    -- higher rank = broader authority within the same scope
    rank               SMALLINT    NOT NULL DEFAULT 0,
    -- system roles cannot be deleted, only extended
    is_system          BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT roles_key_scope_unique UNIQUE (role_key, scope),
    CONSTRAINT roles_key_format CHECK (role_key ~ '^[a-z][a-z0-9_]{1,48}$')
);

CREATE INDEX IF NOT EXISTS ix_roles_scope_active ON roles (scope) WHERE is_active;

-- ---------------------------------------------------------------------
-- permissions — flat, context-free keys. Context is granted through
-- role_permissions, and the business context is enforced by RLS.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
    permission_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permission_key     TEXT        NOT NULL,
    description        TEXT,
    resource           TEXT        NOT NULL,
    action             TEXT        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT permissions_key_unique UNIQUE (permission_key),
    CONSTRAINT permissions_key_format CHECK (permission_key ~ '^[a-z_]+\.[a-z_]+$')
);

CREATE INDEX IF NOT EXISTS ix_permissions_resource ON permissions (resource);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id            BIGINT NOT NULL REFERENCES roles (role_id) ON DELETE CASCADE,
    permission_id      BIGINT NOT NULL REFERENCES permissions (permission_id) ON DELETE CASCADE,
    granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT role_permissions_pk PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS ix_role_permissions_permission ON role_permissions (permission_id);

-- ---------------------------------------------------------------------
-- user_platform_roles — platform-wide grants (platform_admin, customer).
-- Kept separate from business_users so that a platform admin is not
-- silently reinterpreted as an owner of every business.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_platform_roles (
    user_id            BIGINT      NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    role_id            BIGINT      NOT NULL REFERENCES roles (role_id) ON DELETE RESTRICT,
    granted_by         BIGINT      REFERENCES users (user_id) ON DELETE SET NULL,
    granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_platform_roles_pk PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS ix_user_platform_roles_role ON user_platform_roles (role_id);

-- ---------------------------------------------------------------------
-- Guard: a business-scoped role must never be granted here.
-- Enforced in the schema, not only in application code.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_platform_role_scope() RETURNS TRIGGER AS $$
DECLARE
    v_scope role_scope;
BEGIN
    SELECT scope INTO v_scope FROM roles WHERE role_id = NEW.role_id;
    IF v_scope <> 'platform' THEN
        RAISE EXCEPTION 'role % has business scope and cannot be granted at platform level', NEW.role_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_platform_roles_scope ON user_platform_roles;
CREATE TRIGGER trg_user_platform_roles_scope
    BEFORE INSERT OR UPDATE ON user_platform_roles
    FOR EACH ROW EXECUTE FUNCTION assert_platform_role_scope();

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
