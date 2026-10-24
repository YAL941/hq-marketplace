import type { PoolClient } from 'pg';
import { notFound } from '../../db/errors.js';

export interface InAppNotificationRow {
    notification_id: string;
    business_id: string;
    event_id: string;
    event_type: string;
    target_type: 'purchase_order' | 'rfq';
    target_id: string;
    metadata: Record<string, unknown>;
    created_at: Date;
    read_at: Date | null;
}

export async function listInAppNotifications(
    client: PoolClient,
    userId: number,
    businessId: number,
    limit: number,
    offset: number,
) {
    const [{ rows: notifications }, { rows: count }] = await Promise.all([
        client.query<InAppNotificationRow>(
            `SELECT notification_id, business_id, event_id, event_type, target_type,
                    target_id, metadata, created_at, read_at
               FROM in_app_notifications
              WHERE recipient_user_id = $1 AND business_id = $2
              ORDER BY created_at DESC, notification_id DESC
              LIMIT $3 OFFSET $4`,
            [userId, businessId, limit, offset],
        ),
        client.query<{ unread_count: string; total_count: string }>(
            `SELECT count(*)::TEXT AS total_count,
                    count(*) FILTER (WHERE read_at IS NULL)::TEXT AS unread_count
               FROM in_app_notifications
              WHERE recipient_user_id = $1 AND business_id = $2`,
            [userId, businessId],
        ),
    ]);
    return {
        notifications,
        unreadCount: Number(count[0]?.unread_count ?? 0),
        limit,
        offset,
        total: Number(count[0]?.total_count ?? 0),
        hasMore: offset + notifications.length < Number(count[0]?.total_count ?? 0),
    };
}

export async function getUnreadNotificationCount(
    client: PoolClient,
    userId: number,
    businessId: number,
): Promise<number> {
    const { rows } = await client.query<{ unread_count: string }>(
        `SELECT count(*)::TEXT AS unread_count
           FROM in_app_notifications
          WHERE recipient_user_id = $1 AND business_id = $2 AND read_at IS NULL`,
        [userId, businessId],
    );
    return Number(rows[0]?.unread_count ?? 0);
}

export async function getInAppNotification(
    client: PoolClient,
    userId: number,
    businessId: number,
    notificationId: number,
): Promise<InAppNotificationRow> {
    const { rows } = await client.query<InAppNotificationRow>(
        `SELECT notification_id, business_id, event_id, event_type, target_type,
                target_id, metadata, created_at, read_at
           FROM in_app_notifications
          WHERE notification_id = $1 AND recipient_user_id = $2 AND business_id = $3`,
        [notificationId, userId, businessId],
    );
    const notification = rows[0];
    if (!notification) throw notFound('Notification not found');
    return notification;
}

export async function markInAppNotificationRead(
    client: PoolClient,
    userId: number,
    businessId: number,
    notificationId: number,
): Promise<InAppNotificationRow> {
    const { rows } = await client.query<InAppNotificationRow>(
        `UPDATE in_app_notifications
            SET read_at = COALESCE(read_at, now())
          WHERE notification_id = $1 AND recipient_user_id = $2 AND business_id = $3
        RETURNING notification_id, business_id, event_id, event_type, target_type,
                  target_id, metadata, created_at, read_at`,
        [notificationId, userId, businessId],
    );
    const notification = rows[0];
    if (!notification) throw notFound('Notification not found');
    return notification;
}
