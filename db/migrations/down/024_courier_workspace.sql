-- destructive: true
DROP POLICY IF EXISTS users_business_courier_read ON users;
DROP POLICY IF EXISTS orders_courier_update ON orders;
DROP POLICY IF EXISTS orders_courier_claim ON orders;
DROP POLICY IF EXISTS orders_participant_read ON orders;

CREATE POLICY orders_participant_read ON orders
    FOR SELECT USING (
        customer_id = app_user_id()
        OR app_is_business_member(business_id)
        OR app_is_platform_admin()
    );

DROP TRIGGER IF EXISTS trg_orders_delivery_status_history ON orders;
DROP FUNCTION IF EXISTS append_delivery_status_history();

DROP INDEX IF EXISTS ix_orders_delivery_courier;
DROP INDEX IF EXISTS ix_orders_delivery_waiting;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_delivery_courier_state,
    DROP CONSTRAINT IF EXISTS orders_delivery_status_valid,
    DROP CONSTRAINT IF EXISTS orders_delivery_confirmation_code_state,
    DROP CONSTRAINT IF EXISTS orders_delivery_confirmation_code_valid,
    DROP CONSTRAINT IF EXISTS orders_delivery_status_matches_order,
    DROP COLUMN IF EXISTS delivery_status_history,
    DROP COLUMN IF EXISTS delivery_status,
    DROP COLUMN IF EXISTS delivery_confirmation_code,
    DROP COLUMN IF EXISTS delivery_courier_id;

DROP TABLE IF EXISTS business_couriers;
