ALTER TABLE orders
    ADD COLUMN notification_language TEXT NOT NULL DEFAULT 'en',
    ADD CONSTRAINT orders_notification_language_valid
        CHECK (notification_language IN ('ar', 'en', 'so'));

CREATE OR REPLACE FUNCTION app_payment_notification_customer(p_payment_id BIGINT)
RETURNS TABLE (
    customer_id BIGINT,
    order_id BIGINT,
    notification_language TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT o.customer_id, o.order_id, o.notification_language
      FROM payments p
      JOIN orders o ON o.order_id = p.order_id
     WHERE p.payment_id = p_payment_id
       AND p.status = 'succeeded'
       AND EXISTS (
           SELECT 1
             FROM payment_webhook_events e
            WHERE e.payment_id = p.payment_id
              AND e.outcome = 'succeeded'
       )
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_payment_notification_customer(BIGINT) FROM PUBLIC;
