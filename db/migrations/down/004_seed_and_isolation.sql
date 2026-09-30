-- Rollback of 004_seed_and_isolation.sql
-- Removes RLS policies, the single-owner index, seeded roles/permissions
-- and the catalog seed rows. It is marked destructive because the seeded
-- rows are referenced by business data: on a database that already contains
-- businesses, this script fails on a foreign key and rolls back instead of
-- deleting anything. Use it on an empty database.
-- destructive: true

DROP VIEW IF EXISTS v_business_statistics;
DROP FUNCTION IF EXISTS refresh_business_statistics(BIGINT);

-- RLS policies disappear with the tables, but drop them explicitly so a
-- partial rollback of a single table stays possible.
DROP POLICY IF EXISTS users_select_self_or_admin ON users;
DROP POLICY IF EXISTS users_update_self_or_admin ON users;
DROP POLICY IF EXISTS businesses_public_read ON businesses;
DROP POLICY IF EXISTS businesses_staff_read ON businesses;
DROP POLICY IF EXISTS businesses_staff_update ON businesses;
DROP POLICY IF EXISTS businesses_admin_write ON businesses;
DROP POLICY IF EXISTS businesses_user_create ON businesses;
DROP POLICY IF EXISTS businesses_admin_delete ON businesses;
DROP POLICY IF EXISTS business_users_read ON business_users;
DROP POLICY IF EXISTS business_users_write ON business_users;
DROP POLICY IF EXISTS business_users_claim_ownership ON business_users;
DROP POLICY IF EXISTS business_users_accept_invite ON business_users;
DROP POLICY IF EXISTS business_locations_public_read ON business_locations;
DROP POLICY IF EXISTS business_locations_staff ON business_locations;
DROP POLICY IF EXISTS products_public_read ON products;
DROP POLICY IF EXISTS products_staff ON products;
DROP POLICY IF EXISTS services_public_read ON services;
DROP POLICY IF EXISTS services_staff ON services;
DROP POLICY IF EXISTS orders_participant_read ON orders;
DROP POLICY IF EXISTS orders_customer_insert ON orders;
DROP POLICY IF EXISTS orders_business_update ON orders;
DROP POLICY IF EXISTS orders_customer_cancel ON orders;
DROP POLICY IF EXISTS orders_no_delete ON orders;
DROP POLICY IF EXISTS order_items_participant_read ON order_items;
DROP POLICY IF EXISTS order_items_write ON order_items;
DROP POLICY IF EXISTS reviews_public_read ON reviews;
DROP POLICY IF EXISTS reviews_staff_read ON reviews;
DROP POLICY IF EXISTS reviews_customer_insert ON reviews;
DROP POLICY IF EXISTS reviews_staff_update ON reviews;
DROP POLICY IF EXISTS reviews_author_update ON reviews;
DROP POLICY IF EXISTS reviews_no_delete ON reviews;
DROP POLICY IF EXISTS business_statistics_read ON business_statistics;
DROP POLICY IF EXISTS business_statistics_no_write ON business_statistics;

DROP INDEX IF EXISTS ux_business_users_single_owner;

-- Seeded catalog rows (only ones this migration inserted)
DELETE FROM role_permissions WHERE role_id IN (SELECT role_id FROM roles WHERE is_system);
DELETE FROM user_platform_roles WHERE role_id IN (SELECT role_id FROM roles WHERE is_system);
DELETE FROM roles WHERE is_system;
DELETE FROM permissions;
DELETE FROM service_categories;
DELETE FROM product_categories;
DELETE FROM business_categories;

DROP FUNCTION IF EXISTS app_user_for_login(TEXT);
DROP FUNCTION IF EXISTS app_business_has_no_members(BIGINT);
DROP FUNCTION IF EXISTS app_business_ids();
DROP FUNCTION IF EXISTS app_has_business_permission(BIGINT, TEXT);
DROP FUNCTION IF EXISTS app_is_business_member(BIGINT);
DROP FUNCTION IF EXISTS app_business_is_public(BIGINT);
DROP FUNCTION IF EXISTS app_current_business_id();
DROP FUNCTION IF EXISTS app_is_platform_admin();
DROP FUNCTION IF EXISTS app_user_id();
