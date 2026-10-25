CREATE TABLE business_approval_notifications (
    notification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    recipient_user_id BIGINT NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    CONSTRAINT business_approval_notifications_unique
        UNIQUE (business_id, recipient_user_id, approved_at)
);

CREATE INDEX ix_business_approval_notifications_inbox
    ON business_approval_notifications (recipient_user_id, business_id, created_at DESC, notification_id DESC);
CREATE INDEX ix_business_approval_notifications_unread
    ON business_approval_notifications (recipient_user_id, business_id, created_at DESC)
    WHERE read_at IS NULL;

ALTER TABLE business_approval_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_approval_notifications_read ON business_approval_notifications
    FOR SELECT USING (
        recipient_user_id = app_user_id()
        AND business_id = app_current_business_id()
    );

CREATE POLICY business_approval_notifications_update ON business_approval_notifications
    FOR UPDATE USING (
        recipient_user_id = app_user_id()
        AND business_id = app_current_business_id()
    ) WITH CHECK (
        recipient_user_id = app_user_id()
        AND business_id = app_current_business_id()
    );

CREATE POLICY business_approval_notifications_admin_insert ON business_approval_notifications
    FOR INSERT WITH CHECK (app_is_platform_admin());
