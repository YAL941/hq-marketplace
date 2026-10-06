-- =====================================================================
-- HQ Marketplace — Phase 2 / Geographic Search
-- 013_geo_search.sql
-- Index support for "nearest businesses" and location-aware directory
-- queries.
--
-- Everything here is additive. No existing column is retyped, no existing
-- policy is widened, and no data is rewritten, so a rollback of this file
-- leaves the schema exactly as 012 left it.
--
-- Why anything is needed at all:
--   * business_locations already stores latitude/longitude as DOUBLE
--     PRECISION since migration 002, but there is no index that helps a
--     "branches near me" query: the existing indexes only cover
--     (business_id, is_active) and (city, district);
--   * the public directory answers /api/businesses from a businesses row
--     alone, so a customer who shares their location sees businesses ordered
--     by created_at even when a closer branch exists.
--
-- Design decision — no PostGIS:
--   PostGIS would give ST_DWithin and GiST distance ordering, but it is an
--   extra extension a deployment has to install, and for a city-level
--   directory the haversine distance computed in plain SQL over a small
--   prefiltered set is fast enough and exact to well under a metre. Keeping
--     the extension out of the critical path keeps `npm run db:setup`
--   self-contained. If scale ever demands PostGIS, adding it later is
--   purely additive: this migration creates no column a later GiST index
--     would conflict with.
--
-- Coordinates stay DOUBLE PRECISION. PostGIS geography points, geohash
--   strings and cube/earthdistance are all rejected for the same reason:
--   they introduce a second source of truth for the position of a branch,
--   and two sources of truth drift.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Latitude index
-- ---------------------------------------------------------------------
-- The nearest query pre-filters to a latitude band before computing
-- haversine distances. A btree on latitude alone lets the planner pick
-- the band rows out of the table in sorted order instead of scanning it.
CREATE INDEX IF NOT EXISTS ix_business_locations_latitude
    ON business_locations (latitude)
    WHERE is_active AND latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON INDEX ix_business_locations_latitude IS
    'Prefilter band for nearest-business search. Partial: the query only '
    'ever considers active branches that carry both coordinates.';

-- ---------------------------------------------------------------------
-- 2. Bounding-box index (latitude, longitude)
-- ---------------------------------------------------------------------
-- A nearest query first restricts to a bounding box around the caller,
-- and this composite index matches that restriction directly. It is the
-- one index this migration exists for; the latitude-only index above is
-- a narrower variant kept because a business-level city filter
-- (`?city=`) can use it on its own.
CREATE INDEX IF NOT EXISTS ix_business_locations_bbox
    ON business_locations (latitude, longitude)
    WHERE is_active AND latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON INDEX ix_business_locations_bbox IS
    'Bounding-box prefilter for nearest-business haversine search over '
    'active branches with coordinates.';

-- ---------------------------------------------------------------------
-- 3. Business-publicity join helper index
-- ---------------------------------------------------------------------
-- The nearest query joins business_locations to businesses and keeps only
-- public businesses. This index gives that join a cheap starting point.
-- It duplicates part of ix_business_locations_business but is partial
-- (is_active AND coordinates present), so the planner can choose it for
-- the geo path without paying for inactive or coordinate-less rows.
CREATE INDEX IF NOT EXISTS ix_business_locations_business_geo
    ON business_locations (business_id, latitude, longitude)
    WHERE is_active AND latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON INDEX ix_business_locations الفbusiness_geo IS
    'Join entry point for nearest-business search: business_id first so the '
    'join to businesses picks rows in businesses-key order, with coordinates '
    'present so no heap fetch is wasted on a coordinate-less branch.';
