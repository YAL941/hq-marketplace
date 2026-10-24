CREATE OR REPLACE FUNCTION restock_cancelled_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.order_status IN ('cancelled', 'rejected')
       AND OLD.order_status NOT IN ('cancelled', 'rejected') THEN
        UPDATE products AS p
           SET stock_quantity = p.stock_quantity + s.qty
          FROM (
              SELECT oi.product_id, oi.business_id, SUM(oi.quantity)::INTEGER AS qty
                FROM order_items oi
               WHERE oi.order_id = NEW.order_id AND oi.product_id IS NOT NULL
               GROUP BY oi.product_id, oi.business_id
          ) AS s
         WHERE p.product_id = s.product_id
           AND p.business_id = s.business_id
           AND p.is_stock_tracked;
    END IF;
    RETURN NEW;
END;
$$;

DROP FUNCTION reserve_order_product(BIGINT, BIGINT, INTEGER, BIGINT);

CREATE FUNCTION reserve_order_product(
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
        UPDATE products p
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

REVOKE ALL ON FUNCTION reserve_order_product(BIGINT, BIGINT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_order_product(BIGINT, BIGINT, INTEGER) TO PUBLIC;

DROP TRIGGER IF EXISTS trg_stock_restock_requests_updated_at ON stock_restock_requests;
DROP TRIGGER IF EXISTS trg_inventory_balances_updated_at ON inventory_balances;
DROP TABLE stock_restock_requests;
DROP TABLE stock_movements;
DROP TABLE inventory_balances;

ALTER TABLE order_items
    DROP CONSTRAINT order_items_inventory_location_business_fk,
    DROP COLUMN inventory_location_id;

ALTER TABLE products
    DROP CONSTRAINT products_unit_of_measure_valid,
    DROP CONSTRAINT products_minimum_stock_non_negative,
    DROP CONSTRAINT products_barcode_valid,
    DROP CONSTRAINT products_business_barcode_unique,
    DROP COLUMN unit_of_measure,
    DROP COLUMN minimum_stock,
    DROP COLUMN barcode;

DELETE FROM role_permissions rp
 USING permissions p
 WHERE rp.permission_id = p.permission_id
   AND p.permission_key IN ('inventory.view', 'inventory.manage');
DELETE FROM permissions WHERE permission_key IN ('inventory.view', 'inventory.manage');