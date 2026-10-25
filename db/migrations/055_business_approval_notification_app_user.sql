ALTER TABLE business_approval_notifications
    ADD COLUMN IF NOT EXISTS recipient_app_user_id BIGINT;

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

    IF recipient_type IS NULL THEN
        RAISE EXCEPTION 'business_approval_notifications.recipient_user_id is missing';
    ELSIF recipient_type = 'bigint' THEN
        UPDATE business_approval_notifications
           SET recipient_app_user_id = recipient_user_id
         WHERE recipient_app_user_id IS NULL;
    ELSIF recipient_type = 'uuid' THEN
        ALTER TABLE business_approval_notifications
            ALTER COLUMN recipient_user_id DROP NOT NULL;
    ELSE
        RAISE EXCEPTION 'Unsupported approval notification recipient_user_id type: %', recipient_type;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'business_approval_notifications'::regclass
           AND conname = 'business_approval_notifications_app_user_fk'
    ) THEN
        ALTER TABLE business_approval_notifications
            ADD CONSTRAINT business_approval_notifications_app_user_fk
            FOREIGN KEY (recipient_app_user_id) REFERENCES users (user_id) ON DELETE RESTRICT;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ix_business_approval_notifications_app_inbox
    ON business_approval_notifications
       (recipient_app_user_id, business_id, created_at DESC, notification_id DESC);

DO $$
DECLARE
    existing_policy RECORD;
BEGIN
    FOR existing_policy IN
        SELECT policyname
          FROM pg_policies
         WHERE schemaname = current_schema()
           AND tablename = 'business_approval_notifications'
    LOOP
        EXECUTE format('DROP POLICY %I ON business_approval_notifications', existing_policy.policyname);
    END LOOP;
END;
$$;

CREATE POLICY business_approval_notifications_read ON business_approval_notifications
    FOR SELECT USING (
        recipient_app_user_id = app_user_id()
        AND business_id = app_current_business_id()
    );

CREATE POLICY business_approval_notifications_update ON business_approval_notifications
    FOR UPDATE USING (
        recipient_app_user_id = app_user_id()
        AND business_id = app_current_business_id()
    ) WITH CHECK (
        recipient_app_user_id = app_user_id()
        AND business_id = app_current_business_id()
    );

CREATE POLICY business_approval_notifications_admin_insert ON business_approval_notifications
    FOR INSERT WITH CHECK (app_is_platform_admin());
