import { Router } from 'express';
import { randomUUID } from 'crypto';
import { forbidden } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { realtimeService } from './realtime.service.js';

const realtimeRoutes = Router();
const MAX_REPLAY_EVENTS = 500;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

interface ReplayNotificationRow {
    notification_id: string;
    event_type: string;
    target_type: string;
    target_id: string;
    metadata: Record<string, unknown>;
}

function parseLastEventId(value: string | null): string | null {
    if (!value || !/^\d+$/.test(value)) return null;
    try {
        const id = BigInt(value);
        return id > 0n && id <= MAX_POSTGRES_BIGINT ? id.toString() : null;
    } catch {
        return null;
    }
}

realtimeRoutes.get('/business/:businessId/notifications/stream', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const userId = req.user!.id;
        const rawLastEventId = req.header('last-event-id')
            ?? (typeof req.query.lastEventId === 'string' ? req.query.lastEventId : null);
        const lastEventId = parseLastEventId(rawLastEventId);

        // Enforce authorization - user must have wholesale.view permission
        const { rows: permRows } = await withTenant(contextFor(req, businessId), async (client) => {
            const { rows } = await client.query<{ allowed: boolean }>(
                `SELECT app_has_business_permission($1, 'wholesale.view') AS allowed`,
                [businessId],
            );
            return { rows };
        });

        if (permRows[0]?.allowed !== true) {
            throw forbidden('Missing permission: wholesale.view');
        }

        // Set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const clientId = randomUUID();
        const client = {
            id: clientId,
            userId,
            businessId,
            res,
            catchingUp: lastEventId !== null,
            queuedEvents: [],
            sentNotificationIds: new Set<string>(),
        };

        realtimeService.addClient(client);
        realtimeService.sendControlEvent(clientId, 'ping', { connected: true });

        const pingInterval = setInterval(() => {
            realtimeService.sendControlEvent(clientId, 'ping', {});
        }, 15000);
        const removeClient = () => {
            clearInterval(pingInterval);
            realtimeService.removeClient(clientId);
        };
        req.on('close', removeClient);
        req.on('aborted', removeClient);

        if (lastEventId !== null) {
            try {
                const notifications = await withTenant(contextFor(req, businessId), async (tenantClient) => {
                    const { rows } = await tenantClient.query<ReplayNotificationRow>(
                        `SELECT notification_id::TEXT, event_type, target_type, target_id::TEXT, metadata
                           FROM in_app_notifications
                          WHERE recipient_user_id = $1
                            AND business_id = $2
                            AND notification_id > $3::BIGINT
                          ORDER BY notification_id ASC
                          LIMIT $4`,
                        [userId, businessId, lastEventId, MAX_REPLAY_EVENTS + 1],
                    );
                    return rows;
                });

                if (notifications.length > MAX_REPLAY_EVENTS) {
                    realtimeService.sendControlEvent(clientId, 'notifications.reset', {
                        reason: 'replay_limit_exceeded',
                    });
                } else {
                    for (const notification of notifications) {
                        realtimeService.sendReplayEvent(clientId, {
                            type: 'notification',
                            businessId,
                            userId,
                            id: notification.notification_id,
                            data: {
                                eventType: notification.event_type,
                                targetType: notification.target_type,
                                targetId: Number(notification.target_id),
                                metadata: notification.metadata,
                            },
                        });
                    }
                }
            } catch (error) {
                console.error('[hq] realtime notification replay failed', error);
                realtimeService.sendControlEvent(clientId, 'notifications.reset', {
                    reason: 'replay_failed',
                });
            } finally {
                realtimeService.finishCatchUp(clientId);
            }
        }
    } catch (error) {
        next(error);
    }
});

export { realtimeRoutes };
