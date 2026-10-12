-- Stock is taken when an order is created (reserve_order_product, migrations
-- 015/016) but was never given back when the order was cancelled or rejected.
-- This trigger returns the reserved quantities exactly once, whichever code
-- path (customer cancel, business cancel/reject, admin) changes the status.

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
          FROM (SELECT oi.product_id, oi.business_id, SUM(oi.quantity)::INTEGER AS qty
                  FROM order_items oi
                 WHERE oi.order_id = NEW.order_id
                   AND oi.product_id IS NOT NULL
                 GROUP BY oi.product_id, oi.business_id) AS s
         WHERE p.product_id = s.product_id
           AND p.business_id = s.business_id
           AND p.is_stock_tracked;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION restock_cancelled_order() FROM PUBLIC;

DROP TRIGGER IF EXISTS orders_restock_on_cancel ON orders;
CREATE TRIGGER orders_restock_on_cancel
    AFTER UPDATE OF order_status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION restock_cancelled_order();