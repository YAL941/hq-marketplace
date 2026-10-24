CREATE FUNCTION lock_order_inventory_products(p_business_id BIGINT, p_product_ids BIGINT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_product_id BIGINT;
BEGIN
    IF app_user_id() IS NULL OR p_product_ids IS NULL OR NOT app_business_is_public(p_business_id) THEN
        RAISE EXCEPTION 'not allowed to lock order inventory'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    FOR v_product_id IN
        SELECT DISTINCT requested.product_id
          FROM unnest(p_product_ids) AS requested(product_id)
         WHERE requested.product_id IS NOT NULL
         ORDER BY requested.product_id
    LOOP
        PERFORM 1
          FROM products p
         WHERE p.product_id = v_product_id
           AND p.business_id = p_business_id
           AND p.deleted_at IS NULL
           AND p.status = 'active'
         FOR UPDATE;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION lock_order_inventory_products(BIGINT, BIGINT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_order_inventory_products(BIGINT, BIGINT[]) TO PUBLIC;