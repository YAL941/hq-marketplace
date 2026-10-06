-- =====================================================================
-- HQ Marketplace — Rollback for 013_geo_search.sql
-- Drops the three indexes migration 013 created. Nothing else existed
-- before them, and no table, column, policy or data was touched, so
-- removing them restores the schema exactly as 012 left it.
--
-- DROP INDEX IF NOT EXISTS does not exist in PostgreSQL, so DROP ... IF
-- EXISTS is used: safe to run twice, and the migrator runs each rollback
-- in a transaction so a failure leaves nothing half-dropped.
-- =====================================================================

DROP INDEX IF EXISTS ix_business_locations_business_geo;
DROP INDEX IF EXISTS ix_business_locations_bbox;
DROP INDEX IF EXISTS ix_business_locations_latitude;
