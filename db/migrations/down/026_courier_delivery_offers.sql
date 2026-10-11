-- destructive: true
DROP POLICY IF EXISTS orders_customer_delivery_offer_response ON orders;
DROP INDEX IF EXISTS ix_orders_delivery_offer_courier;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_delivery_status_valid,
    DROP CONSTRAINT IF EXISTS orders_delivery_courier_state,
    DROP CONSTRAINT IF EXISTS orders_delivery_status_matches_order,
    DROP COLUMN IF EXISTS delivery_offer_courier_id;

ALTER TABLE orders
    ADD CONSTRAINT orders_delivery_status_valid CHECK (
        delivery_status IN ('not_applicable', 'waiting', 'assigned', 'picked_up', 'on_the_way', 'delivered')
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

DROP POLICY orders_courier_claim ON orders;
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
