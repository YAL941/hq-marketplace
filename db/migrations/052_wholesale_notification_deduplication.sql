ALTER TABLE in_app_notifications
    ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

UPDATE in_app_notifications
   SET dedupe_key = business_id::TEXT || ':legacy:' || event_id::TEXT
 WHERE dedupe_key IS NULL;

ALTER TABLE in_app_notifications
    ALTER COLUMN dedupe_key SET NOT NULL;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'in_app_notifications_recipient_dedupe_unique'
           AND conrelid = 'in_app_notifications'::regclass
    ) THEN
        ALTER TABLE in_app_notifications
            ADD CONSTRAINT in_app_notifications_recipient_dedupe_unique
                UNIQUE (recipient_user_id, dedupe_key);
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION create_wholesale_event_notifications(
    p_event_id BIGINT,
    p_event_type TEXT,
    p_business_id BIGINT,
    p_target_type TEXT,
    p_target_id BIGINT,
    p_metadata JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    source_event wholesale_events%ROWTYPE;
    actor_business_id BIGINT := app_current_business_id();
    expected_business_id BIGINT;
    valid_source BOOLEAN := FALSE;
    notification_dedupe_key TEXT;
BEGIN
    IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
        RAISE EXCEPTION 'Wholesale notification metadata must be an object';
    END IF;

    SELECT * INTO source_event
      FROM wholesale_events
     WHERE event_id = p_event_id;

    IF NOT FOUND
       OR actor_business_id IS NULL
       OR actor_business_id NOT IN (source_event.buyer_business_id, source_event.supplier_business_id)
       OR NOT app_has_business_permission(actor_business_id, 'wholesale.manage') THEN
        RAISE EXCEPTION 'Unauthorized Wholesale notification event';
    END IF;

    IF source_event.entity_type = p_target_type AND source_event.entity_id = p_target_id THEN
        valid_source := TRUE;
    ELSIF source_event.entity_type = 'receipt'
          AND p_target_type = 'purchase_order'
          AND source_event.event_type = 'purchase_order.received'
          AND source_event.details ->> 'purchaseOrderId' = p_target_id::TEXT THEN
        valid_source := TRUE;
    END IF;
    IF NOT valid_source THEN
        RAISE EXCEPTION 'Notification target does not match its Wholesale event';
    END IF;

    CASE p_event_type
        WHEN 'wholesale.purchase_order.created' THEN
            valid_source := source_event.event_type = 'purchase_order.created'
                AND p_target_type = 'purchase_order';
            expected_business_id := source_event.supplier_business_id;
        WHEN 'wholesale.purchase_order.status_changed' THEN
            valid_source := source_event.entity_type = 'purchase_order'
                AND source_event.event_type IN (
                    'purchase_order.confirmed', 'purchase_order.processing',
                    'purchase_order.shipped', 'purchase_order.cancelled'
                )
                AND p_target_type = 'purchase_order';
            expected_business_id := CASE
                WHEN actor_business_id = source_event.buyer_business_id THEN source_event.supplier_business_id
                ELSE source_event.buyer_business_id
            END;
        WHEN 'wholesale.rfq.created' THEN
            valid_source := source_event.event_type = 'rfq.created' AND p_target_type = 'rfq';
            expected_business_id := source_event.supplier_business_id;
        WHEN 'wholesale.rfq.quoted' THEN
            valid_source := source_event.event_type = 'rfq.quoted' AND p_target_type = 'rfq';
            expected_business_id := source_event.buyer_business_id;
        WHEN 'wholesale.rfq.decided' THEN
            valid_source := source_event.event_type IN ('rfq.accepted', 'rfq.rejected', 'rfq.cancelled')
                AND p_target_type = 'rfq';
            expected_business_id := source_event.supplier_business_id;
        WHEN 'wholesale.receipt.recorded' THEN
            valid_source := source_event.event_type = 'purchase_order.received'
                AND source_event.entity_type = 'receipt'
                AND p_target_type = 'purchase_order'
                AND actor_business_id = source_event.buyer_business_id;
            expected_business_id := source_event.buyer_business_id;
        ELSE
            RAISE EXCEPTION 'Unsupported Wholesale notification type';
    END CASE;

    IF NOT valid_source OR p_business_id <> expected_business_id THEN
        RAISE EXCEPTION 'Wholesale notification recipient business is invalid';
    END IF;

    notification_dedupe_key := p_business_id::TEXT || ':' || p_event_type || ':'
        || p_target_type || ':' || p_target_id::TEXT || ':' || md5(p_metadata::TEXT);

    INSERT INTO in_app_notifications (
        recipient_user_id, business_id, event_id, event_type, target_type, target_id, dedupe_key, metadata
    )
    SELECT bu.user_id, p_business_id, p_event_id, p_event_type, p_target_type,
           p_target_id, notification_dedupe_key, p_metadata
      FROM business_users bu
      JOIN users u ON u.user_id = bu.user_id AND u.status = 'active'
      JOIN roles r ON r.role_id = bu.role_id AND r.scope = 'business' AND r.is_active
      JOIN role_permissions rp ON rp.role_id = r.role_id
      JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE bu.business_id = p_business_id
       AND bu.status = 'active'
       AND p.permission_key = 'wholesale.view'
    ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION create_wholesale_event_notifications(BIGINT, TEXT, BIGINT, TEXT, BIGINT, JSONB) FROM PUBLIC;
