ALTER TABLE orders
    DROP CONSTRAINT orders_delivery_status_valid,
    DROP CONSTRAINT orders_delivery_courier_state,
    DROP CONSTRAINT orders_delivery_status_matches_order,
    ADD COLUMN delivery_offer_courier_id BIGINT REFERENCES users (user_id) ON DELETE SET NULL;

ALTER TABLE orders
    ADD CONSTRAINT orders_delivery_status_valid CHECK (
        delivery_status IN ('not_applicable', 'waiting', 'offer_pending', 'assigned', 'picked_up', 'on_the_way', 'delivered')
    ),
    ADD CONSTRAINT orders_delivery_courier_state CHECK (
        (delivery_status IN ('not_applicable', 'waiting')
            AND delivery_courier_id IS NULL
            AND delivery_offer_courier_id IS NULL)
        OR (delivery_status = 'offer_pending'
            AND delivery_courier_id IS NULL
            AND delivery_offer_courier_id IS NOT NULL
            AND delivery_earning_amount IS NOT NULL)
        OR (delivery_status IN ('assigned', 'picked_up', 'on_the_way', 'delivered')
            AND delivery_courier_id IS NOT NULL
            AND delivery_offer_courier_id IS NULL)
    ),
    ADD CONSTRAINT orders_delivery_status_matches_order CHECK (
        delivery_status = 'not_applicable'
        OR (delivery_status = 'waiting' AND delivery_requested AND order_status = 'ready')
        OR (delivery_status = 'offer_pending' AND delivery_requested AND order_status = 'ready')
        OR (
            delivery_status IN ('assigned', 'picked_up')
            AND delivery_requested
            AND order_status IN ('ready', 'out_for_delivery')
        )
        OR (delivery_status = 'on_the_way' AND delivery_requested AND order_status = 'out_for_delivery')
        OR (delivery_status = 'delivered' AND delivery_requested AND order_status = 'completed')
    );

CREATE INDEX ix_orders_delivery_offer_courier
    ON orders (delivery_offer_courier_id, created_at DESC)
    WHERE delivery_status = 'offer_pending';

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
            delivery_offer_courier_id = app_user_id()
            AND delivery_status = 'offer_pending'
        )
        OR (
            order_status = 'ready'
            AND delivery_requested
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
        AND delivery_status = 'waiting'
        AND delivery_courier_id IS NULL
        AND delivery_offer_courier_id IS NULL
        AND EXISTS (
            SELECT 1 FROM business_couriers bc
             WHERE bc.business_id = orders.business_id
               AND bc.user_id = app_user_id()
               AND bc.active
        )
    )
    WITH CHECK (
        order_status = 'ready'
        AND delivery_status = 'offer_pending'
        AND delivery_courier_id IS NULL
        AND delivery_offer_courier_id = app_user_id()
        AND delivery_earning_amount IS NOT NULL
    );

CREATE POLICY orders_customer_delivery_offer_response ON orders
    FOR UPDATE
    USING (
        customer_id = app_user_id()
        AND order_status = 'ready'
        AND delivery_status = 'offer_pending'
    )
    WITH CHECK (
        customer_id = app_user_id()
        AND (
            (
                order_status = 'ready'
                AND delivery_status = 'assigned'
                AND delivery_courier_id IS NOT NULL
                AND delivery_offer_courier_id IS NULL
                AND delivery_confirmation_code IS NOT NULL
            )
            OR (
                order_status = 'ready'
                AND delivery_status = 'waiting'
                AND delivery_courier_id IS NULL
                AND delivery_offer_courier_id IS NULL
                AND delivery_earning_amount IS NULL
            )
        )
    );
