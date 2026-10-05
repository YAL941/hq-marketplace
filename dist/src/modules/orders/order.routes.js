import { Router } from 'express';
import { z } from 'zod';
import { unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { cancelOwnOrder, createOrder, getOrderForBusiness, getOwnOrder, listOrderItems, listOrdersForBusiness, updateOrderStatus, } from './order.repository.js';
const itemSchema = z
    .object({
    productId: z.number().int().positive().optional(),
    serviceId: z.number().int().positive().optional(),
    quantity: z.number().positive().max(999).optional(),
})
    .refine((v) => (v.productId !== undefined) !== (v.serviceId !== undefined), {
    message: 'Provide exactly one of productId or serviceId',
});
const createOrderSchema = z.object({
    businessId: z.number().int().positive(),
    locationId: z.number().int().positive().nullish(),
    items: z.array(itemSchema).min(1).max(100),
    deliveryFee: z.number().nonnegative().optional(),
    discountAmount: z.number().nonnegative().optional(),
    taxAmount: z.number().nonnegative().optional(),
    currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
    customerNote: z.string().max(2000).nullish(),
    deliveryAddress: z.string().max(500).nullish(),
    scheduledFor: z.string().datetime().nullish(),
});
const listQuerySchema = z.object({
    orderStatus: z
        .enum(['pending', 'confirmed', 'in_progress', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'rejected', 'refunded'])
        .optional(),
    customerId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});
export const orderRoutes = Router();
const writeLimiter = rateLimiter('write');
/** Customer places an order against a specific business. */
orderRoutes.post('/orders', writeLimiter, authenticate, async (req, res, next) => {
    try {
        const input = createOrderSchema.parse(req.body);
        const ctx = contextFor(req);
        const order = await withTenant(ctx, (client) => createOrder(client, req.user.id, input));
        res.status(201).json({ data: order });
    }
    catch (error) {
        next(error);
    }
});
/** Customer reads and cancels their own orders. */
orderRoutes.get('/orders/mine', authenticate, async (req, res, next) => {
    try {
        const orders = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query(`SELECT order_id, order_number, business_id, order_status, total_amount, currency, created_at
                   FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
            return rows;
        });
        res.json({ data: orders, meta: { count: orders.length } });
    }
    catch (error) {
        next(error);
    }
});
orderRoutes.get('/orders/mine/:orderId', authenticate, async (req, res, next) => {
    try {
        const orderId = Number(req.params['orderId']);
        const payload = await withTenant(contextFor(req), async (client) => {
            const order = await getOwnOrder(client, req.user.id, orderId);
            const items = await listOrderItems(client, orderId);
            return { order, items };
        });
        res.json({ data: payload });
    }
    catch (error) {
        next(error);
    }
});
orderRoutes.post('/orders/mine/:orderId/cancel', writeLimiter, authenticate, async (req, res, next) => {
    try {
        const orderId = Number(req.params['orderId']);
        const reason = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {}).reason;
        const order = await withTenant(contextFor(req), (client) => cancelOwnOrder(client, req.user.id, orderId, reason));
        res.json({ data: order });
    }
    catch (error) {
        next(error);
    }
});
/** Business staff endpoints: only their own orders are reachable. */
orderRoutes.get('/business/:businessId/orders', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user)
            throw unauthorized();
        const businessId = req.businessId;
        const q = listQuerySchema.parse(req.query);
        const orders = await withTenant(contextFor(req, businessId), (client) => listOrdersForBusiness(client, businessId, q));
        res.json({ data: orders, meta: { count: orders.length, businessId } });
    }
    catch (error) {
        next(error);
    }
});
orderRoutes.get('/business/:businessId/orders/:orderId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user)
            throw unauthorized();
        const businessId = req.businessId;
        const orderId = Number(req.params['orderId']);
        const payload = await withTenant(contextFor(req, businessId), async (client) => {
            const order = await getOrderForBusiness(client, businessId, orderId);
            const items = await listOrderItems(client, orderId);
            return { order, items };
        });
        res.json({ data: payload });
    }
    catch (error) {
        next(error);
    }
});
orderRoutes.patch('/business/:businessId/orders/:orderId/status', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user)
            throw unauthorized();
        const businessId = req.businessId;
        const orderId = Number(req.params['orderId']);
        const { orderStatus } = z
            .object({
            orderStatus: z.enum([
                'confirmed',
                'in_progress',
                'ready',
                'out_for_delivery',
                'completed',
                'cancelled',
                'rejected',
            ]),
        })
            .parse(req.body);
        const order = await withTenant(contextFor(req, businessId), (client) => updateOrderStatus(client, businessId, orderId, orderStatus));
        res.json({ data: order });
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=order.routes.js.map