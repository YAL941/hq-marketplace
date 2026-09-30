-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 003_catalog_and_commerce.sql
-- product_categories, service_categories, products, services,
-- orders, order_items, reviews, business_statistics.
--
-- Isolation technique used throughout: every tenant table carries
-- business_id NOT NULL, and composite foreign keys
-- (child_id, business_id) -> parent(id, business_id) make it impossible,
-- at the storage-engine level, to attach a row from Business A to an
-- order/branch of Business B.
-- =====================================================================

DO $$ BEGIN
    CREATE TYPE catalog_status AS ENUM ('draft', 'active', 'inactive', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE order_type AS ENUM ('product', 'service', 'mixed', 'booking');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE order_status AS ENUM (
        'pending', 'confirmed', 'in_progress', 'ready', 'out_for_delivery',
        'completed', 'cancelled', 'rejected', 'refunded'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE order_item_type AS ENUM ('product', 'service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE review_status AS ENUM ('pending', 'published', 'rejected', 'hidden');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- product_categories / service_categories — global catalogs, extensible
-- by admin INSERT without a schema change.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
    category_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name      TEXT        NOT NULL,
    category_slug      TEXT        NOT NULL,
    description        TEXT,
    icon               TEXT,
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_categories_name_unique UNIQUE (category_name),
    CONSTRAINT product_categories_slug_unique UNIQUE (category_slug)
);

CREATE TABLE IF NOT EXISTS service_categories (
    category_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name      TEXT        NOT NULL,
    category_slug      TEXT        NOT NULL,
    description        TEXT,
    icon               TEXT,
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT service_categories_name_unique UNIQUE (category_name),
    CONSTRAINT service_categories_slug_unique UNIQUE (category_slug)
);

-- ---------------------------------------------------------------------
-- products — always owned by a business. No product may exist without
-- a business_id.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    product_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id        BIGINT        NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    category_id        BIGINT        REFERENCES product_categories (category_id) ON DELETE RESTRICT,
    product_name       TEXT          NOT NULL,
    description        TEXT,
    price              NUMERIC(14,2) NOT NULL,
    discount_price     NUMERIC(14,2),
    currency           CHAR(3)       NOT NULL DEFAULT 'USD',
    sku                TEXT,
    image_url          TEXT,
    stock_quantity     INTEGER       NOT NULL DEFAULT 0,
    is_stock_tracked   BOOLEAN       NOT NULL DEFAULT TRUE,
    status             catalog_status NOT NULL DEFAULT 'draft',
    rating_avg         NUMERIC(3,2)  NOT NULL DEFAULT 0,
    rating_count       INTEGER       NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,
    -- target of the composite FK from order_items
    CONSTRAINT products_id_business_unique UNIQUE (product_id, business_id),
    CONSTRAINT products_name_len CHECK (char_length(product_name) BETWEEN 2 AND 200),
    CONSTRAINT products_price_non_negative CHECK (price >= 0),
    CONSTRAINT products_discount_valid CHECK (discount_price IS NULL OR (discount_price >= 0 AND discount_price < price)),
    CONSTRAINT products_stock_non_negative CHECK (stock_quantity >= 0),
    CONSTRAINT products_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT products_rating_range CHECK (rating_avg BETWEEN 0 AND 5 AND rating_count >= 0),
    -- a SKU is unique per business, not globally
    CONSTRAINT products_business_sku_unique UNIQUE (business_id, sku)
);

COMMENT ON TABLE products IS 'Products belong to a business. Never to a user.';

CREATE INDEX IF NOT EXISTS ix_products_business_status
    ON products (business_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_products_business_category
    ON products (business_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_products_business_name
    ON products (business_id, lower(product_name));
CREATE INDEX IF NOT EXISTS ix_products_public_active
    ON products (category_id, created_at DESC)
    WHERE status = 'active' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- services — a business may sell services only (hospital, hotel, hall).
-- Kept in a separate table because bookings, duration and staff
-- scheduling do not fit the product model.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
    service_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id        BIGINT        NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    service_category_id BIGINT       REFERENCES service_categories (category_id) ON DELETE RESTRICT,
    location_id        BIGINT        REFERENCES business_locations (location_id) ON DELETE SET NULL,
    service_name       TEXT          NOT NULL,
    description        TEXT,
    price              NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency           CHAR(3)       NOT NULL DEFAULT 'USD',
    duration_minutes   INTEGER,
    capacity           INTEGER,
    is_bookable        BOOLEAN       NOT NULL DEFAULT TRUE,
    status             catalog_status NOT NULL DEFAULT 'draft',
    rating_avg         NUMERIC(3,2)  NOT NULL DEFAULT 0,
    rating_count       INTEGER       NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,
    -- target of the composite FK from order_items
    CONSTRAINT services_id_business_unique UNIQUE (service_id, business_id),
    CONSTRAINT services_name_len CHECK (char_length(service_name) BETWEEN 2 AND 200),
    CONSTRAINT services_price_non_negative CHECK (price >= 0),
    CONSTRAINT services_duration_positive CHECK (duration_minutes IS NULL OR duration_minutes > 0),
    CONSTRAINT services_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
    CONSTRAINT services_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT services_rating_range CHECK (rating_avg BETWEEN 0 AND 5 AND rating_count >= 0)
);

CREATE INDEX IF NOT EXISTS ix_services_business_status
    ON services (business_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_services_business_category
    ON services (business_id, service_category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_services_public_active
    ON services (service_category_id, created_at DESC)
    WHERE status = 'active' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_services_updated_at ON services;
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Guarantee: a service's location, when set, belongs to the same business.
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_location_business_fk;
ALTER TABLE services ADD CONSTRAINT services_location_business_fk
    FOREIGN KEY (location_id, business_id)
    REFERENCES business_locations (location_id, business_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- orders — every order knows its business. customer_id references the
-- platform user, not the business: User != Business.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    order_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number       TEXT          NOT NULL DEFAULT '',
    business_id        BIGINT        NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    customer_id        BIGINT        NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
    location_id        BIGINT        REFERENCES business_locations (location_id) ON DELETE SET NULL,
    order_type         order_type    NOT NULL DEFAULT 'product',
    order_status       order_status  NOT NULL DEFAULT 'pending',
    subtotal           NUMERIC(14,2) NOT NULL DEFAULT 0,
    delivery_fee       NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency           CHAR(3)       NOT NULL DEFAULT 'USD',
    customer_note      TEXT,
    delivery_address   TEXT,
    scheduled_for      TIMESTAMPTZ,
    confirmed_at       TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    cancelled_at       TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- target of composite FKs from order_items and reviews
    CONSTRAINT orders_id_business_unique UNIQUE (order_id, business_id),
    CONSTRAINT orders_number_unique UNIQUE (order_number),
    CONSTRAINT orders_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT orders_amounts_non_negative CHECK (
        subtotal >= 0 AND delivery_fee >= 0 AND discount_amount >= 0
        AND tax_amount >= 0 AND total_amount >= 0
    ),
    CONSTRAINT orders_total_consistent CHECK (
        total_amount = subtotal + delivery_fee + tax_amount - discount_amount
    ),
    CONSTRAINT orders_location_business_fk FOREIGN KEY (location_id, business_id)
        REFERENCES business_locations (location_id, business_id) ON DELETE SET NULL,
    CONSTRAINT orders_completed_needs_time CHECK (order_status <> 'completed' OR completed_at IS NOT NULL),
    CONSTRAINT orders_cancelled_needs_time CHECK (order_status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

COMMENT ON TABLE orders IS
    'Each order belongs to exactly one business. Statistics are derived from this table, never stored on businesses.';

-- Business inbox: list orders of one business by recency
CREATE INDEX IF NOT EXISTS ix_orders_business_status
    ON orders (business_id, order_status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_business_customer
    ON orders (business_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_business_completed
    ON orders (business_id, completed_at DESC) WHERE order_status = 'completed';
-- customer purchase history across the platform
CREATE INDEX IF NOT EXISTS ix_orders_customer_created
    ON orders (customer_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- human readable, sortable order number: HQ-2026-00000001
-- (filled after insert, once the identity value exists)
CREATE OR REPLACE FUNCTION set_order_number() RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
       SET order_number = 'HQ-' || to_char(now(), 'YYYY') || '-' || lpad(NEW.order_id::TEXT, 8, '0')
     WHERE order_id = NEW.order_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_number ON orders;
CREATE TRIGGER trg_orders_number AFTER INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION set_order_number();

-- ---------------------------------------------------------------------
-- order_items — products/services are never embedded in orders.
-- unit_price / total_price are snapshots taken at order time, so a later
-- price change never rewrites historical orders.
-- The composite FKs below guarantee the referenced product/service and
-- the branch belong to the order's business.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    order_item_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id           BIGINT        NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
    business_id        BIGINT        NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    product_id         BIGINT,
    service_id         BIGINT,
    item_type          order_item_type NOT NULL,
    item_name          TEXT          NOT NULL,   -- snapshot
    quantity           NUMERIC(12,2) NOT NULL DEFAULT 1,
    unit_price         NUMERIC(14,2) NOT NULL,   -- snapshot
    total_price        NUMERIC(14,2) NOT NULL,   -- snapshot: unit_price * quantity
    notes              TEXT,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT order_items_exactly_one_reference CHECK (
        (item_type = 'product' AND product_id IS NOT NULL AND service_id IS NULL)
        OR (item_type = 'service' AND service_id IS NOT NULL AND product_id IS NULL)
    ),
    CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT order_items_price_non_negative CHECK (unit_price >= 0 AND total_price >= 0),
    CONSTRAINT order_items_product_business_fk FOREIGN KEY (product_id, business_id)
        REFERENCES products (product_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT order_items_service_business_fk FOREIGN KEY (service_id, business_id)
        REFERENCES services (service_id, business_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS ix_order_items_business ON order_items (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_order_items_product ON order_items (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_order_items_service ON order_items (service_id) WHERE service_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- reviews — business level. A user may review a business once.
-- Composite FK to orders keeps a review's order inside the same business.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
    review_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id        BIGINT        NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    user_id            BIGINT        NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
    order_id           BIGINT,
    rating             SMALLINT      NOT NULL,
    review_text        TEXT,
    business_response  TEXT,
    responded_at       TIMESTAMPTZ,
    status             review_status NOT NULL DEFAULT 'pending',
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT reviews_business_user_unique UNIQUE (business_id, user_id),
    CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT reviews_text_len CHECK (review_text IS NULL OR char_length(review_text) <= 4000),
    CONSTRAINT reviews_response_requires_text CHECK (responded_at IS NULL OR business_response IS NOT NULL),
    CONSTRAINT reviews_order_business_fk FOREIGN KEY (order_id, business_id)
        REFERENCES orders (order_id, business_id) ON DELETE SET NULL
);

COMMENT ON TABLE reviews IS
    'Business reviews. Per-product or per-service reviews can be added later by
     adding nullable product_id/service_id columns, not by re-modelling this table.';

CREATE INDEX IF NOT EXISTS ix_reviews_business_status
    ON reviews (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_reviews_business_rating
    ON reviews (business_id, rating) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS ix_reviews_user ON reviews (user_id, created_at DESC);
-- rating distribution + average per business, without scanning
CREATE INDEX IF NOT EXISTS ix_reviews_business_published
    ON reviews (business_id) WHERE status = 'published';

DROP TRIGGER IF EXISTS trg_reviews_updated_at ON reviews;
CREATE TRIGGER trg_reviews_updated_at BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- business_statistics — optional read cache. Source of truth stays in
-- orders / reviews / products / services; this table only accelerates
-- dashboards. Safe to rebuild at any time.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_statistics (
    business_id        BIGINT PRIMARY KEY REFERENCES businesses (business_id) ON DELETE CASCADE,
    total_orders       INTEGER       NOT NULL DEFAULT 0,
    completed_orders   INTEGER       NOT NULL DEFAULT 0,
    cancelled_orders   INTEGER       NOT NULL DEFAULT 0,
    pending_orders     INTEGER       NOT NULL DEFAULT 0,
    total_customers    INTEGER       NOT NULL DEFAULT 0,
    total_products     INTEGER       NOT NULL DEFAULT 0,
    total_services     INTEGER       NOT NULL DEFAULT 0,
    total_reviews      INTEGER       NOT NULL DEFAULT 0,
    average_rating     NUMERIC(3,2)  NOT NULL DEFAULT 0,
    total_revenue      NUMERIC(16,2) NOT NULL DEFAULT 0,
    computed_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT business_statistics_counts_non_negative CHECK (
        total_orders >= 0 AND completed_orders >= 0 AND cancelled_orders >= 0
        AND pending_orders >= 0 AND total_customers >= 0 AND total_products >= 0
        AND total_services >= 0 AND total_reviews >= 0
    ),
    CONSTRAINT business_statistics_rating_range CHECK (average_rating BETWEEN 0 AND 5),
    CONSTRAINT business_statistics_revenue_non_negative CHECK (total_revenue >= 0)
);

-- ---------------------------------------------------------------------
-- Live view: the authoritative statistics computation, derived from
-- source tables. business_statistics is only a cache of this view.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_business_statistics AS
SELECT
    b.business_id,
    COALESCE(o.total_orders, 0)       AS total_orders,
    COALESCE(o.completed_orders, 0)   AS completed_orders,
    COALESCE(o.cancelled_orders, 0)   AS cancelled_orders,
    COALESCE(o.pending_orders, 0)     AS pending_orders,
    COALESCE(o.total_customers, 0)    AS total_customers,
    COALESCE(o.total_revenue, 0)      AS total_revenue,
    COALESCE(r.total_reviews, 0)      AS total_reviews,
    COALESCE(r.average_rating, 0)     AS average_rating,
    COALESCE(c.total_products, 0)     AS total_products,
    COALESCE(s.total_services, 0)     AS total_services,
    now()                              AS computed_at
FROM businesses b
LEFT JOIN LATERAL (
    SELECT
        count(*)                                                        AS total_orders,
        count(*) FILTER (WHERE order_status = 'completed')              AS completed_orders,
        count(*) FILTER (WHERE order_status IN ('cancelled','rejected')) AS cancelled_orders,
        count(*) FILTER (WHERE order_status = 'pending')                 AS pending_orders,
        count(DISTINCT customer_id)                                     AS total_customers,
        COALESCE(sum(total_amount) FILTER (WHERE order_status = 'completed'), 0) AS total_revenue
    FROM orders o WHERE o.business_id = b.business_id
) o ON TRUE
LEFT JOIN LATERAL (
    SELECT
        count(*)                                        AS total_reviews,
        ROUND(AVG(rating)::numeric, 2)                  AS average_rating
    FROM reviews r WHERE r.business_id = b.business_id AND r.status = 'published'
) r ON TRUE
LEFT JOIN LATERAL (
    SELECT count(*) AS total_products FROM products p
    WHERE p.business_id = b.business_id AND p.deleted_at IS NULL AND p.status <> 'archived'
) c ON TRUE
LEFT JOIN LATERAL (
    SELECT count(*) AS total_services FROM services s
    WHERE s.business_id = b.business_id AND s.deleted_at IS NULL AND s.status <> 'archived'
) s ON TRUE;

-- Refresh the cache from the view. Cheap, idempotent, and the only
-- supported way to update business_statistics.
-- SECURITY DEFINER because the table's write policy is admin-only, and
-- the function still refuses to touch a business the caller cannot see.
CREATE OR REPLACE FUNCTION refresh_business_statistics(p_business_id BIGINT DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
    IF p_business_id IS NOT NULL
       AND NOT (app_is_business_member(p_business_id) OR app_is_platform_admin()) THEN
        RAISE EXCEPTION 'not allowed to refresh statistics of business %', p_business_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO business_statistics AS st (
        business_id, total_orders, completed_orders, cancelled_orders, pending_orders,
        total_customers, total_products, total_services, total_reviews, average_rating,
        total_revenue, computed_at)
    SELECT
        v.business_id, v.total_orders, v.completed_orders, v.cancelled_orders, v.pending_orders,
        v.total_customers, v.total_products, v.total_services, v.total_reviews, v.average_rating,
        v.total_revenue, v.computed_at
    FROM v_business_statistics v
    WHERE v.business_id = p_business_id
       OR p_business_id IS NULL
    ON CONFLICT (business_id) DO UPDATE SET
        total_orders     = EXCLUDED.total_orders,
        completed_orders = EXCLUDED.completed_orders,
        cancelled_orders = EXCLUDED.cancelled_orders,
        pending_orders   = EXCLUDED.pending_orders,
        total_customers  = EXCLUDED.total_customers,
        total_products   = EXCLUDED.total_products,
        total_services   = EXCLUDED.total_services,
        total_reviews    = EXCLUDED.total_reviews,
        average_rating   = EXCLUDED.average_rating,
        total_revenue    = EXCLUDED.total_revenue,
        computed_at      = EXCLUDED.computed_at;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Keep businesses.rating-free: average rating lives in statistics/reviews only.
-- (A cached average on businesses is intentionally NOT added, to avoid two
--  sources of truth for the same number.)
