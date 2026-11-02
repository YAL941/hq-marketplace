-- Phase 6.2: private PostgreSQL foundation for asynchronous email delivery.
-- This migration creates no SMTP integration and enqueues nothing by itself.

DO $role$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hq_notification_worker') THEN
        RAISE EXCEPTION 'role hq_notification_worker already exists; refusing to adopt an external role';
    END IF;
    CREATE ROLE hq_notification_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
END
$role$;

CREATE SCHEMA notification_private;
REVOKE ALL ON SCHEMA notification_private FROM PUBLIC, hq_notification_worker;
GRANT USAGE ON SCHEMA public TO hq_notification_worker;
DO $acl$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hq_app') THEN
        REVOKE ALL ON SCHEMA notification_private FROM hq_app;
    END IF;
END
$acl$;

CREATE TABLE notification_private.notification_outbox (
    outbox_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'order.created', 'order.status_changed', 'payment.succeeded', 'delivery.status_changed'
    )),
    template_key TEXT NOT NULL CHECK (template_key IN (
        'order.created', 'order.status_changed', 'payment.succeeded', 'delivery.status_changed'
    )),
    recipient_user_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
    business_id BIGINT NOT NULL REFERENCES public.businesses(business_id) ON DELETE RESTRICT,
    order_id BIGINT NOT NULL REFERENCES public.orders(order_id) ON DELETE RESTRICT,
    payment_id BIGINT REFERENCES public.payments(payment_id) ON DELETE RESTRICT,
    event_identity TEXT NOT NULL CHECK (length(event_identity) BETWEEN 1 AND 160),
    locale TEXT NOT NULL CHECK (locale IN ('en', 'ar', 'so')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (pg_catalog.jsonb_typeof(payload) = 'object' AND pg_catalog.octet_length(payload::text) <= 4096),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'dead', 'skipped')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts SMALLINT NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 12),
    available_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    lease_until TIMESTAMPTZ,
    lease_token UUID,
    last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    sent_at TIMESTAMPTZ,
    CONSTRAINT notification_outbox_payment_event_ref CHECK (
        (event_type = 'payment.succeeded' AND payment_id IS NOT NULL)
        OR (event_type <> 'payment.succeeded' AND payment_id IS NULL)
    ),
    CONSTRAINT notification_outbox_lease_state CHECK (
        (status = 'processing' AND lease_until IS NOT NULL AND lease_token IS NOT NULL)
        OR (status <> 'processing' AND lease_until IS NULL AND lease_token IS NULL)
    ),
    CONSTRAINT notification_outbox_sent_state CHECK (
        (status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent' AND sent_at IS NULL)
    )
);

CREATE INDEX ix_notification_outbox_pending
    ON notification_private.notification_outbox (available_at, outbox_id)
    WHERE status = 'pending';
CREATE INDEX ix_notification_outbox_expired_lease
    ON notification_private.notification_outbox (lease_until, outbox_id)
    WHERE status = 'processing';
CREATE INDEX ix_notification_outbox_retention
    ON notification_private.notification_outbox (created_at, outbox_id)
    WHERE status IN ('sent', 'dead', 'skipped');
CREATE INDEX ix_notification_outbox_recipient_created
    ON notification_private.notification_outbox (recipient_user_id, created_at DESC);

ALTER TABLE notification_private.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE notification_private.notification_outbox FROM PUBLIC, hq_notification_worker;
REVOKE ALL ON SEQUENCE notification_private.notification_outbox_outbox_id_seq FROM PUBLIC, hq_notification_worker;
DO $acl$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hq_app') THEN
        REVOKE ALL ON TABLE notification_private.notification_outbox FROM hq_app;
        REVOKE ALL ON SEQUENCE notification_private.notification_outbox_outbox_id_seq FROM hq_app;
    END IF;
END
$acl$;

CREATE OR REPLACE FUNCTION public.enqueue_notification_email(
    p_event_identity TEXT,
    p_event_type TEXT,
    p_template_key TEXT,
    p_recipient_user_id BIGINT,
    p_locale TEXT,
    p_business_id BIGINT,
    p_order_id BIGINT,
    p_payment_id BIGINT,
    p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    v_order public.orders%ROWTYPE;
    v_outbox_id BIGINT;
    v_dedupe_key TEXT;
BEGIN
    IF public.app_user_id() IS NULL
       OR p_event_identity IS NULL OR p_event_identity !~ '^[A-Za-z0-9:_-]{1,160}$'
       OR p_event_type IS NULL OR p_template_key IS NULL OR p_locale IS NULL
       OR p_event_type NOT IN ('order.created', 'order.status_changed', 'payment.succeeded', 'delivery.status_changed')
       OR p_template_key <> p_event_type
       OR p_recipient_user_id IS NULL OR p_business_id IS NULL OR p_order_id IS NULL
       OR p_locale NOT IN ('en', 'ar', 'so')
       OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
       OR pg_catalog.octet_length(p_payload::text) > 4096 THEN
        RAISE EXCEPTION 'invalid notification event' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.jsonb_each(p_payload) AS item(key, value)
         WHERE item.key <> ALL (
                   CASE p_event_type
                       WHEN 'order.created' THEN ARRAY['order_number', 'business_name', 'total_amount', 'currency']::TEXT[]
                       WHEN 'order.status_changed' THEN ARRAY['order_number', 'status']::TEXT[]
                       WHEN 'payment.succeeded' THEN ARRAY['order_number', 'amount_minor', 'currency']::TEXT[]
                       ELSE ARRAY['order_number', 'delivery_status']::TEXT[]
                   END
               )
            OR pg_catalog.jsonb_typeof(item.value) NOT IN ('string', 'number')
    ) THEN
        RAISE EXCEPTION 'notification payload contains unsupported fields' USING ERRCODE = '22023';
    END IF;

    SELECT o.* INTO v_order FROM public.orders AS o WHERE o.order_id = p_order_id;
    IF NOT FOUND OR v_order.business_id <> p_business_id THEN
        RAISE EXCEPTION 'notification event is outside the current tenant' USING ERRCODE = '42501';
    END IF;
    IF public.app_current_business_id() IS NOT NULL
       AND public.app_current_business_id() <> p_business_id THEN
        RAISE EXCEPTION 'notification event is outside the current tenant context' USING ERRCODE = '42501';
    END IF;

    IF p_event_type = 'order.created' THEN
        IF p_event_identity <> 'order:' || p_order_id::TEXT || ':created'
           OR v_order.customer_id <> public.app_user_id()
           OR NOT EXISTS (
               SELECT 1 FROM public.business_users AS bu
               JOIN public.roles AS r ON r.role_id = bu.role_id
               JOIN public.users AS u ON u.user_id = bu.user_id
               WHERE bu.business_id = p_business_id AND bu.user_id = p_recipient_user_id
                 AND bu.status = 'active' AND r.role_key = 'business_owner'
                 AND u.status = 'active' AND u.email_verified_at IS NOT NULL
           ) THEN
            RAISE EXCEPTION 'unauthorized order notification recipient' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF p_recipient_user_id <> v_order.customer_id THEN
            RAISE EXCEPTION 'notification recipient does not own the order' USING ERRCODE = '42501';
        END IF;
        IF p_event_type = 'delivery.status_changed' THEN
            IF p_event_identity <> 'order:' || p_order_id::TEXT || ':delivery:'
                || v_order.delivery_status || ':'
                || pg_catalog.to_char(v_order.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') THEN
                RAISE EXCEPTION 'delivery notification identity does not match current order state' USING ERRCODE = '42501';
            END IF;
            IF NOT (public.app_has_business_permission(p_business_id, 'orders.update')
                    OR v_order.delivery_courier_id = public.app_user_id()) THEN
                RAISE EXCEPTION 'unauthorized delivery notification event' USING ERRCODE = '42501';
            END IF;
        ELSIF p_event_type = 'order.status_changed' THEN
            IF p_event_identity <> 'order:' || p_order_id::TEXT || ':status:'
                || v_order.order_status::TEXT || ':'
                || pg_catalog.to_char(v_order.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS')
               OR NOT public.app_has_business_permission(p_business_id, 'orders.update') THEN
                RAISE EXCEPTION 'unauthorized or stale order notification event' USING ERRCODE = '42501';
            END IF;
        ELSIF NOT public.app_has_business_permission(p_business_id, 'orders.update')
              AND v_order.customer_id <> public.app_user_id() THEN
            RAISE EXCEPTION 'unauthorized order notification event' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_event_type = 'payment.succeeded' THEN
        IF p_payment_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.payments AS p
            WHERE p.payment_id = p_payment_id AND p.order_id = p_order_id
              AND p.status = 'succeeded' AND p.customer_id = p_recipient_user_id
        ) THEN
            RAISE EXCEPTION 'payment event is not a successful payment for this order' USING ERRCODE = '42501';
        END IF;
        IF p_event_identity <> 'payment:' || p_payment_id::TEXT || ':succeeded' THEN
            RAISE EXCEPTION 'payment notification identity does not match payment reference' USING ERRCODE = '42501';
        END IF;
    ELSIF p_payment_id IS NOT NULL THEN
        RAISE EXCEPTION 'payment reference is only valid for payment events' USING ERRCODE = '22023';
    END IF;

    v_dedupe_key := p_event_identity || ':' || p_event_type || ':' || p_recipient_user_id::TEXT;
    IF pg_catalog.length(v_dedupe_key) > 256 THEN
        RAISE EXCEPTION 'notification dedupe key is too long' USING ERRCODE = '22023';
    END IF;

    INSERT INTO notification_private.notification_outbox
        (dedupe_key, event_type, template_key, recipient_user_id, business_id, order_id,
         payment_id, event_identity, locale, payload)
    VALUES
        (v_dedupe_key, p_event_type, p_template_key, p_recipient_user_id, p_business_id,
         p_order_id, p_payment_id, p_event_identity, p_locale, p_payload)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING outbox_id INTO v_outbox_id;

    IF v_outbox_id IS NULL THEN
        SELECT o.outbox_id INTO v_outbox_id
        FROM notification_private.notification_outbox AS o
        WHERE o.dedupe_key = v_dedupe_key;
    END IF;
    RETURN v_outbox_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_notification_email_batch(
    p_limit INTEGER,
    p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (outbox_id BIGINT, lease_token UUID, event_type TEXT, template_key TEXT,
               recipient_user_id BIGINT, locale TEXT, business_id BIGINT, order_id BIGINT,
               payment_id BIGINT, payload JSONB, attempt_count INTEGER, max_attempts SMALLINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
    IF p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 5 AND 900 THEN
        RAISE EXCEPTION 'invalid notification claim bounds' USING ERRCODE = '22023';
    END IF;

    UPDATE notification_private.notification_outbox AS o
       SET status = 'dead', lease_until = NULL, lease_token = NULL,
           last_error_code = 'lease_expired_max_attempts', updated_at = pg_catalog.clock_timestamp()
     WHERE o.status = 'processing' AND o.lease_until <= pg_catalog.clock_timestamp()
       AND o.attempt_count >= o.max_attempts;

    RETURN QUERY
    WITH picked AS (
        SELECT o.outbox_id
          FROM notification_private.notification_outbox AS o
         WHERE (o.status = 'pending' AND o.available_at <= pg_catalog.clock_timestamp()
                AND o.attempt_count < o.max_attempts)
            OR (o.status = 'processing' AND o.lease_until <= pg_catalog.clock_timestamp()
                AND o.attempt_count < o.max_attempts)
         ORDER BY o.available_at, o.outbox_id
         FOR UPDATE SKIP LOCKED
         LIMIT p_limit
    )
    UPDATE notification_private.notification_outbox AS o
       SET status = 'processing', attempt_count = o.attempt_count + 1,
           lease_until = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
           lease_token = pg_catalog.gen_random_uuid(), updated_at = pg_catalog.clock_timestamp()
      FROM picked
     WHERE o.outbox_id = picked.outbox_id
    RETURNING o.outbox_id, o.lease_token, o.event_type, o.template_key, o.recipient_user_id,
              o.locale, o.business_id, o.order_id, o.payment_id, o.payload, o.attempt_count, o.max_attempts;
END
$function$;

CREATE OR REPLACE FUNCTION public.resolve_notification_email_recipient(p_outbox_id BIGINT, p_lease_token UUID)
RETURNS TABLE (email TEXT, full_name TEXT, locale TEXT, template_key TEXT, payload JSONB)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
    SELECT u.email::TEXT, u.full_name, o.locale, o.template_key, o.payload
      FROM notification_private.notification_outbox AS o
      JOIN public.users AS u ON u.user_id = o.recipient_user_id
     WHERE o.outbox_id = p_outbox_id AND o.lease_token = p_lease_token
       AND o.status = 'processing' AND o.lease_until > pg_catalog.clock_timestamp()
       AND u.status = 'active' AND u.email_verified_at IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.acknowledge_notification_email_sent(p_outbox_id BIGINT, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
    WITH changed AS (
        UPDATE notification_private.notification_outbox AS o
           SET status = 'sent', sent_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp(),
               lease_until = NULL, lease_token = NULL, last_error_code = NULL
         WHERE o.outbox_id = p_outbox_id AND o.lease_token = p_lease_token
           AND o.status = 'processing' AND o.lease_until > pg_catalog.clock_timestamp()
        RETURNING 1
    ) SELECT EXISTS (SELECT 1 FROM changed)
$function$;

CREATE OR REPLACE FUNCTION public.fail_notification_email(
    p_outbox_id BIGINT, p_lease_token UUID, p_retryable BOOLEAN, p_error_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    v_changed INTEGER := 0;
BEGIN
    IF p_retryable IS NULL OR p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_]{1,64}$' THEN
        RAISE EXCEPTION 'invalid notification failure details' USING ERRCODE = '22023';
    END IF;
    UPDATE notification_private.notification_outbox AS o
       SET status = CASE WHEN p_retryable AND o.attempt_count < o.max_attempts THEN 'pending' ELSE 'dead' END,
           available_at = CASE WHEN p_retryable AND o.attempt_count < o.max_attempts
               THEN pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs =>
                   LEAST(3600, 30 * (2 ^ LEAST(o.attempt_count - 1, 7))))
               ELSE o.available_at END,
           last_error_code = p_error_code, updated_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL
     WHERE o.outbox_id = p_outbox_id AND o.lease_token = p_lease_token
       AND o.status = 'processing' AND o.lease_until > pg_catalog.clock_timestamp();
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN v_changed > 0;
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_notification_email(TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_notification_email_batch(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_notification_email_recipient(BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acknowledge_notification_email_sent(BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_notification_email(BIGINT, UUID, BOOLEAN, TEXT) FROM PUBLIC;
DO $acl$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hq_app') THEN
        REVOKE ALL ON FUNCTION public.enqueue_notification_email(TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, JSONB) FROM hq_app;
        REVOKE ALL ON FUNCTION public.claim_notification_email_batch(INTEGER, INTEGER) FROM hq_app;
        REVOKE ALL ON FUNCTION public.resolve_notification_email_recipient(BIGINT, UUID) FROM hq_app;
        REVOKE ALL ON FUNCTION public.acknowledge_notification_email_sent(BIGINT, UUID) FROM hq_app;
        REVOKE ALL ON FUNCTION public.fail_notification_email(BIGINT, UUID, BOOLEAN, TEXT) FROM hq_app;
    END IF;
END
$acl$;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_batch(INTEGER, INTEGER) TO hq_notification_worker;
GRANT EXECUTE ON FUNCTION public.resolve_notification_email_recipient(BIGINT, UUID) TO hq_notification_worker;
GRANT EXECUTE ON FUNCTION public.acknowledge_notification_email_sent(BIGINT, UUID) TO hq_notification_worker;
GRANT EXECUTE ON FUNCTION public.fail_notification_email(BIGINT, UUID, BOOLEAN, TEXT) TO hq_notification_worker;

COMMENT ON SCHEMA notification_private IS 'Private storage for asynchronous marketplace email notifications.';
COMMENT ON TABLE notification_private.notification_outbox IS 'Private, RLS-protected email outbox; access is mediated by narrowly scoped functions.';
