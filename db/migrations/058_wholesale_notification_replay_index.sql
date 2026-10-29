CREATE INDEX ix_in_app_notifications_replay
    ON in_app_notifications (recipient_user_id, business_id, notification_id);
