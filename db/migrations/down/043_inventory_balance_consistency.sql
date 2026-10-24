DROP TRIGGER IF EXISTS balances_inventory_total_consistent ON inventory_balances;
DROP TRIGGER IF EXISTS products_inventory_total_consistent ON products;
DROP FUNCTION IF EXISTS assert_inventory_product_total();