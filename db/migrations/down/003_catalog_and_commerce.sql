-- destructive: true
-- Rollback of 003_catalog_and_commerce.sql
-- DESTRUCTIVE BY DESIGN: only safe while the platform holds no real
-- business data. The migration runner refuses to run it in production
-- without --allow-data-loss.

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS business_statistics;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS product_categories;
DROP TABLE IF EXISTS service_categories;

DROP FUNCTION IF EXISTS set_order_number();

DROP TYPE IF EXISTS review_status;
DROP TYPE IF EXISTS order_item_type;
DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS order_type;
DROP TYPE IF EXISTS catalog_status;
