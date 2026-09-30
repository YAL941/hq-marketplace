-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 002_business_core.sql
-- The tenant root: business_categories, businesses, business_users,
-- business_locations.
-- Rule enforced by the whole design: every business-scoped row carries
-- a NOT NULL business_id that references businesses(business_id).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE business_status AS ENUM ('pending', 'active', 'suspended', 'closed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- business_categories — global, extensible, no schema change needed to
-- add a category (admin INSERT). Never duplicated as free text on
-- businesses.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_categories (
    category_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name      TEXT        NOT NULL,
    category_slug      TEXT        NOT NULL,
    description        TEXT,
    icon               TEXT,
    sort_order         SMALLINT    NOT NULL DEFAULT 0,
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT business_categories_name_unique UNIQUE (category_name),
    CONSTRAINT business_categories_slug_unique UNIQUE (category_slug),
    CONSTRAINT business_categories_slug_format CHECK (category_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE INDEX IF NOT EXISTS ix_business_categories_active
    ON business_categories (sort_order, category_id) WHERE is_active;

DROP TRIGGER IF EXISTS trg_business_categories_updated_at ON business_categories;
CREATE TRIGGER trg_business_categories_updated_at BEFORE UPDATE ON business_categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- businesses — the tenant root.
-- business_name is intentionally NOT unique (several pharmacies may share
-- a name); business_slug is the unique public handle.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
    business_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_name      TEXT        NOT NULL,
    business_slug      TEXT        NOT NULL,
    business_description TEXT,
    business_category_id BIGINT    REFERENCES business_categories (category_id) ON DELETE RESTRICT,
    phone              TEXT,
    email              CITEXT,
    website            TEXT,
    address            TEXT,
    city               TEXT,
    district           TEXT,
    latitude           DOUBLE PRECISION,
    longitude          DOUBLE PRECISION,
    logo_url           TEXT,
    cover_image_url    TEXT,
    status             business_status NOT NULL DEFAULT 'pending',
    is_verified        BOOLEAN     NOT NULL DEFAULT FALSE,
    verification_status verification_status NOT NULL DEFAULT 'pending',
    verified_at        TIMESTAMPTZ,
    verified_by        BIGINT      REFERENCES users (user_id) ON DELETE SET NULL,
    rejection_reason   TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,   -- soft delete; row is retained for audit
    CONSTRAINT businesses_slug_unique UNIQUE (business_slug),
    CONSTRAINT businesses_name_len CHECK (char_length(business_name) BETWEEN 2 AND 200),
    CONSTRAINT businesses_slug_format CHECK (business_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT businesses_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CONSTRAINT businesses_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    CONSTRAINT businesses_phone_format CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
    -- is_verified is a fast mirror of the verification workflow state
    CONSTRAINT businesses_verified_flag_consistent CHECK (
        (verification_status = 'verified' AND is_verified AND verified_at IS NOT NULL)
        OR (verification_status <> 'verified' AND NOT is_verified AND verified_at IS NULL)
    ),
    -- a live business must expose at least one contact channel
    CONSTRAINT businesses_contact_required CHECK (
        phone IS NOT NULL OR email IS NOT NULL OR website IS NOT NULL OR address IS NOT NULL
    )
);

COMMENT ON COLUMN businesses.deleted_at IS 'Soft delete marker. Businesses are never hard-deleted by the API.';

-- Category browse: active businesses grouped by category
CREATE INDEX IF NOT EXISTS ix_businesses_category_status
    ON businesses (business_category_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- Public directory search (name) and city/geo filtering
CREATE INDEX IF NOT EXISTS ix_businesses_status_created
    ON businesses (status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_businesses_city_district
    ON businesses (city, district) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_businesses_verification
    ON businesses (verification_status) WHERE status = 'active';
-- trigram-free prefix search fallback: btree on lower(name)
CREATE INDEX IF NOT EXISTS ix_businesses_name_lower ON businesses (lower(business_name));

DROP TRIGGER IF EXISTS trg_businesses_updated_at ON businesses;
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON businesses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- business_users — user <-> business membership.
-- One user may hold memberships in many businesses with different roles.
-- UNIQUE (business_id, user_id, role_id) allows a user to be both
-- manager and employee of the same business if the platform needs it,
-- while preventing exact duplicates.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_users (
    business_user_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id        BIGINT      NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    user_id            BIGINT      NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
    role_id            BIGINT      NOT NULL REFERENCES roles (role_id) ON DELETE RESTRICT,
    status             membership_status NOT NULL DEFAULT 'active',
    invited_by         BIGINT      REFERENCES users (user_id) ON DELETE SET NULL,
    joined_at          TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT business_users_membership_unique UNIQUE (business_id, user_id, role_id),
    CONSTRAINT business_users_joined_when_active CHECK (status <> 'active' OR joined_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_business_users_user ON business_users (user_id, status);
CREATE INDEX IF NOT EXISTS ix_business_users_business ON business_users (business_id, role_id, status);
-- "at most one active owner per business" is enforced by the partial unique
-- index ux_business_users_single_owner, created in 004 after roles are seeded
-- (a subquery is not allowed inside an index predicate, so it must be built
-- with dynamic SQL once role_id is known).

COMMENT ON CONSTRAINT business_users_membership_unique ON business_users IS
    'A user may hold several distinct roles in one business, never the same role twice.';

DROP TRIGGER IF EXISTS trg_business_users_updated_at ON business_users;
CREATE TRIGGER trg_business_users_updated_at BEFORE UPDATE ON business_users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Guard: only business-scoped roles may be attached to a business.
CREATE OR REPLACE FUNCTION assert_business_role_scope() RETURNS TRIGGER AS $$
DECLARE
    v_scope role_scope;
BEGIN
    SELECT scope INTO v_scope FROM roles WHERE role_id = NEW.role_id;
    IF v_scope <> 'business' THEN
        RAISE EXCEPTION 'role % has platform scope and cannot be used as a business membership role', NEW.role_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_users_scope ON business_users;
CREATE TRIGGER trg_business_users_scope
    BEFORE INSERT OR UPDATE ON business_users
    FOR EACH ROW EXECUTE FUNCTION assert_business_role_scope();

-- ---------------------------------------------------------------------
-- business_locations — branches. Address/location data is stored here,
-- never only on businesses, so a business can have many branches.
-- businesses.address remains as the registered/legal address.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_locations (
    location_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id        BIGINT      NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    location_name      TEXT        NOT NULL,
    address            TEXT,
    city               TEXT,
    district           TEXT,
    latitude           DOUBLE PRECISION,
    longitude          DOUBLE PRECISION,
    phone              TEXT,
    is_primary         BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    working_hours      JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT business_locations_name_len CHECK (char_length(location_name) BETWEEN 2 AND 150),
    CONSTRAINT business_locations_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CONSTRAINT business_locations_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    CONSTRAINT business_locations_phone_format CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
    -- referenced by order_items' composite FK; keep the pair unique
    CONSTRAINT business_locations_id_business_unique UNIQUE (location_id, business_id)
);

CREATE INDEX IF NOT EXISTS ix_business_locations_business
    ON business_locations (business_id, is_active);
CREATE INDEX IF NOT EXISTS ix_business_locations_city ON business_locations (city, district)
    WHERE is_active;

-- at most one primary location per business
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_locations_primary
    ON business_locations (business_id) WHERE is_primary;

DROP TRIGGER IF EXISTS trg_business_locations_updated_at ON business_locations;
CREATE TRIGGER trg_business_locations_updated_at BEFORE UPDATE ON business_locations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
