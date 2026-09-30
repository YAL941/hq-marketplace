import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import {
    createService,
    getService,
    listPublicServices,
    listServicesForBusiness,
    updateService,
} from './service.repository.js';

const listQuerySchema = z.object({
    status: z.enum(['draft', 'active', 'inactive', 'archived']).optional(),
    serviceCategoryId: z.coerce.number().int().positive().optional(),
    search: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

const createSchema = z.object({
    serviceName: z.string().min(2).max(200),
    serviceCategoryId: z.number().int().positive().nullish(),
    locationId: z.number().int().positive().nullish(),
    description: z.string().max(5000).nullish(),
    price: z.number().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    durationMinutes: z.number().int().positive().nullish(),
    capacity: z.number().int().positive().nullish(),
    isBookable: z.boolean().optional(),
    status: z.enum(['draft', 'active', 'inactive', 'archived']).optional(),
});

export const serviceRoutes: Router = Router();

serviceRoutes.get('/business/:businessId/services', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const q = listQuerySchema.parse(req.query);
        const services = await withTenant(contextFor(req, businessId), (client) =>
            listServicesForBusiness(client, businessId, q),
        );
        res.json({ data: services, meta: { count: services.length, businessId } });
    } catch (error) {
        next(error);
    }
});

serviceRoutes.get('/business/:businessId/services/:serviceId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const serviceId = Number(req.params['serviceId']);
        const service = await withTenant(contextFor(req, businessId), (client) => getService(client, businessId, serviceId));
        res.json({ data: service });
    } catch (error) {
        next(error);
    }
});

serviceRoutes.post('/business/:businessId/services', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const input = createSchema.parse(req.body);
        const service = await withTenant(contextFor(req, businessId), (client) =>
            createService(client, businessId, input),
        );
        res.status(201).json({ data: service });
    } catch (error) {
        next(error);
    }
});

serviceRoutes.patch('/business/:businessId/services/:serviceId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const serviceId = Number(req.params['serviceId']);
        const patch = createSchema.partial().parse(req.body);
        const service = await withTenant(contextFor(req, businessId), (client) =>
            updateService(client, businessId, serviceId, patch),
        );
        if (!service) throw notFound('Service not found in this business');
        res.json({ data: service });
    } catch (error) {
        next(error);
    }
});

serviceRoutes.get('/services', async (req, res, next) => {
    try {
        const q = listQuerySchema.parse(req.query);
        const services = await withTenant(contextFor(req), (client) => listPublicServices(client, q));
        res.json({ data: services, meta: { count: services.length } });
    } catch (error) {
        next(error);
    }
});
