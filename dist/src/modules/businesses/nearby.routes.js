// Nearby-business search: the public "closest to me" directory query.
import { Router } from 'express';
import { badRequest } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { contextFor } from '../../middleware/auth.js';
import { pageMeta } from './public-query.js';
import { nearbyQuerySchema } from './nearby-query.js';
import { findNearby } from './nearby.repository.js';
export const nearbyRoutes = Router();
nearbyRoutes.get('/businesses/nearby', async (req, res, next) => {
    try {
        const parsed = nearbyQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        }
        const input = parsed.data;
        const { rows, total } = await withTenant(contextFor(req), (client) => findNearby(client, input));
        res.json({
            data: rows,
            meta: {
                ...pageMeta(total, input.page, input.limit),
                origin: { lat: input.lat, lng: input.lng },
                radiusKm: input.radiusKm,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=nearby.routes.js.map