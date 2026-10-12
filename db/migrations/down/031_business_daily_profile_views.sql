-- Historical daily counts cannot be restored to their original state once dropped.

DROP TABLE IF EXISTS business_profile_daily_views;

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
