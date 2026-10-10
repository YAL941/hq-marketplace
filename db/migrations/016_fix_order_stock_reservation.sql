CREATE OR REPLACE FUNCTION reserve_order_product(
    p_product_id BIGINT,
    p_business_id BIGINT,
    p_quantity INTEGER
)
RETURNS TABLE (
    reservation_status TEXT,
    product_name TEXT,
    price NUMERIC(14, 2),
    discount_price NUMERIC(14, 2),
    currency TEXT,
    stock_quantity INTEGER,
    is_stock_tracked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_product products%ROWTYPE;
BEGIN
    IF app_user_id() IS NULL OR p_quantity <= 0 OR NOT app_business_is_public(p_business_id) THEN
        RAISE EXCEPTION 'not allowed to reserve product stock'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT p.* INTO v_product
      FROM products p
     WHERE p.product_id = p_product_id
       AND p.business_id = p_business_id
       AND p.deleted_at IS NULL
       AND p.status = 'active'
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found'::TEXT, NULL::TEXT, NULL::NUMERIC(14, 2),
                            NULL::NUMERIC(14, 2), NULL::TEXT, NULL::INTEGER, NULL::BOOLEAN;
        RETURN;
    END IF;

    IF v_product.is_stock_tracked AND v_product.stock_quantity < p_quantity THEN
        RETURN QUERY SELECT 'shortage'::TEXT, NULL::TEXT, NULL::NUMERIC(14, 2),
                            NULL::NUMERIC(14, 2), NULL::TEXT, NULL::INTEGER, NULL::BOOLEAN;
        RETURN;
    END IF;

    IF v_product.is_stock_tracked THEN
        UPDATE products AS p
           SET stock_quantity = p.stock_quantity - p_quantity
         WHERE p.product_id = p_product_id
           AND p.business_id = p_business_id
         RETURNING p.* INTO v_product;
    END IF;

    RETURN QUERY SELECT 'reserved'::TEXT, v_product.product_name, v_product.price,
                        v_product.discount_price, v_product.currency::TEXT,
                        v_product.stock_quantity, v_product.is_stock_tracked;
END;
$$;
