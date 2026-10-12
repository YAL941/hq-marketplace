-- Removes the aggregate profile view counter. No visitor-level data is stored.
DROP FUNCTION IF EXISTS increment_business_profile_views(BIGINT);
DROP TABLE IF EXISTS business_profile_views;
