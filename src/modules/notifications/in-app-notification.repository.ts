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

export interface BusinessApprovalNotificationRow {
    notification_id: string;
    business_id: string;
    recipient_user_id: string;
    business_slug: string;
    created_at: Date;
    read_at: Date | null;
}

export async function createBusinessApprovalNotifications(
    client: PoolClient,
    businessId: number | string,
    approvedAt: Date,
): Promise<void> {
    const { rows } = await client.query<{ recipient_type: string | null; has_approved_at: boolean }>(
        `SELECT
             (SELECT format_type(atttypid, atttypmod)
                FROM pg_attribute
               WHERE attrelid = 'business_approval_notifications'::regclass
                 AND attname = 'recipient_user_id'
                 AND NOT attisdropped) AS recipient_type,
             EXISTS (
                 SELECT 1
                   FROM pg_attribute
                  WHERE attrelid = 'business_approval_notifications'::regclass
                    AND attname = 'approved_at'
                    AND NOT attisdropped
             ) AS has_approved_at`,
    );
    const recipientType = rows[0]?.recipient_type;
    if (recipientType === 'bigint') {
        const approvedAtColumn = rows[0]?.has_approved_at ? ', approved_at' : '';
        const approvedAtValue = rows[0]?.has_approved_at ? ', $2' : '';
        const params = rows[0]?.has_approved_at ? [businessId, approvedAt] : [businessId];
        await client.query(
            `INSERT INTO business_approval_notifications (
                business_id, recipient_user_id, recipient_app_user_id${approvedAtColumn}
             )
             SELECT $1, bu.user_id, bu.user_id${approvedAtValue}
               FROM business_users bu
               JOIN users u ON u.user_id = bu.user_id AND u.status = 'active'
               JOIN roles r ON r.role_id = bu.role_id
              WHERE bu.business_id = $1
                AND bu.status = 'active'
                AND r.scope = 'business'
                AND r.role_key = 'business_owner'
                AND r.is_active
                AND NOT EXISTS (
                    SELECT 1
                      FROM business_approval_notifications existing
                     WHERE existing.business_id = $1
                       AND existing.recipient_app_user_id = bu.user_id
                )
             ON CONFLICT DO NOTHING`,
            params,
        );
        return;
    }

    if (recipientType !== 'uuid') {
        throw new Error(`Unsupported approval notification recipient_user_id type: ${recipientType ?? 'missing'}`);
    }

    const approvedAtColumn = rows[0]?.has_approved_at ? ', approved_at' : '';
    const approvedAtValue = rows[0]?.has_approved_at ? ', $2' : '';
    const params = rows[0]?.has_approved_at ? [businessId, approvedAt] : [businessId];
    await client.query(
        `INSERT INTO business_approval_notifications (business_id, recipient_app_user_id${approvedAtColumn})
         SELECT $1, bu.user_id${approvedAtValue}
           FROM business_users bu
           JOIN users u ON u.user_id = bu.user_id AND u.status = 'active'
           JOIN roles r ON r.role_id = bu.role_id
          WHERE bu.business_id = $1
            AND bu.status = 'active'
            AND r.scope = 'business'
            AND r.role_key = 'business_owner'
            AND r.is_active
            AND NOT EXISTS (
                SELECT 1
                  FROM business_approval_notifications existing
                 WHERE existing.business_id = $1
                   AND existing.recipient_app_user_id = bu.user_id
            )
         ON CONFLICT DO NOTHING`,
        params,
    );
}

export async function listBusinessApprovalNotifications(
    client: PoolClient,
    userId: number,
    businessId: number,
    limit: number,
    offset: number,
) {
    const [{ rows: notifications }, { rows: count }] = await Promise.all([
        client.query<BusinessApprovalNotificationRow>(
            `SELECT n.notification_id, n.business_id,
                    n.recipient_app_user_id AS recipient_user_id, b.business_slug,
                    n.created_at, n.read_at
               FROM business_approval_notifications n
               JOIN businesses b ON b.business_id = n.business_id
              WHERE n.recipient_app_user_id = $1 AND n.business_id = $2
              ORDER BY n.created_at DESC, n.notification_id DESC
              LIMIT $3 OFFSET $4`,
            [userId, businessId, limit, offset],
        ),
        client.query<{ unread_count: string; total_count: string }>(
            `SELECT count(*)::TEXT AS total_count,
                    count(*) FILTER (WHERE read_at IS NULL)::TEXT AS unread_count
               FROM business_approval_notifications
              WHERE recipient_app_user_id = $1 AND business_id = $2`,
            [userId, businessId],
        ),
    ]);
    const total = Number(count[0]?.total_count ?? 0);
    return {
        notifications,
        unreadCount: Number(count[0]?.unread_count ?? 0),
        limit,
        offset,
        total,
        hasMore: offset + notifications.length < total,
    };
}

export async function markBusinessApprovalNotificationRead(
    client: PoolClient,
    userId: number,
    businessId: number,
    notificationId: number,
): Promise<BusinessApprovalNotificationRow> {
    const { rows } = await client.query<BusinessApprovalNotificationRow>(
        `UPDATE business_approval_notifications
            SET read_at = COALESCE(read_at, now())
          WHERE notification_id = $1 AND recipient_app_user_id = $2 AND business_id = $3
        RETURNING notification_id, business_id, recipient_app_user_id AS recipient_user_id, created_at, read_at`,
        [notificationId, userId, businessId],
    );
    const notification = rows[0];
    if (!notification) throw notFound('Notification not found');
    const { rows: businesses } = await client.query<{ business_slug: string }>(
        'SELECT business_slug FROM businesses WHERE business_id = $1',
        [businessId],
    );
    return { ...notification, business_slug: businesses[0]!.business_slug };
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
