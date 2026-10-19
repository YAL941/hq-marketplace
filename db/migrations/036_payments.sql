ALTER TABLE orders
    ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending',
    DROP CONSTRAINT IF EXISTS orders_payment_method_supported,
    ADD CONSTRAINT orders_payment_method_supported
        CHECK (payment_method IN ('cash_on_delivery', 'mock_mobile_money')),
    ADD CONSTRAINT orders_payment_status_valid
        CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded'));

CREATE TABLE payments (
    payment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders (order_id) ON DELETE RESTRICT,
    customer_id BIGINT NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
    provider TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    provider_reference TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    provider_event_id TEXT,
    commission_minor BIGINT,
    merchant_amount_minor BIGINT,
    rate_used_bps INTEGER,
    provider_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    CONSTRAINT payments_provider_valid
        CHECK (provider IN ('cash_on_delivery', 'mock_mobile_money')),
    CONSTRAINT payments_method_provider_match
        CHECK (payment_method = provider),
    CONSTRAINT payments_status_valid
        CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT payments_provider_reference_nonempty
        CHECK (length(provider_reference) BETWEEN 1 AND 200),
    CONSTRAINT payments_idempotency_key_nonempty
        CHECK (length(idempotency_key) BETWEEN 1 AND 200),
    CONSTRAINT payments_success_accounting_complete
        CHECK (
            (status = 'succeeded'
                AND commission_minor IS NOT NULL AND commission_minor >= 0
                AND merchant_amount_minor IS NOT NULL AND merchant_amount_minor >= 0
                AND rate_used_bps IS NOT NULL AND rate_used_bps BETWEEN 0 AND 10000
                AND paid_at IS NOT NULL AND provider_event_id IS NOT NULL)
            OR status <> 'succeeded'
        ),
    CONSTRAINT payments_unique_order_attempt UNIQUE (order_id, idempotency_key),
    CONSTRAINT payments_unique_provider_reference UNIQUE (provider, provider_reference)
);

CREATE UNIQUE INDEX payments_one_success_per_order
    ON payments (order_id) WHERE status = 'succeeded';
CREATE INDEX payments_customer_created
    ON payments (customer_id, created_at DESC);

CREATE TABLE payment_webhook_events (
    payment_webhook_event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments (payment_id) ON DELETE RESTRICT,
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_webhook_events_provider_event_unique UNIQUE (provider, event_id)
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_participant_read ON payments
    FOR SELECT USING (
        customer_id = app_user_id()
        OR EXISTS (
            SELECT 1 FROM orders o
             WHERE o.order_id = payments.order_id
               AND app_is_business_member(o.business_id)
        )
        OR app_is_platform_admin()
    );

CREATE POLICY payments_customer_insert ON payments
    FOR INSERT WITH CHECK (
        customer_id = app_user_id()
        AND EXISTS (
            SELECT 1 FROM orders o
             WHERE o.order_id = payments.order_id
               AND o.customer_id = app_user_id()
               AND o.payment_method = payments.payment_method
               AND o.payment_status = 'pending'
        )
    );

ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_webhook_events_participant_read ON payment_webhook_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM payments p
             WHERE p.payment_id = payment_webhook_events.payment_id
               AND (
                   p.customer_id = app_user_id()
                   OR app_is_platform_admin()
                   OR EXISTS (
                       SELECT 1 FROM orders o
                        WHERE o.order_id = p.order_id
                          AND app_is_business_member(o.business_id)
                   )
               )
        )
    );

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
     WHERE p.provider = p_provider
       AND p.provider_reference = p_provider_reference
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment reference not found';
    END IF;

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
               CASE WHEN v_payment.status = 'succeeded' THEN 'paid' ELSE v_payment.status END,
               TRUE;
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
    IF v_payment.status <> 'pending' THEN
        RAISE EXCEPTION 'payment is not pending';
    END IF;

    IF p_succeeded THEN
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
    SELECT v_payment.payment_id, v_payment.order_id,
           CASE WHEN p_succeeded THEN 'paid' ELSE 'failed' END, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION apply_verified_payment_event(TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, INTEGER, JSONB) FROM PUBLIC;
