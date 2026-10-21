-- Remove the delivery confirmation code (PIN) from orders.
-- The Somali-market flow is merchant-driven (out_for_delivery -> delivered)
-- and coordinated by WhatsApp/call, so the 4-digit PIN adds no value.
-- The courier delivery-offer flow still works, just without issuing a PIN.

DROP POLICY IF EXISTS orders_customer_delivery_offer_response ON orders;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_delivery_confirmation_code_valid,
    DROP CONSTRAINT IF EXISTS orders_delivery_confirmation_code_state,
    DROP COLUMN IF EXISTS delivery_confirmation_code;

-- Recreate the customer delivery offer response policy without the PIN requirement.
-- Accepting an offer now just assigns the courier; no confirmation code is issued.
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
