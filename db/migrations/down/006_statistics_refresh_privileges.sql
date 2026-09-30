-- Rollback of 006_statistics_refresh_privileges.sql
-- Restores the 003 definition of refresh_business_statistics: same body, but
-- without SECURITY DEFINER, so the admin-only write policy on
-- business_statistics applies again.
-- This intentionally restores the original defect; the statistics endpoint
-- will fail for business owners until 006 is re-applied.
-- destructive: false

CREATE OR REPLACE FUNCTION refresh_business_statistics(p_business_id BIGINT DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
    IF p_business_id IS NOT NULL
       AND NOT (app_is_business_member(p_business_id) OR app_is_platform_admin()) THEN
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
$$ LANGUAGE plpgsql;
