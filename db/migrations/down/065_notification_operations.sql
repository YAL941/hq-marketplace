-- destructive: true
-- Down removes operational audit history and dedupe tombstones created after cleanup.
DROP TRIGGER trg_notification_outbox_dedupe_tombstone ON notification_private.notification_outbox;
DROP FUNCTION notification_private.prevent_archived_notification_duplicate();
DROP FUNCTION notification_admin.prune_terminal_batch(INTEGER);
DROP FUNCTION notification_admin.retry_dead_letter(BIGINT, TEXT);
DROP FUNCTION notification_admin.review_dead_letter(BIGINT, TEXT);
DROP FUNCTION notification_admin.inspect_dead_letter(BIGINT);
DROP FUNCTION notification_admin.health_summary();
DROP FUNCTION IF EXISTS notification_api.worker_delivery_state();
DROP FUNCTION IF EXISTS notification_api.worker_heartbeat(BOOLEAN, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS notification_api.worker_heartbeat(BOOLEAN);

ALTER TABLE notification_private.notification_admin_audit OWNER TO current_user;
ALTER TABLE notification_private.notification_worker_state OWNER TO current_user;
ALTER TABLE notification_private.notification_outbox_dedupe_tombstones OWNER TO current_user;
DROP TABLE notification_private.notification_admin_audit;
DROP TABLE notification_private.notification_worker_state;
DROP TABLE notification_private.notification_outbox_dedupe_tombstones;
DROP SCHEMA notification_admin;

REVOKE EXECUTE ON FUNCTION public.digest(BYTEA, TEXT) FROM hq_notification_definer;
DROP INDEX notification_private.ix_notification_outbox_skipped_retention;
DROP INDEX notification_private.ix_notification_outbox_sent_retention;
DROP INDEX notification_private.ix_notification_outbox_reviewed_dead;
ALTER TABLE notification_private.notification_outbox
    DROP COLUMN terminal_reviewed_by,
    DROP COLUMN terminal_reviewed_at;

-- Restore the Phase 6.4 selector; this is a rollback of the policy hardening.
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
     WHERE bu.business_id = v_order.business_id AND bu.status = 'active'
       AND r.scope = 'business' AND r.role_key = 'business_owner' AND r.is_active
       AND u.status = 'active' AND u.email_verified_at IS NOT NULL
     ORDER BY bu.created_at, bu.user_id LIMIT 1;
    IF v_owner_user_id IS NULL THEN RETURN NULL; END IF;
    RETURN public.enqueue_notification_email(
        'order:' || v_order.order_id::TEXT || ':created', 'order.created', 'order.created',
        v_owner_user_id, 'en', v_order.business_id, v_order.order_id, NULL,
        pg_catalog.jsonb_build_object('order_number', v_order.order_number, 'business_name', v_order.business_name)
    );
END
$function$;
