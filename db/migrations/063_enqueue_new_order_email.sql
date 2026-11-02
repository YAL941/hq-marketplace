-- Phase 6.4: resolve the verified merchant owner without granting hq_app
-- direct visibility into another user's business_users row.
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

    SELECT o.order_id, o.business_id, o.customer_id, o.order_number,
           b.business_name
      INTO v_order
      FROM public.orders AS o
      JOIN public.businesses AS b ON b.business_id = o.business_id
     WHERE o.order_id = p_order_id;
    IF NOT FOUND OR v_order.customer_id <> public.app_user_id() THEN
        RAISE EXCEPTION 'order is outside the current customer context' USING ERRCODE = '42501';
    END IF;
    IF public.app_current_business_id() IS NOT NULL
       AND public.app_current_business_id() <> v_order.business_id THEN
        RAISE EXCEPTION 'order is outside the current business context' USING ERRCODE = '42501';
    END IF;

    SELECT bu.user_id INTO v_owner_user_id
      FROM public.business_users AS bu
      JOIN public.roles AS r ON r.role_id = bu.role_id
      JOIN public.users AS u ON u.user_id = bu.user_id
     WHERE bu.business_id = v_order.business_id
       AND bu.status = 'active'
       AND r.scope = 'business' AND r.role_key = 'business_owner' AND r.is_active
       AND u.status = 'active' AND u.email_verified_at IS NOT NULL
     ORDER BY bu.created_at, bu.user_id
     LIMIT 1;

    IF v_owner_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN public.enqueue_notification_email(
        'order:' || v_order.order_id::TEXT || ':created',
        'order.created', 'order.created', v_owner_user_id, 'en',
        v_order.business_id, v_order.order_id, NULL,
        pg_catalog.jsonb_build_object(
            'order_number', v_order.order_number,
            'business_name', v_order.business_name
        )
    );
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_new_order_email(BIGINT) FROM PUBLIC;
DO $acl$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hq_app') THEN
        REVOKE ALL ON FUNCTION public.enqueue_new_order_email(BIGINT) FROM hq_app;
    END IF;
END
$acl$;
