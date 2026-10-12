-- Daily anonymous aggregates make weekly profile-visit analytics possible.
-- Existing total counts are preserved; daily history starts with this migration.

CREATE TABLE IF NOT EXISTS business_profile_daily_views (
    business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE CASCADE,
    view_date DATE NOT NULL,
    total_views BIGINT NOT NULL DEFAULT 0 CHECK (total_views >= 0),
    PRIMARY KEY (business_id, view_date)
);

ALTER TABLE business_profile_daily_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_profile_daily_views_staff_read ON business_profile_daily_views;
CREATE POLICY business_profile_daily_views_staff_read ON business_profile_daily_views
    FOR SELECT USING (app_is_business_member(business_id) OR app_is_platform_admin());

DROP POLICY IF EXISTS business_profile_daily_views_no_direct_write ON business_profile_daily_views;
CREATE POLICY business_profile_daily_views_no_direct_write ON business_profile_daily_views
    FOR ALL USING (FALSE) WITH CHECK (FALSE);

CREATE OR REPLACE FUNCTION increment_business_profile_views(p_business_id BIGINT)
RETURNS VOID AS $$
BEGIN
    INSERT INTO business_profile_views (business_id, total_views, updated_at)
    SELECT b.business_id, 1, now()
      FROM businesses b
     WHERE b.business_id = p_business_id
       AND b.status = 'active'
       AND b.is_verified = TRUE
       AND b.verification_status = 'verified'
       AND b.deleted_at IS NULL
    ON CONFLICT (business_id) DO UPDATE
       SET total_views = business_profile_views.total_views + 1,
           updated_at = now();

    INSERT INTO business_profile_daily_views (business_id, view_date, total_views)
    SELECT b.business_id, CURRENT_DATE, 1
      FROM businesses b
     WHERE b.business_id = p_business_id
       AND b.status = 'active'
       AND b.is_verified = TRUE
       AND b.verification_status = 'verified'
       AND b.deleted_at IS NULL
    ON CONFLICT (business_id, view_date) DO UPDATE
       SET total_views = business_profile_daily_views.total_views + 1;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION increment_business_profile_views(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_business_profile_views(BIGINT) TO PUBLIC;

COMMENT ON TABLE business_profile_daily_views IS
    'Daily aggregate public profile page loads. No visitor-level data is stored.';
