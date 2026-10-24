-- destructive: true
-- Drops in-app notification history; wholesale audit events and business data remain.
DROP FUNCTION create_wholesale_event_notifications(BIGINT, TEXT, BIGINT, TEXT, BIGINT, JSONB);
DROP TABLE in_app_notifications;
