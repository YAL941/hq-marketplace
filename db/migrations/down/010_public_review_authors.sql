-- Rollback of 010_public_review_authors.sql
-- Removes the SECURITY DEFINER review reader.
--
-- The public reviews endpoint stops working after this: the API falls back to
-- querying reviews and users directly, and the join to users is filtered by row
-- level security, so an anonymous caller receives zero reviews instead of an
-- error. That is expected: the function is what makes the endpoint possible.
-- destructive: false

REVOKE ALL ON FUNCTION app_public_reviews(BIGINT, INTEGER, INTEGER) FROM PUBLIC;
DROP FUNCTION IF EXISTS app_public_reviews(BIGINT, INTEGER, INTEGER);
