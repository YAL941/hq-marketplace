-- destructive: true
DROP FUNCTION IF EXISTS app_payment_notification_customer(BIGINT);
ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_notification_language_valid,
    DROP COLUMN IF EXISTS notification_language;
