-- Rollback: re-add the delivery confirmation code (PIN) column and constraints.
-- destructive: true

DROP POLICY IF EXISTS orders_customer_delivery_offer_response ON orders;

ALTER TABLE orders
    ADD COLUMN delivery_confirmation_code CHAR(4),
    ADD CONSTRAINT orders_delivery_confirmation_code_valid CHECK (
        delivery_confirmation_code IS NULL OR delivery_confirmation_code ~ '^[0-9]{4}$'
    ),
    ADD CONSTRAINT orders_delivery_confirmation_code_state CHECK (
        (delivery_status IN ('assigned', 'picked_up', 'on_the_way') AND delivery_confirmation_code IS NOT NULL)
        OR (delivery_status NOT IN ('assigned', 'picked_up', 'on_the_way') AND delivery_confirmation_code IS NULL)
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
