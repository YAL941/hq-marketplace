-- Phase 6.6B: isolate notification SECURITY DEFINER functions from postgres.
DO $role$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hq_notification_definer') THEN
        RAISE EXCEPTION 'hq_notification_definer already exists; refusing to adopt an external role';
    END IF;
    CREATE ROLE hq_notification_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
END
$role$;

CREATE SCHEMA notification_api AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA notification_api FROM PUBLIC, hq_app, hq_notification_worker;
GRANT USAGE ON SCHEMA notification_api TO hq_notification_worker;
GRANT USAGE ON SCHEMA public, notification_private TO hq_notification_definer;
GRANT CREATE ON SCHEMA public, notification_private TO hq_notification_definer;

-- The non-login function owner can inspect only records needed to validate and
-- resolve the four supported notification events. business_couriers is needed
-- by the existing orders RLS predicate; source-table RLS remains on.
GRANT SELECT ON public.orders, public.payments, public.businesses,
    public.business_users, public.roles, public.users, public.business_couriers
    TO hq_notification_definer;
GRANT EXECUTE ON FUNCTION public.app_user_id(), public.app_current_business_id(),
    public.app_is_platform_admin(), public.app_is_business_member(BIGINT),
    public.app_has_business_permission(BIGINT, TEXT), public.app_business_ids(),
    public.app_business_is_public(BIGINT), public.app_business_has_no_members(BIGINT)
    TO hq_notification_definer;
DO $citext$
BEGIN
    IF pg_catalog.to_regprocedure('public.citext_eq(public.citext,public.citext)') IS NOT NULL THEN
        GRANT EXECUTE ON FUNCTION public.citext_eq(public.citext, public.citext) TO hq_notification_definer;
    END IF;
END
$citext$;

ALTER TABLE notification_private.notification_outbox OWNER TO hq_notification_definer;
GRANT USAGE, SELECT ON SEQUENCE notification_private.notification_outbox_outbox_id_seq TO hq_notification_definer;
REVOKE CREATE ON SCHEMA notification_private FROM hq_notification_definer;
ALTER TABLE notification_private.notification_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_owner_outbox_all ON notification_private.notification_outbox
    FOR ALL TO hq_notification_definer USING (true) WITH CHECK (true);

-- A customer may resolve the verified active owner for their own order. The
-- worker may resolve only the verified user referenced by a currently leased
-- outbox row. These policies apply only to the non-login function owner.
CREATE POLICY notification_owner_business_owner_lookup ON public.business_users
    FOR SELECT TO hq_notification_definer
    USING (
        status = 'active'
        AND EXISTS (
            SELECT 1 FROM public.orders o
             WHERE o.business_id = business_users.business_id
               AND o.customer_id = public.app_user_id()
        )
    );
CREATE POLICY notification_owner_recipient_lookup ON public.users
    FOR SELECT TO hq_notification_definer
    USING (
        status = 'active' AND email_verified_at IS NOT NULL
        AND (
            user_id = public.app_user_id()
            OR EXISTS (
                SELECT 1 FROM notification_private.notification_outbox o
                 WHERE o.recipient_user_id = users.user_id
                   AND o.status = 'processing'
                   AND o.lease_until > pg_catalog.clock_timestamp()
            )
            OR EXISTS (
                SELECT 1 FROM public.business_users bu
                JOIN public.orders o ON o.business_id = bu.business_id
                 WHERE bu.user_id = users.user_id AND bu.status = 'active'
                   AND o.customer_id = public.app_user_id()
            )
        )
    );

-- The worker receives only wrappers in a private API schema; it cannot use
-- public-schema functions through default PUBLIC EXECUTE grants.
REVOKE USAGE ON SCHEMA public FROM hq_notification_worker;
REVOKE ALL ON FUNCTION public.enqueue_notification_email(TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, JSONB),
    public.enqueue_new_order_email(BIGINT), public.claim_notification_email_batch(INTEGER, INTEGER),
    public.resolve_notification_email_recipient(BIGINT, UUID),
    public.acknowledge_notification_email_sent(BIGINT, UUID),
    public.fail_notification_email(BIGINT, UUID, BOOLEAN, TEXT)
    FROM PUBLIC, hq_app, hq_notification_worker;

ALTER FUNCTION public.enqueue_notification_email(TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, JSONB) OWNER TO hq_notification_definer;
ALTER FUNCTION public.enqueue_new_order_email(BIGINT) OWNER TO hq_notification_definer;
ALTER FUNCTION public.claim_notification_email_batch(INTEGER, INTEGER) OWNER TO hq_notification_definer;
ALTER FUNCTION public.resolve_notification_email_recipient(BIGINT, UUID) OWNER TO hq_notification_definer;
ALTER FUNCTION public.acknowledge_notification_email_sent(BIGINT, UUID) OWNER TO hq_notification_definer;
ALTER FUNCTION public.fail_notification_email(BIGINT, UUID, BOOLEAN, TEXT) OWNER TO hq_notification_definer;
REVOKE CREATE ON SCHEMA public FROM hq_notification_definer;

GRANT CREATE ON SCHEMA notification_api TO hq_notification_definer;
CREATE FUNCTION notification_api.claim_email_batch(INTEGER, INTEGER)
RETURNS TABLE (outbox_id BIGINT, lease_token UUID, event_type TEXT, template_key TEXT,
               recipient_user_id BIGINT, locale TEXT, business_id BIGINT, order_id BIGINT,
               payment_id BIGINT, payload JSONB, attempt_count INTEGER, max_attempts SMALLINT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $f$ SELECT * FROM public.claim_notification_email_batch($1, $2) $f$;
CREATE FUNCTION notification_api.resolve_email_recipient(BIGINT, UUID)
RETURNS TABLE (email TEXT, full_name TEXT, locale TEXT, template_key TEXT, payload JSONB)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $f$ SELECT * FROM public.resolve_notification_email_recipient($1, $2) $f$;
CREATE FUNCTION notification_api.acknowledge_email_sent(BIGINT, UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $f$ SELECT public.acknowledge_notification_email_sent($1, $2) $f$;
CREATE FUNCTION notification_api.fail_email(BIGINT, UUID, BOOLEAN, TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $f$ SELECT public.fail_notification_email($1, $2, $3, $4) $f$;
CREATE FUNCTION notification_api.delivery_health()
RETURNS TABLE (status TEXT, last_error_code TEXT, record_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $f$ SELECT o.status, o.last_error_code, pg_catalog.count(*)
FROM notification_private.notification_outbox o
WHERE o.status IN ('pending', 'processing', 'dead', 'skipped')
GROUP BY o.status, o.last_error_code $f$;

ALTER FUNCTION notification_api.claim_email_batch(INTEGER, INTEGER) OWNER TO hq_notification_definer;
ALTER FUNCTION notification_api.resolve_email_recipient(BIGINT, UUID) OWNER TO hq_notification_definer;
ALTER FUNCTION notification_api.acknowledge_email_sent(BIGINT, UUID) OWNER TO hq_notification_definer;
ALTER FUNCTION notification_api.fail_email(BIGINT, UUID, BOOLEAN, TEXT) OWNER TO hq_notification_definer;
ALTER FUNCTION notification_api.delivery_health() OWNER TO hq_notification_definer;
REVOKE CREATE ON SCHEMA notification_api FROM hq_notification_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA notification_api FROM PUBLIC, hq_app;
GRANT EXECUTE ON FUNCTION notification_api.claim_email_batch(INTEGER, INTEGER),
    notification_api.resolve_email_recipient(BIGINT, UUID),
    notification_api.acknowledge_email_sent(BIGINT, UUID),
    notification_api.fail_email(BIGINT, UUID, BOOLEAN, TEXT),
    notification_api.delivery_health() TO hq_notification_worker;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_email(TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, JSONB),
    public.enqueue_new_order_email(BIGINT) TO hq_app;

COMMENT ON ROLE hq_notification_definer IS 'NOLOGIN owner for narrowly scoped notification SECURITY DEFINER functions and RLS-protected outbox';
