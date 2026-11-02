import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../db/errors.js';
import { withTenant, platformContext } from '../../db/tenant.js';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';

export const notificationOperationsRoutes = Router();

const outboxIdSchema = z.string().regex(/^[1-9][0-9]{0,18}$/).refine((value) => {
    try { return BigInt(value) <= 9_223_372_036_854_775_807n; } catch { return false; }
}, 'Invalid outbox id');
const reasonSchema = z.enum(['provider_corrected', 'recipient_corrected', 'manual_review', 'false_positive']);
const retentionSchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

notificationOperationsRoutes.get(
    '/admin/notifications/health', authenticate, requirePlatformAdmin, rateLimiter('public'),
    async (req, res) => {
        try {
            const { rows } = await withTenant(platformContext(req.user!.id), (client) =>
                client.query<{ health: Record<string, unknown> }>(
                    'SELECT notification_admin.health_summary() AS health',
                ));
            res.json({ database_ready: true, ...rows[0]!.health });
        } catch {
            // This endpoint is also a dependency probe; do not return driver diagnostics.
            res.status(503).json({
                database_ready: false,
                worker_liveness: 'unknown',
                smtp_configuration: 'unknown',
                delivery_ready: false,
            });
        }
    },
);

notificationOperationsRoutes.get(
    '/admin/notifications/dead-letters/:outboxId', authenticate, requirePlatformAdmin, rateLimiter('public'),
    async (req, res, next) => {
        try {
            const parsed = outboxIdSchema.safeParse(req.params['outboxId']);
            if (!parsed.success) throw badRequest('Invalid outbox id');
            const { rows } = await withTenant(platformContext(req.user!.id), (client) =>
                client.query('SELECT * FROM notification_admin.inspect_dead_letter($1)', [parsed.data]));
            if (!rows[0]) throw notFound('Dead-letter record not found');
            res.json({ data: rows[0] });
        } catch (error) { next(error); }
    },
);

notificationOperationsRoutes.post(
    '/admin/notifications/dead-letters/:outboxId/review', authenticate, requirePlatformAdmin, rateLimiter('write'),
    async (req, res, next) => {
        try {
            const id = outboxIdSchema.safeParse(req.params['outboxId']);
            const reason = reasonSchema.safeParse(req.body?.reason_code);
            if (!id.success || !reason.success) throw badRequest('Invalid dead-letter review request');
            const { rows } = await withTenant(platformContext(req.user!.id), (client) =>
                client.query<{ reviewed: boolean }>(
                    'SELECT notification_admin.review_dead_letter($1, $2) AS reviewed', [id.data, reason.data],
                ));
            if (!rows[0]?.reviewed) throw conflict('Dead-letter record is no longer reviewable');
            res.status(204).end();
        } catch (error) { next(error); }
    },
);

notificationOperationsRoutes.post(
    '/admin/notifications/dead-letters/:outboxId/retry', authenticate, requirePlatformAdmin, rateLimiter('write'),
    async (req, res, next) => {
        try {
            const id = outboxIdSchema.safeParse(req.params['outboxId']);
            const reason = reasonSchema.safeParse(req.body?.reason_code);
            if (!id.success || !reason.success) throw badRequest('Invalid dead-letter retry request');
            const { rows } = await withTenant(platformContext(req.user!.id), (client) =>
                client.query<{ retried: boolean }>(
                    'SELECT notification_admin.retry_dead_letter($1, $2) AS retried', [id.data, reason.data],
                ));
            if (!rows[0]?.retried) throw conflict('Dead-letter record must be reviewed and unleased before retry');
            res.status(202).json({ status: 'pending' });
        } catch (error) { next(error); }
    },
);

notificationOperationsRoutes.post(
    '/admin/notifications/retention/prune', authenticate, requirePlatformAdmin, rateLimiter('write'),
    async (req, res, next) => {
        try {
            const parsed = retentionSchema.safeParse(req.body ?? {});
            if (!parsed.success) throw badRequest('Invalid retention batch size');
            const { rows } = await withTenant(platformContext(req.user!.id), (client) =>
                client.query<{ deleted_count: number }>(
                    'SELECT notification_admin.prune_terminal_batch($1) AS deleted_count', [parsed.data.limit],
                ));
            // The response and corresponding audit record contain only an aggregate count.
            res.json({ deleted_count: rows[0]?.deleted_count ?? 0 });
        } catch (error) { next(error); }
    },
);
