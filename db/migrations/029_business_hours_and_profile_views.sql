-- Owner-managed hours and anonymous, aggregate-only profile view counts.

CREATE TABLE IF NOT EXISTS business_profile_views (
    business_id BIGINT PRIMARY KEY REFERENCES businesses (business_id) ON DELETE CASCADE,
    total_views BIGINT NOT NULL DEFAULT 0 CHECK (total_views >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE business_profile_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_profile_views_staff_read ON business_profile_views;
CREATE POLICY business_profile_views_staff_read ON business_profile_views
    FOR SELECT USING (app_is_business_member(business_id) OR app_is_platform_admin());

DROP POLICY IF EXISTS business_profile_views_no_direct_write ON business_profile_views;
CREATE POLICY business_profile_views_no_direct_write ON business_profile_views
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
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION increment_business_profile_views(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_business_profile_views(BIGINT) TO PUBLIC;

COMMENT ON TABLE business_profile_views IS
    'Aggregate public profile page loads. No visitor identity, address, or device data is stored.';

COMMENT ON FUNCTION increment_business_profile_views(BIGINT) IS
    'Atomically counts a successfully served public business profile. Private businesses are ignored.';
