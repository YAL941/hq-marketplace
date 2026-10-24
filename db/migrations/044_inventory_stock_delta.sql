CREATE FUNCTION apply_inventory_stock_delta(
    p_business_id BIGINT,
    p_product_id BIGINT,
    p_delta INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_quantity INTEGER;
BEGIN
    IF app_user_id() IS NULL
       OR NOT (app_has_business_permission(p_business_id, 'inventory.manage') OR app_is_platform_admin()) THEN
        RAISE EXCEPTION 'missing inventory.manage permission'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE products p
       SET stock_quantity = p.stock_quantity + p_delta
     WHERE p.business_id = p_business_id
       AND p.product_id = p_product_id
       AND p.is_stock_tracked
       AND p.stock_quantity + p_delta >= 0
     RETURNING p.stock_quantity INTO v_quantity;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'product stock total would become negative or product was not found'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_quantity;
END;
$$;

REVOKE ALL ON FUNCTION apply_inventory_stock_delta(BIGINT, BIGINT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_inventory_stock_delta(BIGINT, BIGINT, INTEGER) TO PUBLIC;