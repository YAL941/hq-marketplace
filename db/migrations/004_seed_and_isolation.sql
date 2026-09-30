-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 004_seed_and_isolation.sql
-- Seeds roles / permissions / category catalogs, adds the single-owner
-- constraint, and turns on Row Level Security: the database itself
-- refuses to return another business's rows, even if application code
-- is wrong.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
INSERT INTO roles (role_key, role_name, description, scope, rank, is_system) VALUES
    ('platform_admin',    'Platform Admin',    'Runs the HQ Marketplace platform itself',            'platform', 100, TRUE),
    ('platform_support',  'Platform Support',  'Read-only support access to business data on request', 'platform',  50, TRUE),
    ('customer',          'Customer',          'Platform-wide shopper with no business membership',    'platform',  10, TRUE),
    ('business_owner',    'Business Owner',    'Full control of one business, incl. employees',        'business', 100, TRUE),
    ('business_manager',  'Business Manager',  'Runs day-to-day operations of one business',           'business',  70, TRUE),
    ('business_employee', 'Business Employee', 'Limited operational access to one business',           'business',  40, TRUE)
ON CONFLICT (role_key, scope) DO NOTHING;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
INSERT INTO permissions (permission_key, resource, action, description) VALUES
    ('business.view',      'business', 'view',     'View the business profile and its public data'),
    ('business.edit',      'business', 'edit',     'Edit the business profile of the current business'),
    ('products.view',      'products', 'view',     'List and read products of the current business'),
    ('products.create',    'products', 'create',   'Create a product in the current business'),
    ('products.edit',      'products', 'edit',     'Edit a product of the current business'),
    ('products.delete',    'products', 'delete',   'Archive a product of the current business'),
    ('services.view',      'services', 'view',     'List and read services of the current business'),
    ('services.create',    'services', 'create',   'Create a service in the current business'),
    ('services.edit',      'services', 'edit',     'Edit a service of the current business'),
    ('services.delete',    'services', 'delete',   'Archive a service of the current business'),
    ('locations.view',     'locations','view',     'List branches of the current business'),
    ('locations.manage',   'locations','manage',   'Create, edit and close branches'),
    ('orders.view',        'orders',   'view',     'Read orders of the current business'),
    ('orders.create',      'orders',   'create',   'Place an order against a business'),
    ('orders.update',      'orders',   'update',   'Update order status, prices and notes'),
    ('orders.cancel',      'orders',   'cancel',   'Cancel an order of the current business'),
    ('reviews.view',       'reviews',  'view',     'Read reviews of the current business'),
    ('reviews.create',     'reviews',  'create',   'Write a review for a business'),
    ('reviews.respond',    'reviews',  'respond',  'Reply publicly to a review of the current business'),
    ('reviews.moderate',   'reviews',  'moderate', 'Show or hide a review of the current business'),
    ('analytics.view',     'analytics','view',     'Read statistics of the current business'),
    ('employees.manage',   'employees','manage',   'Invite, change role and remove business members'),
    ('categories.manage',  'categories','manage',  'Create and edit platform-wide categories'),
    ('business.verify',    'business', 'verify',   'Approve or reject a business verification request'),
    ('users.manage',       'users',   'manage',   'Manage platform users and platform roles')
ON CONFLICT (permission_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Role -> permission grants
-- ---------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_key = 'business_owner'
  AND p.permission_key IN (
      'business.view','business.edit',
      'products.view','products.create','products.edit','products.delete',
      'services.view','services.create','services.edit','services.delete',
      'locations.view','locations.manage',
      'orders.view','orders.create','orders.update','orders.cancel',
      'reviews.view','reviews.create','reviews.respond','reviews.moderate',
      'analytics.view','employees.manage'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_key = 'business_manager'
  AND p.permission_key IN (
      'business.view','business.edit',
      'products.view','products.create','products.edit','products.delete',
      'services.view','services.create','services.edit','services.delete',
      'locations.view','locations.manage',
      'orders.view','orders.create','orders.update','orders.cancel',
      'reviews.view','reviews.respond','analytics.view'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_key = 'business_employee'
  AND p.permission_key IN (
      'business.view',
      'products.view','products.edit',
      'services.view','services.edit',
      'locations.view',
      'orders.view','orders.update',
      'reviews.view'
  )
ON CONFLICT DO NOTHING;

-- platform_admin holds every permission, including the platform-only ones
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'platform_admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_key = 'customer'
  AND p.permission_key IN (
      'business.view','products.view','services.view',
      'orders.view','orders.create','orders.cancel',
      'reviews.view','reviews.create'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_key = 'platform_support'
  AND p.permission_key IN (
      'business.view','products.view','services.view','locations.view',
      'orders.view','reviews.view','analytics.view'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Business category catalog (extensible: admin INSERT, no schema change)
-- ---------------------------------------------------------------------
INSERT INTO business_categories (category_name, category_slug, description, sort_order) VALUES
    ('Healthcare',             'healthcare',             'Hospitals, clinics, pharmacies, labs',                10),
    ('Restaurants',            'restaurants',            'Restaurants, cafes, bakeries, food outlets',           20),
    ('Grocery & Retail',       'grocery-retail',         'Supermarkets, groceries, general retail',             30),
    ('Hotels',                 'hotels',                 'Hotels, guest houses, serviced apartments',          40),
    ('Events & Venues',        'events-venues',          'Halls, wedding venues, event spaces',                 50),
    ('Agriculture',            'agriculture',            'Farms, nurseries, agriculture suppliers',            60),
    ('Education',              'education',              'Schools, training centres, tutoring',                 70),
    ('Transportation',         'transportation',         'Transport, delivery, logistics, rental vehicles',     80),
    ('Professional Services',  'professional-services',  'Consulting, accounting, legal, marketing',            90),
    ('Technology',             'technology',             'IT companies, software, electronics, repair',        100),
    ('Beauty & Wellness',      'beauty-wellness',        'Salons, spas, fitness, medical aesthetics',         110),
    ('Local Products',         'local-products',         'Handmade and local product makers',                 120),
    ('Other',                  'other',                  'Anything that does not fit the categories above',   999)
ON CONFLICT (category_slug) DO NOTHING;

INSERT INTO product_categories (category_name, category_slug) VALUES
    ('Food & Beverage', 'food-beverage'), ('Groceries', 'groceries'),
    ('Fashion', 'fashion'), ('Electronics', 'electronics'), ('Home & Living', 'home-living'),
    ('Health & Beauty', 'health-beauty'), ('Books & Stationery', 'books-stationery'),
    ('Sports & Outdoor', 'sports-outdoor'), ('Handmade', 'handmade'), ('Other', 'other')
ON CONFLICT (category_slug) DO NOTHING;

INSERT INTO service_categories (category_name, category_slug) VALUES
    ('Medical Consultation', 'medical-consultation'), ('Diagnostics & Lab', 'diagnostics-lab'),
    ('Accommodation & Booking', 'accommodation-booking'), ('Events & Catering', 'events-catering'),
    ('Repair & Maintenance', 'repair-maintenance'), ('Education & Training', 'education-training'),
    ('Consulting', 'consulting'), ('Beauty & Wellness', 'beauty-wellness'),
    ('Transport & Delivery', 'transport-delivery'), ('Other', 'other')
ON CONFLICT (category_slug) DO NOTHING;

-- ---------------------------------------------------------------------
-- A business has at most ONE active owner.
-- Built with dynamic SQL because a subquery is not allowed in an index
-- predicate; role_id is only known after the seed above.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_owner_role_id BIGINT;
BEGIN
    SELECT role_id INTO v_owner_role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business';
    IF v_owner_role_id IS NULL THEN
        RAISE EXCEPTION 'business_owner role missing; run seeds before this migration step';
    END IF;
    EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS ux_business_users_single_owner
             ON business_users (business_id)
             WHERE role_id = %s AND status = ''active''', v_owner_role_id);
END $$;

-- =====================================================================
-- Request context helpers.
-- The backend sets, inside every transaction:
--     SET LOCAL app.user_id            = '<user id>'
--     SET LOCAL app.is_platform_admin  = 'true' | 'false'
--     SET LOCAL app.current_business_id = '<business id>'   (optional)
-- They are set with SET LOCAL inside a transaction, so they cannot leak
-- to the next pooled connection.
-- =====================================================================

CREATE OR REPLACE FUNCTION app_user_id() RETURNS BIGINT
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_id', TRUE), '')::BIGINT;
$$;

CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('app.is_platform_admin', TRUE), '')::BOOLEAN, FALSE);
$$;

CREATE OR REPLACE FUNCTION app_current_business_id() RETURNS BIGINT
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_business_id', TRUE), '')::BIGINT;
$$;

-- SECURITY DEFINER so the lookup is not itself blocked by RLS on
-- business_users (that would be infinite recursion).
CREATE OR REPLACE FUNCTION app_is_business_member(p_business_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM business_users bu
        WHERE bu.business_id = p_business_id
          AND bu.user_id = app_user_id()
          AND bu.status = 'active'
    );
$$;

-- Does the current user hold a business-scoped permission in that business?
CREATE OR REPLACE FUNCTION app_has_business_permission(p_business_id BIGINT, p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
        FROM business_users bu
        JOIN roles r ON r.role_id = bu.role_id AND r.scope = 'business' AND r.is_active
        JOIN role_permissions rp ON rp.role_id = r.role_id
        JOIN permissions p ON p.permission_id = rp.permission_id
        WHERE bu.business_id = p_business_id
          AND bu.user_id = app_user_id()
          AND bu.status = 'active'
          AND p.permission_key = p_permission_key
    );
$$;

-- Businesses the current user belongs to, as an active membership.
CREATE OR REPLACE FUNCTION app_business_ids() RETURNS SETOF BIGINT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT DISTINCT bu.business_id
    FROM business_users bu
    WHERE bu.user_id = app_user_id() AND bu.status = 'active';
$$;

-- Is the business visible to an anonymous visitor? (public directory)
CREATE OR REPLACE FUNCTION app_business_is_public(p_business_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM businesses b
        WHERE b.business_id = p_business_id
          AND b.status = 'active'
          AND b.deleted_at IS NULL
    );
$$;

-- Does this business still have no member at all? (onboarding guard)
CREATE OR REPLACE FUNCTION app_business_has_no_members(p_business_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = p_business_id);
$$;

-- Login lookup. SECURITY DEFINER because an anonymous visitor cannot read
-- users at all. It returns the password hash, so the API must never expose
-- this result directly - it is only used to verify a bcrypt hash.
CREATE OR REPLACE FUNCTION app_user_for_login(p_email TEXT)
RETURNS TABLE (
    user_id BIGINT,
    email CITEXT,
    password_hash TEXT,
    status user_status,
    full_name TEXT,
    is_platform_admin BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT
        u.user_id,
        u.email,
        u.password_hash,
        u.status,
        u.full_name,
        EXISTS (
            SELECT 1
            FROM user_platform_roles upr
            JOIN roles r ON r.role_id = upr.role_id
            WHERE upr.user_id = u.user_id
              AND r.role_key = 'platform_admin'
              AND r.scope = 'platform'
              AND r.is_active
        ) AS is_platform_admin
    FROM users u
    WHERE u.email = p_email;
$$;

COMMENT ON FUNCTION app_business_ids() IS
    'Business ids of the current user. SECURITY DEFINER + table owner bypasses RLS on business_users, which prevents policy recursion.';

-- =====================================================================
-- ROW LEVEL SECURITY
-- Principle: the public marketplace catalogue is readable by anyone,
-- while every operational table is readable only by the owning business,
-- the platform admin, or (for orders) the customer who placed them.
-- =====================================================================

-- ---------- users ----------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_self_or_admin ON users;
CREATE POLICY users_select_self_or_admin ON users
    FOR SELECT USING (
        user_id = app_user_id()
        OR app_is_platform_admin()
        -- staff may see the profile of a user who shares their business
        OR EXISTS (SELECT 1 FROM app_business_ids() ab
                   JOIN business_users bu2 ON bu2.business_id = ab
                   WHERE bu2.user_id = users.user_id AND bu2.status = 'active')
    );
DROP POLICY IF EXISTS users_update_self_or_admin ON users;
CREATE POLICY users_update_self_or_admin ON users
    FOR UPDATE USING (user_id = app_user_id() OR app_is_platform_admin())
    WITH CHECK (user_id = app_user_id() OR app_is_platform_admin());

-- ---------- businesses ----------
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS businesses_public_read ON businesses;
CREATE POLICY businesses_public_read ON businesses
    FOR SELECT USING (app_business_is_public(business_id));
DROP POLICY IF EXISTS businesses_staff_read ON businesses;
CREATE POLICY businesses_staff_read ON businesses
    FOR SELECT USING (app_is_business_member(business_id) OR app_is_platform_admin());
DROP POLICY IF EXISTS businesses_staff_update ON businesses;
CREATE POLICY businesses_staff_update ON businesses
    FOR UPDATE
    USING (app_is_business_member(business_id) OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'business.edit') OR app_is_platform_admin());
DROP POLICY IF EXISTS businesses_admin_write ON businesses;
CREATE POLICY businesses_admin_write ON businesses
    FOR INSERT WITH CHECK (app_is_platform_admin());
-- onboarding: any authenticated user may register a NEW business, but only
-- in a state that cannot be mistaken for an approved one
DROP POLICY IF EXISTS businesses_user_create ON businesses;
CREATE POLICY businesses_user_create ON businesses
    FOR INSERT WITH CHECK (
        app_user_id() IS NOT NULL
        AND status = 'pending'
        AND verification_status = 'pending'
        AND is_verified = FALSE
        AND deleted_at IS NULL
    );
DROP POLICY IF EXISTS businesses_admin_delete ON businesses;
CREATE POLICY businesses_admin_delete ON businesses
    FOR DELETE USING (app_is_platform_admin());

-- ---------- business_users ----------
ALTER TABLE business_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_users_read ON business_users;
CREATE POLICY business_users_read ON business_users
    FOR SELECT USING (user_id = app_user_id() OR app_is_business_member(business_id) OR app_is_platform_admin());
DROP POLICY IF EXISTS business_users_write ON business_users;
CREATE POLICY business_users_write ON business_users
    FOR ALL
    USING (app_has_business_permission(business_id, 'employees.manage') OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'employees.manage') OR app_is_platform_admin());
-- onboarding: the first member of a brand new business claims it as owner
DROP POLICY IF EXISTS business_users_claim_ownership ON business_users;
CREATE POLICY business_users_claim_ownership ON business_users
    FOR INSERT WITH CHECK (user_id = app_user_id() AND app_business_has_no_members(business_id));
-- a user may claim their own membership invitation
DROP POLICY IF EXISTS business_users_accept_invite ON business_users;
CREATE POLICY business_users_accept_invite ON business_users
    FOR UPDATE USING (user_id = app_user_id() AND status = 'invited')
    WITH CHECK (user_id = app_user_id() AND status = 'active');

-- ---------- business_locations ----------
ALTER TABLE business_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_locations_public_read ON business_locations;
CREATE POLICY business_locations_public_read ON business_locations
    FOR SELECT USING (app_business_is_public(business_id) AND is_active);
DROP POLICY IF EXISTS business_locations_staff ON business_locations;
CREATE POLICY business_locations_staff ON business_locations
    FOR ALL USING (app_is_business_member(business_id) OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'locations.manage') OR app_is_platform_admin());

-- ---------- products ----------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_public_read ON products;
CREATE POLICY products_public_read ON products
    FOR SELECT USING (status = 'active' AND deleted_at IS NULL AND app_business_is_public(business_id));
DROP POLICY IF EXISTS products_staff ON products;
CREATE POLICY products_staff ON products
    FOR ALL USING (app_is_business_member(business_id) OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'products.create')
                OR app_has_business_permission(business_id, 'products.edit')
                OR app_is_platform_admin());

-- ---------- services ----------
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS services_public_read ON services;
CREATE POLICY services_public_read ON services
    FOR SELECT USING (status = 'active' AND deleted_at IS NULL AND app_business_is_public(business_id));
DROP POLICY IF EXISTS services_staff ON services;
CREATE POLICY services_staff ON services
    FOR ALL USING (app_is_business_member(business_id) OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'services.create')
                OR app_has_business_permission(business_id, 'services.edit')
                OR app_is_platform_admin());

-- ---------- orders ----------
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- The customer who placed the order may read it, and the owning business.
DROP POLICY IF EXISTS orders_participant_read ON orders;
CREATE POLICY orders_participant_read ON orders
    FOR SELECT USING (customer_id = app_user_id() OR app_is_business_member(business_id) OR app_is_platform_admin());
DROP POLICY IF EXISTS orders_customer_insert ON orders;
CREATE POLICY orders_customer_insert ON orders
    FOR INSERT WITH CHECK (
        customer_id = app_user_id()
        AND app_business_is_public(business_id)
    );
-- The business advances the order lifecycle.
DROP POLICY IF EXISTS orders_business_update ON orders;
CREATE POLICY orders_business_update ON orders
    FOR UPDATE
    USING (app_is_business_member(business_id) OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'orders.update') OR app_is_platform_admin());
-- A customer may cancel their own order while it is still pending.
DROP POLICY IF EXISTS orders_customer_cancel ON orders;
CREATE POLICY orders_customer_cancel ON orders
    FOR UPDATE USING (customer_id = app_user_id() AND order_status = 'pending')
    WITH CHECK (customer_id = app_user_id());
-- No hard deletes: order history is financial data.
DROP POLICY IF EXISTS orders_no_delete ON orders;
CREATE POLICY orders_no_delete ON orders
    FOR DELETE USING (FALSE);

-- ---------- order_items ----------
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_participant_read ON order_items;
CREATE POLICY order_items_participant_read ON order_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders o
            WHERE o.order_id = order_items.order_id
              AND (o.customer_id = app_user_id()
                   OR app_is_business_member(o.business_id)
                   OR app_is_platform_admin())
        )
    );
-- a customer may add items to their own new order, business staff may edit
-- the items of the orders they own
DROP POLICY IF EXISTS order_items_write ON order_items;
CREATE POLICY order_items_write ON order_items
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM orders o
            WHERE o.order_id = order_items.order_id
              AND (o.customer_id = app_user_id()
                   OR app_is_business_member(o.business_id)
                   OR app_is_platform_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM orders o
            WHERE o.order_id = order_items.order_id
              AND (o.customer_id = app_user_id()
                   OR app_has_business_permission(o.business_id, 'orders.update')
                   OR app_is_platform_admin())
        )
    );

-- ---------- reviews ----------
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reviews_public_read ON reviews;
CREATE POLICY reviews_public_read ON reviews
    FOR SELECT USING (status = 'published' AND app_business_is_public(business_id));
DROP POLICY IF EXISTS reviews_staff_read ON reviews;
CREATE POLICY reviews_staff_read ON reviews
    FOR SELECT USING (app_is_business_member(business_id) OR app_is_platform_admin());
DROP POLICY IF EXISTS reviews_customer_insert ON reviews;
CREATE POLICY reviews_customer_insert ON reviews
    FOR INSERT WITH CHECK (
        user_id = app_user_id()
        AND status = 'pending'
        AND app_business_is_public(business_id)
    );
DROP POLICY IF EXISTS reviews_staff_update ON reviews;
CREATE POLICY reviews_staff_update ON reviews
    FOR UPDATE USING (app_is_business_member(business_id) OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'reviews.respond')
                OR app_has_business_permission(business_id, 'reviews.moderate')
                OR app_is_platform_admin());
DROP POLICY IF EXISTS reviews_author_update ON reviews;
CREATE POLICY reviews_author_update ON reviews
    FOR UPDATE USING (user_id = app_user_id() AND status = 'pending')
    WITH CHECK (user_id = app_user_id());
DROP POLICY IF EXISTS reviews_no_delete ON reviews;
CREATE POLICY reviews_no_delete ON reviews
    FOR DELETE USING (app_is_platform_admin());

-- ---------- business_statistics ----------
ALTER TABLE business_statistics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_statistics_read ON business_statistics;
CREATE POLICY business_statistics_read ON business_statistics
    FOR SELECT USING (app_is_business_member(business_id) OR app_is_platform_admin());
DROP POLICY IF EXISTS business_statistics_no_write ON business_statistics;
CREATE POLICY business_statistics_no_write ON business_statistics
    FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

-- ---------- reference catalogs (read-only for the app role) ----------
-- business_categories, product_categories, service_categories, roles,
-- permissions and role_permissions are readable by everyone and written
-- only by migrations / the platform admin connection.

-- ---------------------------------------------------------------------
-- The RLS view must obey isolation too.
-- ---------------------------------------------------------------------
ALTER VIEW v_business_statistics SET (security_invoker = ON);
