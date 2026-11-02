-- Phase 6.7B: audited operational controls for marketplace email notifications.
-- Retention is operator-triggered, bounded, and preserves a private dedupe tombstone.

ALTER TABLE notification_private.notification_outbox
    ADD COLUMN terminal_reviewed_at TIMESTAMPTZ,
    ADD COLUMN terminal_reviewed_by BIGINT REFERENCES public.users(user_id) ON DELETE SET NULL;

CREATE INDEX ix_notification_outbox_reviewed_dead
    ON notification_private.notification_outbox (terminal_reviewed_at, outbox_id)
    WHERE status = 'dead' AND terminal_reviewed_at IS NOT NULL;
CREATE INDEX ix_notification_outbox_sent_retention
    ON notification_private.notification_outbox (sent_at, outbox_id)
    WHERE status = 'sent';
CREATE INDEX ix_notification_outbox_skipped_retention
    ON notification_private.notification_outbox (updated_at, outbox_id)
    WHERE status = 'skipped';

CREATE TABLE notification_private.notification_outbox_dedupe_tombstones (
    dedupe_hash BYTEA PRIMARY KEY CHECK (pg_catalog.octet_length(dedupe_hash) = 32),
    archived_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TABLE notification_private.notification_worker_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    smtp_configured BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ NOT NULL,
    smtp_last_error_code TEXT CHECK (smtp_last_error_code IS NULL OR smtp_last_error_code IN (
        'smtp_timeout', 'smtp_connection_failed', 'smtp_authentication_failed',
        'smtp_temporary_rejection', 'smtp_permanent_rejection', 'smtp_send_failed'
    )),
    smtp_last_error_at TIMESTAMPTZ,
    smtp_last_success_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TABLE notification_private.notification_admin_audit (
    audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    outbox_id BIGINT,
    actor_user_id BIGINT REFERENCES public.users(user_id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('health_viewed', 'inspected', 'reviewed', 'retried', 'retention_deleted')),
    reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN (
        'provider_corrected', 'recipient_corrected', 'manual_review', 'false_positive', 'retention_policy'
    )),
    affected_count INTEGER CHECK (affected_count IS NULL OR affected_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX ix_notification_admin_audit_outbox
    ON notification_private.notification_admin_audit (outbox_id, created_at DESC)
    WHERE outbox_id IS NOT NULL;

ALTER TABLE notification_private.notification_outbox_dedupe_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_private.notification_outbox_dedupe_tombstones FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_private.notification_worker_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_private.notification_worker_state FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_private.notification_admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_private.notification_admin_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE notification_private.notification_outbox_dedupe_tombstones,
    notification_private.notification_worker_state,
    notification_private.notification_admin_audit FROM PUBLIC, hq_app, hq_notification_worker;
REVOKE ALL ON SEQUENCE notification_private.notification_admin_audit_audit_id_seq
    FROM PUBLIC, hq_app, hq_notification_worker;

ALTER TABLE notification_private.notification_outbox_dedupe_tombstones OWNER TO hq_notification_definer;
ALTER TABLE notification_private.notification_worker_state OWNER TO hq_notification_definer;
ALTER TABLE notification_private.notification_admin_audit OWNER TO hq_notification_definer;
GRANT USAGE, SELECT ON SEQUENCE notification_private.notification_admin_audit_audit_id_seq TO hq_notification_definer;
CREATE POLICY notification_owner_dedupe_all ON notification_private.notification_outbox_dedupe_tombstones
    FOR ALL TO hq_notification_definer USING (true) WITH CHECK (true);
CREATE POLICY notification_owner_worker_state_all ON notification_private.notification_worker_state
    FOR ALL TO hq_notification_definer USING (true) WITH CHECK (true);
CREATE POLICY notification_owner_admin_audit_all ON notification_private.notification_admin_audit
    FOR ALL TO hq_notification_definer USING (true) WITH CHECK (true);

DO $extension_check$
BEGIN
    IF pg_catalog.to_regprocedure('public.digest(bytea,text)') IS NULL THEN
        RAISE EXCEPTION 'pgcrypto public.digest(bytea,text) is required for dedupe tombstones';
    END IF;
    GRANT EXECUTE ON FUNCTION public.digest(BYTEA, TEXT) TO hq_notification_definer;
END
$extension_check$;

CREATE FUNCTION notification_private.prevent_archived_notification_duplicate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.dedupe_key, 0));
    IF EXISTS (
        SELECT 1 FROM notification_private.notification_outbox_dedupe_tombstones t
         WHERE t.dedupe_hash = public.digest(pg_catalog.convert_to(NEW.dedupe_key, 'UTF8'), 'sha256')
    ) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END
$function$;
ALTER FUNCTION notification_private.prevent_archived_notification_duplicate() OWNER TO hq_notification_definer;
REVOKE ALL ON FUNCTION notification_private.prevent_archived_notification_duplicate() FROM PUBLIC, hq_app, hq_notification_worker;
CREATE TRIGGER trg_notification_outbox_dedupe_tombstone
    BEFORE INSERT ON notification_private.notification_outbox
    FOR EACH ROW EXECUTE FUNCTION notification_private.prevent_archived_notification_duplicate();

-- With ux_business_users_single_owner in place there is at most one active
-- business_owner. That row is the primary owner; no created_at selection rule.
CREATE OR REPLACE FUNCTION public.enqueue_new_order_email(p_order_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    v_order RECORD;
    v_owner_user_id BIGINT;
BEGIN
    IF public.app_user_id() IS NULL THEN
        RAISE EXCEPTION 'authenticated customer context required' USING ERRCODE = '42501';
    END IF;
    SELECT o.order_id, o.business_id, o.customer_id, o.order_number, b.business_name
      INTO v_order
      FROM public.orders o JOIN public.businesses b ON b.business_id = o.business_id
     WHERE o.order_id = p_order_id;
    IF NOT FOUND OR v_order.customer_id <> public.app_user_id() THEN
        RAISE EXCEPTION 'order is outside the current customer context' USING ERRCODE = '42501';
    END IF;
    IF public.app_current_business_id() IS NOT NULL
       AND public.app_current_business_id() <> v_order.business_id THEN
        RAISE EXCEPTION 'order is outside the current business context' USING ERRCODE = '42501';
    END IF;

    SELECT bu.user_id INTO v_owner_user_id
      FROM public.business_users bu
      JOIN public.roles r ON r.role_id = bu.role_id
      JOIN public.users u ON u.user_id = bu.user_id
     WHERE bu.business_id = v_order.business_id
       AND bu.status = 'active'
       AND r.scope = 'business' AND r.role_key = 'business_owner' AND r.is_active
       AND u.status = 'active' AND u.email_verified_at IS NOT NULL;
    IF v_owner_user_id IS NULL THEN RETURN NULL; END IF;

    RETURN public.enqueue_notification_email(
        'order:' || v_order.order_id::TEXT || ':created',
        'order.created', 'order.created', v_owner_user_id, 'en',
        v_order.business_id, v_order.order_id, NULL,
        pg_catalog.jsonb_build_object('order_number', v_order.order_number, 'business_name', v_order.business_name)
    );
END
$function$;

CREATE SCHEMA notification_admin AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA notification_admin FROM PUBLIC, hq_notification_worker;
GRANT USAGE ON SCHEMA notification_admin TO hq_app, hq_notification_definer;
GRANT CREATE ON SCHEMA notification_admin TO hq_notification_definer;

CREATE FUNCTION notification_api.worker_heartbeat(
    p_smtp_configured BOOLEAN, p_smtp_error_code TEXT, p_smtp_succeeded BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
    IF p_smtp_error_code IS NOT NULL AND p_smtp_error_code NOT IN (
        'smtp_timeout', 'smtp_connection_failed', 'smtp_authentication_failed',
        'smtp_temporary_rejection', 'smtp_permanent_rejection', 'smtp_send_failed'
    ) THEN
        RAISE EXCEPTION 'invalid SMTP failure code' USING ERRCODE = '22023';
    END IF;
    IF p_smtp_error_code IS NOT NULL AND p_smtp_succeeded THEN
        RAISE EXCEPTION 'conflicting SMTP outcome' USING ERRCODE = '22023';
    END IF;
    INSERT INTO notification_private.notification_worker_state AS existing(
        singleton, smtp_configured, last_seen_at, smtp_last_error_code,
        smtp_last_error_at, smtp_last_success_at
    )
    VALUES (TRUE, p_smtp_configured, pg_catalog.clock_timestamp(), p_smtp_error_code,
            CASE WHEN p_smtp_error_code IS NOT NULL THEN pg_catalog.clock_timestamp() END,
            CASE WHEN p_smtp_succeeded THEN pg_catalog.clock_timestamp() END)
    ON CONFLICT (singleton) DO UPDATE
       SET smtp_configured = EXCLUDED.smtp_configured,
           last_seen_at = EXCLUDED.last_seen_at,
           smtp_last_error_code = CASE WHEN p_smtp_error_code IS NOT NULL THEN p_smtp_error_code
                                       WHEN p_smtp_succeeded THEN NULL ELSE existing.smtp_last_error_code END,
           smtp_last_error_at = CASE WHEN p_smtp_error_code IS NOT NULL THEN pg_catalog.clock_timestamp()
                                     ELSE existing.smtp_last_error_at END,
           smtp_last_success_at = CASE WHEN p_smtp_succeeded THEN pg_catalog.clock_timestamp()
                                       ELSE existing.smtp_last_success_at END,
           updated_at = pg_catalog.clock_timestamp();
END
$function$;
ALTER FUNCTION notification_api.worker_heartbeat(BOOLEAN, TEXT, BOOLEAN) OWNER TO hq_notification_definer;
REVOKE ALL ON FUNCTION notification_api.worker_heartbeat(BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, hq_app;
GRANT EXECUTE ON FUNCTION notification_api.worker_heartbeat(BOOLEAN, TEXT, BOOLEAN) TO hq_notification_worker;

CREATE FUNCTION notification_api.worker_delivery_state()
RETURNS TABLE (
    smtp_configured BOOLEAN, smtp_last_error_code TEXT,
    smtp_last_success_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
    SELECT w.smtp_configured, w.smtp_last_error_code, w.smtp_last_success_at, w.last_seen_at
      FROM notification_private.notification_worker_state w WHERE w.singleton
$function$;
ALTER FUNCTION notification_api.worker_delivery_state() OWNER TO hq_notification_definer;
REVOKE ALL ON FUNCTION notification_api.worker_delivery_state() FROM PUBLIC, hq_app;
GRANT EXECUTE ON FUNCTION notification_api.worker_delivery_state() TO hq_notification_worker;

CREATE FUNCTION notification_admin.health_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_result JSONB;
BEGIN
    IF public.app_user_id() IS NULL OR NOT public.app_is_platform_admin() THEN
        RAISE EXCEPTION 'platform administrator required' USING ERRCODE = '42501';
    END IF;
    SELECT pg_catalog.jsonb_build_object(
        'pending_count', (SELECT count(*) FROM notification_private.notification_outbox WHERE status = 'pending'),
        'processing_count', (SELECT count(*) FROM notification_private.notification_outbox WHERE status = 'processing'),
        'sent_count', (SELECT count(*) FROM notification_private.notification_outbox WHERE status = 'sent'),
        'dead_count', (SELECT count(*) FROM notification_private.notification_outbox WHERE status = 'dead'),
        'skipped_count', (SELECT count(*) FROM notification_private.notification_outbox WHERE status = 'skipped'),
        'oldest_pending_age_seconds', COALESCE((
            SELECT pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - min(created_at)))
              FROM notification_private.notification_outbox WHERE status = 'pending'
        ), 0),
        'expired_lease_count', (SELECT count(*) FROM notification_private.notification_outbox
            WHERE status = 'processing' AND lease_until <= pg_catalog.clock_timestamp()),
        'failure_code_counts', COALESCE((
            SELECT pg_catalog.jsonb_object_agg(failure_code, failure_count)
              FROM (SELECT last_error_code AS failure_code, count(*) AS failure_count
                      FROM notification_private.notification_outbox
                     WHERE last_error_code IS NOT NULL AND status IN ('pending', 'dead', 'skipped')
                     GROUP BY last_error_code) f
        ), '{}'::JSONB),
        'worker_heartbeat_age_seconds', CASE WHEN w.last_seen_at IS NULL THEN NULL
            ELSE pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - w.last_seen_at)) END,
        'smtp_last_error_code', w.smtp_last_error_code,
        'smtp_last_error_age_seconds', CASE WHEN w.smtp_last_error_at IS NULL THEN NULL
            ELSE pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - w.smtp_last_error_at)) END,
        'smtp_last_success_age_seconds', CASE WHEN w.smtp_last_success_at IS NULL THEN NULL
            ELSE pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - w.smtp_last_success_at)) END,
        'worker_liveness', CASE WHEN w.last_seen_at IS NULL OR w.last_seen_at < pg_catalog.clock_timestamp() - INTERVAL '90 seconds'
            THEN 'stopped' ELSE 'alive' END,
        'smtp_configuration', CASE WHEN w.last_seen_at IS NULL OR w.last_seen_at < pg_catalog.clock_timestamp() - INTERVAL '90 seconds'
            THEN 'unknown' WHEN w.smtp_configured THEN 'configured' ELSE 'not_configured' END,
        'smtp_delivery_state', CASE
            WHEN w.last_seen_at IS NULL OR w.last_seen_at < pg_catalog.clock_timestamp() - INTERVAL '90 seconds' THEN 'unknown'
            WHEN NOT w.smtp_configured THEN 'not_configured'
            WHEN w.smtp_last_error_code IS NOT NULL THEN 'failed'
            WHEN w.smtp_last_success_at IS NULL THEN 'unverified'
            ELSE 'ready' END,
        'delivery_ready', COALESCE(w.last_seen_at >= pg_catalog.clock_timestamp() - INTERVAL '90 seconds'
            AND w.smtp_configured AND w.smtp_last_error_code IS NULL
            AND w.smtp_last_success_at IS NOT NULL, FALSE)
    ) INTO v_result
    FROM (SELECT singleton, last_seen_at, smtp_configured, smtp_last_error_code,
                 smtp_last_error_at, smtp_last_success_at
            FROM notification_private.notification_worker_state WHERE singleton) w
    RIGHT JOIN (SELECT TRUE AS keep_row) anchor ON TRUE;
    INSERT INTO notification_private.notification_admin_audit(actor_user_id, action)
    VALUES (public.app_user_id(), 'health_viewed');
    RETURN v_result;
END
$function$;

CREATE FUNCTION notification_admin.inspect_dead_letter(p_outbox_id BIGINT)
RETURNS TABLE (
    outbox_id BIGINT, event_type TEXT, status TEXT, attempt_count INTEGER,
    max_attempts SMALLINT, last_error_code TEXT, created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ, terminal_reviewed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
    IF public.app_user_id() IS NULL OR NOT public.app_is_platform_admin() THEN
        RAISE EXCEPTION 'platform administrator required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT o.outbox_id, o.event_type, o.status, o.attempt_count, o.max_attempts,
               o.last_error_code, o.created_at, o.updated_at, o.terminal_reviewed_at
          FROM notification_private.notification_outbox o
         WHERE o.outbox_id = p_outbox_id AND o.status = 'dead';
    IF FOUND THEN
        INSERT INTO notification_private.notification_admin_audit(outbox_id, actor_user_id, action)
        VALUES (p_outbox_id, public.app_user_id(), 'inspected');
    END IF;
END
$function$;

CREATE FUNCTION notification_admin.review_dead_letter(p_outbox_id BIGINT, p_reason_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_changed INTEGER;
BEGIN
    IF public.app_user_id() IS NULL OR NOT public.app_is_platform_admin() THEN
        RAISE EXCEPTION 'platform administrator required' USING ERRCODE = '42501';
    END IF;
    IF p_reason_code NOT IN ('provider_corrected', 'recipient_corrected', 'manual_review', 'false_positive') THEN
        RAISE EXCEPTION 'invalid review reason' USING ERRCODE = '22023';
    END IF;
    UPDATE notification_private.notification_outbox
       SET terminal_reviewed_at = pg_catalog.clock_timestamp(),
           terminal_reviewed_by = public.app_user_id(), updated_at = pg_catalog.clock_timestamp()
     WHERE outbox_id = p_outbox_id AND status = 'dead'
       AND (lease_until IS NULL OR lease_until <= pg_catalog.clock_timestamp());
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed > 0 THEN
        INSERT INTO notification_private.notification_admin_audit(outbox_id, actor_user_id, action, reason_code)
        VALUES (p_outbox_id, public.app_user_id(), 'reviewed', p_reason_code);
    END IF;
    RETURN v_changed > 0;
END
$function$;

CREATE FUNCTION notification_admin.retry_dead_letter(p_outbox_id BIGINT, p_reason_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_changed INTEGER;
BEGIN
    IF public.app_user_id() IS NULL OR NOT public.app_is_platform_admin() THEN
        RAISE EXCEPTION 'platform administrator required' USING ERRCODE = '42501';
    END IF;
    IF p_reason_code NOT IN ('provider_corrected', 'recipient_corrected', 'manual_review', 'false_positive') THEN
        RAISE EXCEPTION 'invalid retry reason' USING ERRCODE = '22023';
    END IF;
    UPDATE notification_private.notification_outbox
       SET status = 'pending', attempt_count = 0,
           available_at = pg_catalog.clock_timestamp(), lease_until = NULL, lease_token = NULL,
           last_error_code = NULL, sent_at = NULL,
           terminal_reviewed_at = NULL, terminal_reviewed_by = NULL,
           updated_at = pg_catalog.clock_timestamp()
     WHERE outbox_id = p_outbox_id AND status = 'dead'
       AND terminal_reviewed_at IS NOT NULL
       AND (lease_until IS NULL OR lease_until <= pg_catalog.clock_timestamp());
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed > 0 THEN
        INSERT INTO notification_private.notification_admin_audit(outbox_id, actor_user_id, action, reason_code)
        VALUES (p_outbox_id, public.app_user_id(), 'retried', p_reason_code);
    END IF;
    RETURN v_changed > 0;
END
$function$;

CREATE FUNCTION notification_admin.prune_terminal_batch(p_limit INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_ids BIGINT[]; v_keys TEXT[]; v_deleted INTEGER := 0; v_index INTEGER;
BEGIN
    IF public.app_user_id() IS NULL OR NOT public.app_is_platform_admin() THEN
        RAISE EXCEPTION 'platform administrator required' USING ERRCODE = '42501';
    END IF;
    IF p_limit < 1 OR p_limit > 500 THEN
        RAISE EXCEPTION 'retention batch must be between 1 and 500' USING ERRCODE = '22023';
    END IF;

    -- Acquire dedupe advisory locks before row locks, matching the insert trigger.
    SELECT pg_catalog.array_agg(candidate.outbox_id ORDER BY candidate.outbox_id),
           pg_catalog.array_agg(candidate.dedupe_key ORDER BY candidate.outbox_id)
      INTO v_ids, v_keys
      FROM (
          SELECT o.outbox_id, o.dedupe_key
            FROM notification_private.notification_outbox o
           WHERE ((o.status = 'sent' AND o.sent_at < pg_catalog.clock_timestamp() - INTERVAL '90 days')
              OR (o.status = 'dead' AND o.terminal_reviewed_at < pg_catalog.clock_timestamp() - INTERVAL '180 days')
              OR (o.status = 'skipped' AND o.updated_at < pg_catalog.clock_timestamp() - INTERVAL '180 days'))
             AND (o.lease_until IS NULL OR o.lease_until <= pg_catalog.clock_timestamp())
           ORDER BY o.outbox_id LIMIT p_limit
      ) candidate;
    IF v_ids IS NOT NULL THEN
        FOR v_index IN 1..pg_catalog.array_length(v_ids, 1) LOOP
            PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_keys[v_index], 0));
        END LOOP;
        WITH locked AS (
            SELECT o.outbox_id
              FROM notification_private.notification_outbox o
             WHERE o.outbox_id = ANY(v_ids)
               AND ((o.status = 'sent' AND o.sent_at < pg_catalog.clock_timestamp() - INTERVAL '90 days')
                 OR (o.status = 'dead' AND o.terminal_reviewed_at < pg_catalog.clock_timestamp() - INTERVAL '180 days')
                 OR (o.status = 'skipped' AND o.updated_at < pg_catalog.clock_timestamp() - INTERVAL '180 days'))
               AND (o.lease_until IS NULL OR o.lease_until <= pg_catalog.clock_timestamp())
             ORDER BY o.outbox_id
             FOR UPDATE SKIP LOCKED
        ), removed AS (
            DELETE FROM notification_private.notification_outbox o
             USING locked
             WHERE o.outbox_id = locked.outbox_id
            RETURNING o.outbox_id, o.dedupe_key
        ), archived AS (
            INSERT INTO notification_private.notification_outbox_dedupe_tombstones(dedupe_hash)
            SELECT public.digest(pg_catalog.convert_to(dedupe_key, 'UTF8'), 'sha256') FROM removed
            ON CONFLICT DO NOTHING
            RETURNING 1
        ) SELECT (SELECT count(*) FROM removed)::INTEGER INTO v_deleted;
        IF v_deleted > 0 THEN
            INSERT INTO notification_private.notification_admin_audit(actor_user_id, action, reason_code, affected_count)
            VALUES (public.app_user_id(), 'retention_deleted', 'retention_policy', v_deleted);
        END IF;
    END IF;
    RETURN v_deleted;
END
$function$;

ALTER FUNCTION notification_admin.health_summary() OWNER TO hq_notification_definer;
ALTER FUNCTION notification_admin.inspect_dead_letter(BIGINT) OWNER TO hq_notification_definer;
ALTER FUNCTION notification_admin.review_dead_letter(BIGINT, TEXT) OWNER TO hq_notification_definer;
ALTER FUNCTION notification_admin.retry_dead_letter(BIGINT, TEXT) OWNER TO hq_notification_definer;
ALTER FUNCTION notification_admin.prune_terminal_batch(INTEGER) OWNER TO hq_notification_definer;
REVOKE CREATE ON SCHEMA notification_admin FROM hq_notification_definer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA notification_admin FROM PUBLIC, hq_notification_worker;
GRANT EXECUTE ON FUNCTION notification_admin.health_summary(),
    notification_admin.inspect_dead_letter(BIGINT),
    notification_admin.review_dead_letter(BIGINT, TEXT),
    notification_admin.retry_dead_letter(BIGINT, TEXT),
    notification_admin.prune_terminal_batch(INTEGER) TO hq_app;

COMMENT ON TABLE notification_private.notification_outbox_dedupe_tombstones IS
    'Private SHA-256 dedupe tombstones retained after outbox cleanup to prevent event replay from re-enqueueing.';
COMMENT ON FUNCTION notification_admin.prune_terminal_batch(INTEGER) IS
    'Admin-only bounded cleanup: sent after 90d; dead after 180d from review; skipped after 180d terminal age.';
