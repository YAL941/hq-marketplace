CREATE FUNCTION assert_inventory_product_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_business_id BIGINT;
    v_product_id BIGINT;
    v_product_total BIGINT;
    v_balance_total BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'products' THEN
        v_business_id := NEW.business_id;
        v_product_id := NEW.product_id;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_business_id := OLD.business_id;
            v_product_id := OLD.product_id;
        ELSE
            v_business_id := NEW.business_id;
            v_product_id := NEW.product_id;
        END IF;
    END IF;

    SELECT p.stock_quantity INTO v_product_total
      FROM products p
     WHERE p.product_id = v_product_id
       AND p.business_id = v_business_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(SUM(ib.quantity), 0)::BIGINT INTO v_balance_total
      FROM inventory_balances ib
     WHERE ib.product_id = v_product_id
       AND ib.business_id = v_business_id;

    IF v_product_total <> v_balance_total THEN
        RAISE EXCEPTION 'product stock total does not match location balances for product %', v_product_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION assert_inventory_product_total() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER products_inventory_total_consistent
    AFTER INSERT OR UPDATE OF stock_quantity ON products
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_inventory_product_total();

CREATE CONSTRAINT TRIGGER balances_inventory_total_consistent
    AFTER INSERT OR UPDATE OR DELETE ON inventory_balances
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_inventory_product_total();