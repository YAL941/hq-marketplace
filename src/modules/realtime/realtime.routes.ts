import { Router } from 'express';
import { randomUUID } from 'crypto';
import { forbidden } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { realtimeService } from './realtime.service.js';

const realtimeRoutes = Router();

realtimeRoutes.get('/business/:businessId/notifications/stream', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const userId = req.user!.id;

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
        };

        realtimeService.addClient(client);

        // Send initial ping
        res.write(`id: ${Date.now()}\nevent: ping\ndata: {"connected":true}\n\n`);

        // Keep-alive ping every 30 seconds
        const pingInterval = setInterval(() => {
            try {
                res.write(`id: ${Date.now()}\nevent: ping\ndata: {}\n\n`);
            } catch {
                clearInterval(pingInterval);
                realtimeService.removeClient(clientId);
            }
        }, 30000);

        // Handle client disconnect
        req.on('close', () => {
            clearInterval(pingInterval);
            realtimeService.removeClient(clientId);
        });

        req.on('aborted', () => {
            clearInterval(pingInterval);
            realtimeService.removeClient(clientId);
        });
    } catch (error) {
        next(error);
    }
});

export { realtimeRoutes };
