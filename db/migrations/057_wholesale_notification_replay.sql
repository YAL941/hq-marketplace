CREATE FUNCTION wholesale_notification_recipients_for_event(
    p_event_id BIGINT,
    p_business_id BIGINT
)
RETURNS TABLE (
    notification_id BIGINT,
    recipient_user_id BIGINT,
    event_type TEXT,
    target_type TEXT,
    target_id BIGINT,
    metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    source_event wholesale_events%ROWTYPE;
    actor_business_id BIGINT := app_current_business_id();
BEGIN
    SELECT * INTO source_event
      FROM wholesale_events
     WHERE event_id = p_event_id;

    IF NOT FOUND
       OR app_user_id() IS NULL
       OR source_event.actor_user_id IS DISTINCT FROM app_user_id()
       OR actor_business_id IS NULL
       OR actor_business_id NOT IN (source_event.buyer_business_id, source_event.supplier_business_id)
       OR p_business_id NOT IN (source_event.buyer_business_id, source_event.supplier_business_id)
       OR NOT app_has_business_permission(actor_business_id, 'wholesale.manage') THEN
        RAISE EXCEPTION 'Unauthorized Wholesale notification recipient lookup';
    END IF;

    RETURN QUERY
    SELECT n.notification_id, n.recipient_user_id, n.event_type, n.target_type, n.target_id, n.metadata
      FROM in_app_notifications n
     WHERE n.event_id = p_event_id
       AND n.business_id = p_business_id
     ORDER BY n.notification_id;
END;
$$;

REVOKE ALL ON FUNCTION wholesale_notification_recipients_for_event(BIGINT, BIGINT) FROM PUBLIC;
