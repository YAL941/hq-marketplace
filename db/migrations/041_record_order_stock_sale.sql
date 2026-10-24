CREATE FUNCTION record_order_stock_sale(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
    v_resulting_quantity INTEGER;
BEGIN
    SELECT o.business_id, o.customer_id
      INTO v_order
      FROM orders o
     WHERE o.order_id = p_order_id
     FOR UPDATE;

    IF NOT FOUND OR app_user_id() IS NULL OR v_order.customer_id <> app_user_id() THEN
        RAISE EXCEPTION 'not allowed to record order stock'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    FOR v_item IN
        SELECT oi.business_id, oi.product_id, oi.inventory_location_id,
               SUM(oi.quantity)::INTEGER AS quantity
          FROM order_items oi
          JOIN products p
            ON p.product_id = oi.product_id
           AND p.business_id = oi.business_id
           AND p.is_stock_tracked
         WHERE oi.order_id = p_order_id
           AND oi.business_id = v_order.business_id
           AND oi.product_id IS NOT NULL
         GROUP BY oi.business_id, oi.product_id, oi.inventory_location_id
         ORDER BY oi.product_id, oi.inventory_location_id
    LOOP
        IF EXISTS (
            SELECT 1 FROM stock_movements sm
             WHERE sm.source_type = 'order'
               AND sm.source_reference = p_order_id::TEXT
               AND sm.product_id = v_item.product_id
               AND sm.movement_type = 'sale'
        ) THEN
            CONTINUE;
        END IF;

        SELECT ib.quantity INTO v_resulting_quantity
          FROM inventory_balances ib
         WHERE ib.business_id = v_item.business_id
           AND ib.product_id = v_item.product_id
           AND ib.location_id IS NOT DISTINCT FROM v_item.inventory_location_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'inventory balance missing for order % product %', p_order_id, v_item.product_id;
        END IF;

        INSERT INTO stock_movements (
            business_id, product_id, location_id, movement_type, quantity,
            previous_quantity, resulting_quantity, source_type, source_reference,
            acting_user_id, note
        ) VALUES (
            v_item.business_id, v_item.product_id, v_item.inventory_location_id,
            'sale', v_item.quantity, v_resulting_quantity + v_item.quantity,
            v_resulting_quantity, 'order', p_order_id::TEXT, app_user_id(),
            'Stock reserved when the order was placed'
        )
        ON CONFLICT (source_type, source_reference, product_id, movement_type)
        WHERE source_type IS NOT NULL AND source_reference IS NOT NULL DO NOTHING;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION record_order_stock_sale(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_order_stock_sale(BIGINT) TO PUBLIC;