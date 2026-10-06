import { Router } from 'express';
import { notFound, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { listPublicBusinesses, PUBLIC_BUSINESS_PREDICATE } from '../businesses/business.repository.js';
import { businessIdParamSchema } from '../businesses/public-query.js';

export const favoriteRoutes: Router = Router();

const writeLimiter = rateLimiter('write');

favoriteRoutes.get('/favorites', authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const data = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query<{ business_id: string }>(
                'SELECT business_id FROM user_favorites ORDER BY created_at DESC',
            );
            const businessIds = rows.map((row) => row.business_id);
            if (businessIds.length === 0) return [];
            const { items } = await listPublicBusinesses(client, {
                businessIds,
                sort: 'newest',
                page: 1,
                limit: businessIds.length,
            });
            const byId = new Map(items.map((item) => [item.business_id, item]));
            return businessIds.flatMap((id) => {
                const business = byId.get(id);
                return business ? [business] : [];
            });
        });
        res.json({ data, meta: { count: data.length } });
    } catch (error) {
        next(error);
    }
});

favoriteRoutes.put('/favorites/:businessId', writeLimiter, authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = businessIdParamSchema.parse(req.params['businessId']);

        await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query<{ business_id: string }>(
                `SELECT b.business_id FROM businesses b
                  WHERE b.business_id = $1 AND ${PUBLIC_BUSINESS_PREDICATE}`,
                [businessId],
            );
            if (!rows[0]) throw notFound('Business not found');
            await client.query(
                'INSERT INTO user_favorites (user_id, business_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [req.user!.id, businessId],
            );
        });
        res.status(204).end();
    } catch (error) {
        next(error);
    }
});

favoriteRoutes.delete('/favorites/:businessId', writeLimiter, authenticate, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = businessIdParamSchema.parse(req.params['businessId']);
        await withTenant(contextFor(req), async (client) => {
            await client.query(
                'DELETE FROM user_favorites WHERE user_id = $1 AND business_id = $2',
                [req.user!.id, businessId],
            );
        });
        res.status(204).end();
    } catch (error) {
        next(error);
    }
});
