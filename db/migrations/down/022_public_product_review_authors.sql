-- destructive: false
REVOKE ALL ON FUNCTION app_public_product_reviews(BIGINT, INTEGER, INTEGER) FROM PUBLIC;
DROP FUNCTION IF EXISTS app_public_product_reviews(BIGINT, INTEGER, INTEGER);
