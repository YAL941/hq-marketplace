import { Router } from 'express';
import { z } from 'zod';
import { forbidden } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import {
    listBusinessApprovalNotifications,
    getInAppNotification,
    getUnreadNotificationCount,
    listInAppNotifications,
    markInAppNotificationRead,
    markBusinessApprovalNotificationRead,
} from './in-app-notification.repository.js';

const notificationRoutes = Router();

notificationRoutes.get('/business/:businessId/approval-notifications', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const pagination = z.object({
            limit: z.coerce.number().int().positive().max(100).default(20),
            offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        }).parse(req.query);
        const result = await withTenant(contextFor(req, businessId), (client) =>
            listBusinessApprovalNotifications(client, req.user!.id, businessId, pagination.limit, pagination.offset),
        );
        res.json({ data: result });
    } catch (error) {
        next(error);
    }
});

notificationRoutes.patch('/business/:businessId/approval-notifications/:notificationId/read', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const notificationId = z.coerce.number().int().positive().parse(req.params['notificationId']);
        const notification = await withTenant(contextFor(req, businessId), (client) =>
            markBusinessApprovalNotificationRead(client, req.user!.id, businessId, notificationId),
        );
        res.json({ data: notification });
    } catch (error) {
        next(error);
    }
});

async function assertNotificationAccess(
    client: import('pg').PoolClient,
    businessId: number,
): Promise<void> {
    const { rows } = await client.query<{ allowed: boolean }>(
        `SELECT app_has_business_permission($1, 'wholesale.view') AS allowed`,
        [businessId],
    );
    if (rows[0]?.allowed !== true) throw forbidden('Missing permission: wholesale.view');
}

notificationRoutes.get('/business/:businessId/notifications', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const pagination = z.object({
            limit: z.coerce.number().int().positive().max(100).default(20),
            offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        }).parse(req.query);
        const result = await withTenant(contextFor(req, businessId), async (client) => {
            await assertNotificationAccess(client, businessId);
            return listInAppNotifications(client, req.user!.id, businessId, pagination.limit, pagination.offset);
        });
        res.json({ data: result });
    } catch (error) {
        next(error);
    }
});

notificationRoutes.get('/business/:businessId/notifications/unread-count', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const unreadCount = await withTenant(contextFor(req, businessId), async (client) => {
            await assertNotificationAccess(client, businessId);
            return getUnreadNotificationCount(client, req.user!.id, businessId);
        });
        res.json({ data: { unreadCount } });
    } catch (error) {
        next(error);
    }
});

notificationRoutes.get('/business/:businessId/notifications/:notificationId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const notificationId = z.coerce.number().int().positive().parse(req.params['notificationId']);
        const notification = await withTenant(contextFor(req, businessId), async (client) => {
            await assertNotificationAccess(client, businessId);
            return getInAppNotification(client, req.user!.id, businessId, notificationId);
        });
        res.json({ data: notification });
    } catch (error) {
        next(error);
    }
});

notificationRoutes.patch('/business/:businessId/notifications/:notificationId/read', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const notificationId = z.coerce.number().int().positive().parse(req.params['notificationId']);
        const notification = await withTenant(contextFor(req, businessId), async (client) => {
            await assertNotificationAccess(client, businessId);
            return markInAppNotificationRead(client, req.user!.id, businessId, notificationId);
        });
        res.json({ data: notification });
    } catch (error) {
        next(error);
    }
});

export { notificationRoutes as inAppNotificationRoutes };
