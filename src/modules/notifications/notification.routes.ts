/**
 * In-app notifications for the signed-in user.
 *
 * What exists here is deliberately the read/mark side only. Creation is
 * not an HTTP concern: the order_status trigger in migration 014 owns
 * it, so every writer that changes an order status produces the
 * notification, including future payment code nobody has written yet.
 *
 * Visibility is answered by RLS alone: every query below has no
 * user_id predicate, because the owner-access policy is the filter.
 * That is the same shape as user_favorites, restated for notifications.
 */

import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';

export interface NotificationRow {
    notification_id: number;
    notification_type: string;
    payload: Record<string, unknown>;
    related_order_id: number | null;
    is_read: boolean;
    read_at: Date | null;
    created_at: Date;
}

const listQuerySchema = z
    .object({
        unreadOnly: z
            .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
            .optional()
            .transform((v) => v === 'true' || v === '1'),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        offset: z.coerce.number().int().min(0).default(0),
    })
    .strict();

export const notificationRoutes: Router = Router();

/** Lists the user's notifications, newest first. */
notificationRoutes.get('/notifications', authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw badRequest('Authentication required');
        const q = listQuerySchema.parse(req.query);
        const data = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query<NotificationRow>(
                `SELECT notification_id, notification_type, payload, related_order_id, is_read, read_at, created_at
                   FROM user_notifications
                  WHERE ($1::boolean = FALSE OR is_read = FALSE)
                  ORDER BY created_at DESC
                  LIMIT $2 OFFSET $3`,
                [q.unreadOnly, q.limit, q.offset],
            );
            const { rows: unread } = await client.query<{ count: string }>(
                'SELECT COUNT(*) AS count FROM user_notifications WHERE is_read = FALSE',
            );
            return { rows, unreadCount: Number(unread[0]?.count ?? 0) };
        });
        res.json({
            data: data.rows,
            meta: { count: data.rows.length, unreadCount: data.unreadCount, limit: q.limit, offset: q.offset },
        });
    } catch (error) {
        next(error);
    }
});

/** Marks one notification read. Idempotent: re-reading sets read_at once. */
notificationRoutes.patch('/notifications/:notificationId/read', authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw badRequest('Authentication required');
        const id = z.coerce.number().int().positive().parse(req.params['notificationId']);
        const row = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query<NotificationRow>(
                `UPDATE user_notifications
                    SET is_read = TRUE, read_at = COALESCE(read_at, now())
                  WHERE notification_id = $1
                  RETURNING notification_id, notification_type, payload, related_order_id, is_read, read_at, created_at`,
                [id],
            );
            if (!rows[0]) throw notFound('Notification not found');
            return rows[0];
        });
        res.json({ data: row });
    } catch (error) {
        next(error);
    }
});

/** Marks everything read. Returns how many rows the caller actually owned. */
notificationRoutes.post('/notifications/read-all', authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw badRequest('Authentication required');
        const result = await withTenant(contextFor(req), async (client) => {
            const { rowCount } = await client.query(
                `UPDATE user_notifications
                    SET is_read = TRUE, read_at = COALESCE(read_at, now())
                  WHERE is_read = FALSE`,
            );
            return rowCount ?? 0;
        });
        res.json({ data: { updated: result } });
    } catch (error) {
        next(error);
    }
});
