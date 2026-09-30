-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 006_statistics_refresh_privileges.sql
-- Fixes a defect in refresh_business_statistics() declared in 003.
--
-- The defect: the function writes to business_statistics, whose RLS write
-- policy is admin-only. 003 documented the function as SECURITY DEFINER
-- but did not actually declare it that way, so it executed with the
-- caller's privileges and every GET /api/business/:id/statistics from a
-- business owner failed with:
--     new row violates row-level security policy for table
--     "business_statistics"
--
-- Second, related defect: the argument check was skipped entirely when the
-- function was called with no argument, so "refresh every business" had no
-- authorisation at all. That is safe today only because RLS blocks the
-- writes; it would not be safe once the function gained elevated rights.
-- Both are corrected here.
-- =====================================================================

CREATE OR REPLACE FUNCTION refresh_business_statistics(p_business_id BIGINT DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
    -- Refreshing one business requires membership of that business.
    -- Refreshing every business requires platform authority.
    IF p_business_id IS NULL THEN
        IF NOT app_is_platform_admin() THEN
            RAISE EXCEPTION 'only a platform admin may refresh all businesses at once'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSIF NOT (app_is_business_member(p_business_id) OR app_is_platform_admin()) THEN
        RAISE EXCEPTION 'not allowed to refresh statistics of business %', p_business_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO business_statistics AS st (
        business_id, total_orders, completed_orders, cancelled_orders, pending_orders,
        total_customers, total_products, total_services, total_reviews, average_rating,
        total_revenue, computed_at)
    SELECT
        v.business_id, v.total_orders, v.completed_orders, v.cancelled_orders, v.pending_orders,
        v.total_customers, v.total_products, v.total_services, v.total_reviews, v.average_rating,
        v.total_revenue, v.computed_at
    FROM v_business_statistics v
    WHERE v.business_id = p_business_id
       OR p_business_id IS NULL
    ON CONFLICT (business_id) DO UPDATE SET
        total_orders     = EXCLUDED.total_orders,
        completed_orders = EXCLUDED.completed_orders,
        cancelled_orders = EXCLUDED.cancelled_orders,
        pending_orders   = EXCLUDED.pending_orders,
        total_customers  = EXCLUDED.total_customers,
        total_products   = EXCLUDED.total_products,
        total_services   = EXCLUDED.total_services,
        total_reviews    = EXCLUDED.total_reviews,
        average_rating   = EXCLUDED.average_rating,
        total_revenue    = EXCLUDED.total_revenue,
        computed_at      = EXCLUDED.computed_at;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION refresh_business_statistics(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_business_statistics(BIGINT) TO PUBLIC;

COMMENT ON FUNCTION refresh_business_statistics(BIGINT) IS
    'Rebuilds the business_statistics cache from v_business_statistics. Runs as the
     owner so the admin-only write policy on the cache does not block a business
     owner refreshing their own dashboard; authorisation is enforced by the
     explicit checks at the top of the function, not by RLS.';
