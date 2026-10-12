DROP TRIGGER IF EXISTS orders_restock_on_cancel ON orders;
DROP FUNCTION IF EXISTS restock_cancelled_order();