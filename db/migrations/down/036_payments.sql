-- destructive: true
DROP FUNCTION IF EXISTS apply_verified_payment_event(TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB);

DROP TABLE IF EXISTS payment_webhook_events;
DROP TABLE IF EXISTS payments;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_status_valid,
    DROP COLUMN IF EXISTS payment_status;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_method_supported,
    ADD CONSTRAINT orders_payment_method_supported CHECK (payment_method = 'cash_on_delivery');
