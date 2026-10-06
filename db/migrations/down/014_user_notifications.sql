-- =====================================================================
-- HQ Marketplace — Rollback for 014_user_notifications.sql
-- Drops the trigger, the trigger function and the table, in that order.
-- No data is kept: notifications are derived state, and the orders the
-- payloads describe remain untouched. Nothing before 014 is modified.
-- =====================================================================

DROP TRIGGER IF EXISTS trg_orders_status_notify ON orders;
DROP FUNCTION IF EXISTS notify_order_status_change();
DROP TABLE IF EXISTS user_notifications;
