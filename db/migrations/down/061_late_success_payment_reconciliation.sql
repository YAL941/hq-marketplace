-- destructive: true

DROP TRIGGER IF EXISTS trg_reconcile_terminal_order_payment ON orders;
DROP FUNCTION IF EXISTS reconcile_terminal_order_payment();
DROP VIEW IF EXISTS payment_late_reconciliation_candidates;

REVOKE EXECUTE ON FUNCTION apply_verified_payment_event(
    TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB
) FROM hq_app;
DROP FUNCTION IF EXISTS apply_verified_payment_event(
    TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB
);

UPDATE payment_webhook_events
   SET outcome = 'succeeded'
 WHERE outcome = 'succeeded_reconciliation_required';

ALTER TABLE payment_webhook_events
    DROP CONSTRAINT IF EXISTS payment_webhook_events_outcome_check,
    ADD CONSTRAINT payment_webhook_events_outcome_check
        CHECK (outcome IN ('succeeded', 'failed'));

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_reconciliation_status_valid,
    DROP COLUMN IF EXISTS payment_reconciliation_at,
    DROP COLUMN IF EXISTS payment_reconciliation_reason,
    DROP COLUMN IF EXISTS payment_reconciliation_status;

ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_reconciliation_status_valid,
    DROP COLUMN IF EXISTS reconciliation_at,
    DROP COLUMN IF EXISTS reconciliation_reason,
    DROP COLUMN IF EXISTS reconciliation_status;

CREATE OR REPLACE FUNCTION apply_verified_payment_event(
    p_provider TEXT,
    p_event_id TEXT,
    p_provider_reference TEXT,
    p_amount_minor BIGINT,
    p_currency TEXT,
    p_succeeded BOOLEAN,
    p_rate_used_bps INTEGER,
    p_payload JSONB
)
RETURNS TABLE (
    payment_id BIGINT,
    order_id BIGINT,
    payment_status TEXT,
    duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment payments%ROWTYPE;
    v_order orders%ROWTYPE;
    v_existing payment_webhook_events%ROWTYPE;
    v_inserted_event_id BIGINT;
    v_subtotal_minor BIGINT;
    v_commission_minor BIGINT;
    v_event_outcome TEXT;
BEGIN
    IF p_provider NOT IN ('cash_on_delivery', 'mock_mobile_money')
       OR p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 200
       OR p_provider_reference IS NULL OR length(p_provider_reference) NOT BETWEEN 1 AND 200
       OR p_amount_minor IS NULL OR p_amount_minor < 0
       OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
       OR p_rate_used_bps IS NULL OR p_rate_used_bps NOT BETWEEN 0 AND 10000
       OR p_payload IS NULL THEN
        RAISE EXCEPTION 'invalid verified payment event';
    END IF;

    SELECT p.* INTO v_payment
      FROM payments p
     WHERE p.provider = p_provider AND p.provider_reference = p_provider_reference
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'payment reference not found'; END IF;

    SELECT o.* INTO v_order
      FROM orders o
     WHERE o.order_id = v_payment.order_id
     FOR UPDATE;

    INSERT INTO payment_webhook_events (payment_id, provider, event_id, payload, outcome)
    VALUES (v_payment.payment_id, p_provider, p_event_id, p_payload, CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END)
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING payment_webhook_event_id INTO v_inserted_event_id;

    IF v_inserted_event_id IS NULL THEN
        SELECT e.* INTO v_existing
          FROM payment_webhook_events e
         WHERE e.provider = p_provider AND e.event_id = p_event_id;
        IF v_existing.payment_id <> v_payment.payment_id OR v_existing.payload <> p_payload THEN
            RAISE EXCEPTION 'webhook event id was reused with different content';
        END IF;
        RETURN QUERY
        SELECT v_payment.payment_id, v_payment.order_id,
               CASE WHEN v_payment.status = 'succeeded' THEN 'paid' ELSE v_payment.status END, TRUE;
        RETURN;
    END IF;

    IF v_payment.amount_minor <> p_amount_minor
       OR v_payment.currency <> p_currency
       OR v_order.payment_method <> p_provider
       OR round(v_order.total_amount * 100)::BIGINT <> p_amount_minor THEN
        RAISE EXCEPTION 'payment amount, currency, or provider does not match the order';
    END IF;
    IF v_payment.status = 'succeeded' OR v_order.payment_status = 'paid' THEN
        RAISE EXCEPTION 'order already has a successful payment';
    END IF;
    IF v_payment.status <> 'pending' THEN RAISE EXCEPTION 'payment is not pending'; END IF;

    IF p_succeeded THEN
        v_subtotal_minor := round(v_order.subtotal * 100)::BIGINT;
        v_commission_minor := round(v_subtotal_minor::NUMERIC * p_rate_used_bps / 10000)::BIGINT;
        UPDATE payments p SET status = 'succeeded', provider_event_id = p_event_id,
               commission_minor = v_commission_minor,
               merchant_amount_minor = v_subtotal_minor - v_commission_minor,
               rate_used_bps = p_rate_used_bps, provider_data = p_payload,
               paid_at = now(), updated_at = now()
         WHERE p.payment_id = v_payment.payment_id;
        UPDATE orders o SET payment_status = 'paid'
         WHERE o.order_id = v_order.order_id AND o.payment_status <> 'paid';
        v_event_outcome := 'succeeded';
    ELSE
        UPDATE payments p SET status = 'failed', provider_event_id = p_event_id,
               provider_data = p_payload, updated_at = now()
         WHERE p.payment_id = v_payment.payment_id;
        UPDATE orders o SET payment_status = 'failed'
         WHERE o.order_id = v_order.order_id AND o.payment_status = 'pending';
        v_event_outcome := 'failed';
    END IF;

    UPDATE payment_webhook_events e SET outcome = v_event_outcome
     WHERE e.payment_webhook_event_id = v_inserted_event_id;

    RETURN QUERY
    SELECT v_payment.payment_id, v_payment.order_id,
           CASE WHEN p_succeeded THEN 'paid' ELSE 'failed' END, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION apply_verified_payment_event(
    TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_verified_payment_event(
    TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB
) TO hq_app;
