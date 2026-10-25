-- destructive: true
DROP POLICY IF EXISTS business_approval_notifications_read ON business_approval_notifications;
DROP POLICY IF EXISTS business_approval_notifications_update ON business_approval_notifications;
DROP POLICY IF EXISTS business_approval_notifications_admin_insert ON business_approval_notifications;

DROP INDEX IF EXISTS ix_business_approval_notifications_app_inbox;
ALTER TABLE business_approval_notifications
    DROP CONSTRAINT IF EXISTS business_approval_notifications_app_user_fk;
ALTER TABLE business_approval_notifications
    DROP COLUMN recipient_app_user_id;

DO $$
DECLARE
    recipient_type TEXT;
BEGIN
    SELECT format_type(atttypid, atttypmod)
      INTO recipient_type
      FROM pg_attribute
     WHERE attrelid = 'business_approval_notifications'::regclass
       AND attname = 'recipient_user_id'
       AND NOT attisdropped;

    IF recipient_type = 'bigint' THEN
        EXECUTE 'CREATE POLICY business_approval_notifications_read ON business_approval_notifications
            FOR SELECT USING (
                recipient_user_id = app_user_id()
                AND business_id = app_current_business_id()
            )';

        EXECUTE 'CREATE POLICY business_approval_notifications_update ON business_approval_notifications
            FOR UPDATE USING (
                recipient_user_id = app_user_id()
                AND business_id = app_current_business_id()
            ) WITH CHECK (
                recipient_user_id = app_user_id()
                AND business_id = app_current_business_id()
            )';
    END IF;
END;
$$;

CREATE POLICY business_approval_notifications_admin_insert ON business_approval_notifications
    FOR INSERT WITH CHECK (app_is_platform_admin());
