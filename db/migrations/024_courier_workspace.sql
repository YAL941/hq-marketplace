CREATE TABLE business_couriers (
    business_courier_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    user_id BIGINT NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT business_couriers_business_user_unique UNIQUE (business_id, user_id)
);

CREATE INDEX ix_business_couriers_user_active
    ON business_couriers (user_id, business_id) WHERE active;

ALTER TABLE business_couriers ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_couriers_read ON business_couriers
    FOR SELECT USING (
        user_id = app_user_id()
        OR app_has_business_permission(business_id, 'employees.manage')
        OR app_is_platform_admin()
    );
CREATE POLICY business_couriers_manage ON business_couriers
    FOR ALL
    USING (app_has_business_permission(business_id, 'employees.manage') OR app_is_platform_admin())
    WITH CHECK (app_has_business_permission(business_id, 'employees.manage') OR app_is_platform_admin());

CREATE POLICY users_business_courier_read ON users
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM business_couriers bc
             WHERE bc.user_id = users.user_id
               AND app_has_business_permission(bc.business_id, 'employees.manage')
        )
    );

ALTER TABLE orders
    ADD COLUMN delivery_courier_id BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'not_applicable',
    ADD COLUMN delivery_status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN delivery_confirmation_code CHAR(4),
    ADD CONSTRAINT orders_delivery_status_valid CHECK (
        delivery_status IN ('not_applicable', 'waiting', 'assigned', 'picked_up', 'on_the_way', 'delivered')
    ),
    ADD CONSTRAINT orders_delivery_confirmation_code_valid CHECK (
        delivery_confirmation_code IS NULL OR delivery_confirmation_code ~ '^[0-9]{4}$'
    ),
    ADD CONSTRAINT orders_delivery_confirmation_code_state CHECK (
        (delivery_status IN ('assigned', 'picked_up', 'on_the_way') AND delivery_confirmation_code IS NOT NULL)
        OR (delivery_status NOT IN ('assigned', 'picked_up', 'on_the_way') AND delivery_confirmation_code IS NULL)
    ),
    ADD CONSTRAINT orders_delivery_courier_state CHECK (
        (delivery_status IN ('not_applicable', 'waiting') AND delivery_courier_id IS NULL)
        OR (delivery_status IN ('assigned', 'picked_up', 'on_the_way', 'delivered')
            AND delivery_courier_id IS NOT NULL)
    ),
    ADD CONSTRAINT orders_delivery_status_matches_order CHECK (
        delivery_status = 'not_applicable'
        OR (delivery_status = 'waiting' AND delivery_requested AND order_status = 'ready')
        OR (
            delivery_status IN ('assigned', 'picked_up')
            AND delivery_requested
            AND order_status IN ('ready', 'out_for_delivery')
        )
        OR (delivery_status = 'on_the_way' AND delivery_requested AND order_status = 'out_for_delivery')
        OR (delivery_status = 'delivered' AND delivery_requested AND order_status = 'completed')
    );

UPDATE orders
   SET delivery_status = 'waiting'
 WHERE delivery_requested
   AND order_status = 'ready'
   AND delivery_latitude IS NOT NULL;

CREATE INDEX ix_orders_delivery_waiting
    ON orders (order_status, created_at) WHERE delivery_requested AND delivery_courier_id IS NULL;
CREATE INDEX ix_orders_delivery_courier
    ON orders (delivery_courier_id, delivery_status, created_at DESC)
    WHERE delivery_courier_id IS NOT NULL;

CREATE OR REPLACE FUNCTION append_delivery_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
        NEW.delivery_status_history := COALESCE(NEW.delivery_status_history, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
                'status', NEW.delivery_status,
                'changed_at', now(),
                'changed_by', app_user_id()
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_delivery_status_history
    BEFORE INSERT OR UPDATE OF delivery_status ON orders
    FOR EACH ROW EXECUTE FUNCTION append_delivery_status_history();

DROP POLICY orders_participant_read ON orders;
CREATE POLICY orders_participant_read ON orders
    FOR SELECT USING (
        customer_id = app_user_id()
        OR app_is_business_member(business_id)
        OR app_is_platform_admin()
        OR (
            delivery_courier_id = app_user_id()
            AND delivery_status IN ('assigned', 'picked_up', 'on_the_way', 'delivered')
        )
        OR (
            order_status = 'ready'
            AND delivery_requested
            AND delivery_courier_id IS NULL
            AND delivery_status = 'waiting'
            AND EXISTS (
                SELECT 1 FROM business_couriers bc
                 WHERE bc.business_id = orders.business_id
                   AND bc.user_id = app_user_id()
                   AND bc.active
            )
        )
    );

CREATE POLICY orders_courier_claim ON orders
    FOR UPDATE
    USING (
        order_status = 'ready'
        AND delivery_requested
        AND delivery_courier_id IS NULL
        AND delivery_status = 'waiting'
        AND EXISTS (
            SELECT 1 FROM business_couriers bc
             WHERE bc.business_id = orders.business_id
               AND bc.user_id = app_user_id()
               AND bc.active
        )
    )
    WITH CHECK (
        delivery_courier_id = app_user_id()
        AND delivery_status = 'assigned'
        AND order_status = 'ready'
    );

CREATE POLICY orders_courier_update ON orders
    FOR UPDATE
    USING (
        delivery_courier_id = app_user_id()
        AND delivery_status IN ('assigned', 'picked_up', 'on_the_way')
    )
    WITH CHECK (delivery_courier_id = app_user_id());
