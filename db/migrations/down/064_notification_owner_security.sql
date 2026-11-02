-- destructive: false
DROP FUNCTION notification_api.delivery_health();
DROP FUNCTION notification_api.fail_email(BIGINT, UUID, BOOLEAN, TEXT);
DROP FUNCTION notification_api.acknowledge_email_sent(BIGINT, UUID);
DROP FUNCTION notification_api.resolve_email_recipient(BIGINT, UUID);
DROP FUNCTION notification_api.claim_email_batch(INTEGER, INTEGER);
REVOKE USAGE ON SCHEMA notification_api FROM hq_notification_worker;
DROP SCHEMA notification_api;

ALTER FUNCTION public.enqueue_notification_email(TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, JSONB) OWNER TO current_user;
ALTER FUNCTION public.enqueue_new_order_email(BIGINT) OWNER TO current_user;
ALTER FUNCTION public.claim_notification_email_batch(INTEGER, INTEGER) OWNER TO current_user;
ALTER FUNCTION public.resolve_notification_email_recipient(BIGINT, UUID) OWNER TO current_user;
ALTER FUNCTION public.acknowledge_notification_email_sent(BIGINT, UUID) OWNER TO current_user;
ALTER FUNCTION public.fail_notification_email(BIGINT, UUID, BOOLEAN, TEXT) OWNER TO current_user;
ALTER TABLE notification_private.notification_outbox NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_private.notification_outbox OWNER TO current_user;
DROP POLICY notification_owner_outbox_all ON notification_private.notification_outbox;
DROP POLICY notification_owner_business_owner_lookup ON public.business_users;
DROP POLICY notification_owner_recipient_lookup ON public.users;
REVOKE ALL ON SEQUENCE notification_private.notification_outbox_outbox_id_seq FROM hq_notification_definer;
REVOKE EXECUTE ON FUNCTION public.app_user_id(), public.app_current_business_id(),
    public.app_is_platform_admin(), public.app_is_business_member(BIGINT),
    public.app_has_business_permission(BIGINT, TEXT), public.app_business_ids(),
    public.app_business_is_public(BIGINT), public.app_business_has_no_members(BIGINT)
    FROM hq_notification_definer;
DROP OWNED BY hq_notification_definer;
DROP ROLE hq_notification_definer;
GRANT USAGE ON SCHEMA public TO hq_notification_worker;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_batch(INTEGER, INTEGER),
    public.resolve_notification_email_recipient(BIGINT, UUID),
    public.acknowledge_notification_email_sent(BIGINT, UUID),
    public.fail_notification_email(BIGINT, UUID, BOOLEAN, TEXT)
    TO hq_notification_worker;
