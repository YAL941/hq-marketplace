ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS reconciliation_reason TEXT,
    ADD COLUMN IF NOT EXISTS reconciliation_at TIMESTAMPTZ;
ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_reconciliation_status_valid,
    ADD CONSTRAINT payments_reconciliation_status_valid
        CHECK (reconciliation_status IN ('none', 'refund_review_required'));

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payment_reconciliation_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS payment_reconciliation_reason TEXT,
    ADD COLUMN IF NOT EXISTS payment_reconciliation_at TIMESTAMPTZ;
ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_reconciliation_status_valid,
    ADD CONSTRAINT orders_payment_reconciliation_status_valid
        CHECK (payment_reconciliation_status IN ('none', 'refund_review_required'));

ALTER TABLE payment_webhook_events
    DROP CONSTRAINT IF EXISTS payment_webhook_events_outcome_check,
    ADD CONSTRAINT payment_webhook_events_outcome_check
        CHECK (outcome IN ('succeeded', 'failed', 'succeeded_reconciliation_required'));

DROP FUNCTION IF EXISTS apply_verified_payment_event(TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB);

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
    duplicate BOOLEAN,
    reconciliation_required BOOLEAN
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
    v_is_terminal BOOLEAN;
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
     WHERE p.provider = p_provider
       AND p.provider_reference = p_provider_reference;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment reference not found';
    END IF;

    SELECT o.* INTO v_order
      FROM orders o
     WHERE o.order_id = v_payment.order_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'order not found for payment';
    END IF;

    -- Every payment path uses the same lock order: order first, payment second.
    -- This matches order-status updates plus the reconciliation trigger.
    SELECT p.* INTO v_payment
      FROM payments p
     WHERE p.payment_id = v_payment.payment_id
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
        SELECT v_payment.payment_id,
               v_payment.order_id,
               v_order.payment_status,
               TRUE,
               v_payment.reconciliation_status = 'refund_review_required';
        RETURN;
    END IF;

    IF v_payment.amount_minor <> p_amount_minor
       OR v_payment.currency <> p_currency
       OR v_order.payment_method <> p_provider
       OR round(v_order.total_amount * 100)::BIGINT <> p_amount_minor THEN
        RAISE EXCEPTION 'payment amount, currency, or provider does not match the order';
    END IF;

    v_is_terminal := v_order.order_status IN ('cancelled', 'rejected', 'refunded');

    IF p_succeeded THEN
        IF v_is_terminal THEN
            v_subtotal_minor := round(v_order.subtotal * 100)::BIGINT;
            v_commission_minor := round(v_subtotal_minor::NUMERIC * p_rate_used_bps / 10000)::BIGINT;

            UPDATE payments p
               SET status = 'succeeded',
                   provider_event_id = p_event_id,
                   commission_minor = v_commission_minor,
                   merchant_amount_minor = v_subtotal_minor - v_commission_minor,
                   rate_used_bps = p_rate_used_bps,
                   provider_data = p_payload,
                   paid_at = now(),
                   reconciliation_status = 'refund_review_required',
                   reconciliation_reason = format('Late successful webhook received for terminal order status: %s', v_order.order_status),
                   reconciliation_at = now(),
                   updated_at = now()
             WHERE p.payment_id = v_payment.payment_id;

            UPDATE orders o
               SET payment_reconciliation_status = 'refund_review_required',
                   payment_reconciliation_reason = format('Late successful payment %s for terminal order status: %s', p_provider_reference, v_order.order_status),
                   payment_reconciliation_at = now()
             WHERE o.order_id = v_order.order_id;

            v_event_outcome := 'succeeded_reconciliation_required';

            UPDATE payment_webhook_events e
               SET outcome = v_event_outcome
             WHERE e.payment_webhook_event_id = v_inserted_event_id;

            RETURN QUERY
            SELECT v_payment.payment_id,
                   v_payment.order_id,
                   v_order.payment_status,
                   FALSE,
                   TRUE;
            RETURN;
        END IF;

        IF v_payment.status = 'succeeded' OR v_order.payment_status = 'paid' THEN
            RAISE EXCEPTION 'order already has a successful payment';
        END IF;
        IF v_payment.status <> 'pending' THEN
            RAISE EXCEPTION 'payment is not pending';
        END IF;

        v_subtotal_minor := round(v_order.subtotal * 100)::BIGINT;
        v_commission_minor := round(v_subtotal_minor::NUMERIC * p_rate_used_bps / 10000)::BIGINT;
        UPDATE payments p
           SET status = 'succeeded',
               provider_event_id = p_event_id,
               commission_minor = v_commission_minor,
               merchant_amount_minor = v_subtotal_minor - v_commission_minor,
               rate_used_bps = p_rate_used_bps,
               provider_data = p_payload,
               paid_at = now(),
               updated_at = now()
         WHERE p.payment_id = v_payment.payment_id;
        UPDATE orders o
           SET payment_status = 'paid'
         WHERE o.order_id = v_order.order_id
           AND o.payment_status <> 'paid';
        v_event_outcome := 'succeeded';
    ELSE
        IF v_payment.status <> 'pending' THEN
            RAISE EXCEPTION 'payment is not pending';
        END IF;
        UPDATE payments p
           SET status = 'failed',
               provider_event_id = p_event_id,
               provider_data = p_payload,
               updated_at = now()
         WHERE p.payment_id = v_payment.payment_id;
        UPDATE orders o
           SET payment_status = 'failed'
         WHERE o.order_id = v_order.order_id
           AND o.payment_status = 'pending';
        v_event_outcome := 'failed';
    END IF;

    UPDATE payment_webhook_events e
       SET outcome = v_event_outcome
     WHERE e.payment_webhook_event_id = v_inserted_event_id;

    RETURN QUERY
    SELECT v_payment.payment_id,
           v_payment.order_id,
           CASE WHEN p_succeeded THEN 'paid' ELSE 'failed' END,
           FALSE,
           FALSE;
END;
$$;

REVOKE ALL ON FUNCTION apply_verified_payment_event(TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION reconcile_terminal_order_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.order_status IN ('cancelled', 'rejected', 'refunded')
       AND OLD.order_status IS DISTINCT FROM NEW.order_status THEN
        IF EXISTS (
            SELECT 1 FROM payments
             WHERE order_id = NEW.order_id AND status = 'succeeded'
        ) THEN
            NEW.payment_reconciliation_status := 'refund_review_required';
            NEW.payment_reconciliation_reason := format(
                'Provider-confirmed payment requires review after order became terminal: %s',
                NEW.order_status
            );
            NEW.payment_reconciliation_at := now();

            UPDATE payments
               SET reconciliation_status = 'refund_review_required',
                   reconciliation_reason = format(
                       'Provider-confirmed payment requires review after order became terminal: %s',
                       NEW.order_status
                   ),
                   reconciliation_at = now(),
                   updated_at = now()
             WHERE order_id = NEW.order_id AND status = 'succeeded'
               AND reconciliation_status = 'none';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_terminal_order_payment ON orders;
CREATE TRIGGER trg_reconcile_terminal_order_payment
    BEFORE UPDATE OF order_status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION reconcile_terminal_order_payment();

REVOKE ALL ON FUNCTION reconcile_terminal_order_payment() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION apply_verified_payment_event(
    TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB
) TO hq_app;

CREATE OR REPLACE VIEW payment_late_reconciliation_candidates
WITH (security_invoker = true)
AS
SELECT o.order_id,
       o.business_id,
       o.order_status,
       o.payment_status AS order_payment_status,
       p.payment_id,
       p.status AS payment_status,
       p.provider,
       p.provider_reference,
       p.reconciliation_status AS payment_reconciliation_status,
       o.payment_reconciliation_status AS order_reconciliation_status
FROM orders o
JOIN payments p ON p.order_id = o.order_id
WHERE o.order_status IN ('cancelled', 'rejected', 'refunded')
  AND p.status = 'succeeded'
  AND (
      p.reconciliation_status <> 'refund_review_required'
      OR o.payment_reconciliation_status <> 'refund_review_required'
  );

DO $$
DECLARE
    v_candidate_count INTEGER;
BEGIN
    SELECT count(*) INTO v_candidate_count
      FROM payment_late_reconciliation_candidates;

    UPDATE payments p
       SET reconciliation_status = 'refund_review_required',
           reconciliation_reason = format(
               'Existing successful payment requires reconciliation review after terminal order status: %s',
               o.order_status
           ),
           reconciliation_at = now(),
           updated_at = now()
      FROM orders o
     WHERE p.order_id = o.order_id
       AND o.order_status IN ('cancelled', 'rejected', 'refunded')
       AND p.status = 'succeeded'
       AND p.reconciliation_status <> 'refund_review_required';

    UPDATE orders o
       SET payment_reconciliation_status = 'refund_review_required',
           payment_reconciliation_reason = format(
               'Existing successful payment requires reconciliation review after terminal order status: %s',
               o.order_status
           ),
           payment_reconciliation_at = now()
      FROM payments p
     WHERE p.order_id = o.order_id
       AND o.order_status IN ('cancelled', 'rejected', 'refunded')
       AND p.status = 'succeeded'
       AND o.payment_reconciliation_status <> 'refund_review_required';

    RAISE NOTICE '[migration 061] existing terminal/succeeded reconciliation candidates found: %', v_candidate_count;
END;
$$;
