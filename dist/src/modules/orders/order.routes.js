import { Router } from 'express';
import { z } from 'zod';
import { notFound, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { cancelOwnOrder, createOrder, getOrderForBusiness, getOwnOrder, listOrderItems, listOrdersForBusiness, updateOrderStatus, } from './order.repository.js';
const itemSchema = z
    .object({
    productId: z.number().int().positive().optional(),
    serviceId: z.number().int().positive().optional(),
    quantity: z.number().int().positive().max(999).optional(),
})
    .refine((v) => (v.productId !== undefined) !== (v.serviceId !== undefined), {
    message: 'Provide exactly one of productId or serviceId',
});
const createOrderSchema = z.object({
    businessId: z.number().int().positive(),
    locationId: z.number().int().positive().nullish(),
    items: z.array(itemSchema).min(1).max(100),
    customerNote: z.string().max(2000).nullish(),
    deliveryAddress: z.string().max(500).nullish(),
    scheduledFor: z.string().datetime().nullish(),
    deliveryRequested: z.boolean().optional(),
    locationConsent: z.boolean().optional(),
    deliveryLatitude: z.number().min(-90).max(90).nullish(),
    deliveryLongitude: z.number().min(-180).max(180).nullish(),
    deliveryNote: z.string().trim().max(500).nullish(),
    customerPhone: z.string().trim().max(20).nullish(),
    paymentMethod: z.literal('cash_on_delivery').optional(),
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
orderRoutes.post('/orders', (req, _res, next) => {
    if (req.app.get('ordersEnabled') !== true) {
        next(notFound('Route not found'));
        return;
    }
    next();
}, writeLimiter, authenticate, async (req, res, next) => {
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
            const { rows } = await client.query(`SELECT o.order_id, o.order_number, o.business_id, b.business_name, b.business_slug, o.order_type,
                        o.order_status, o.total_amount, o.currency, o.created_at,
                        o.delivery_requested, o.delivery_note, o.delivery_latitude,
                        o.delivery_longitude, o.customer_phone, o.delivery_confirmation_code,
                        COALESCE(order_lines.items, '[]'::json) AS items
                   FROM orders o
                   JOIN businesses b ON b.business_id = o.business_id
                   LEFT JOIN LATERAL (
                       SELECT json_agg(json_build_object(
                           'order_item_id', oi.order_item_id,
                           'product_id', oi.product_id,
                           'service_id', oi.service_id,
                           'item_type', oi.item_type,
                           'item_name', oi.item_name,
                           'quantity', oi.quantity,
                           'unit_price', oi.unit_price,
                           'total_price', oi.total_price,
                           'notes', oi.notes,
                           'image_url', p.image_url,
                           'ingredients', p.ingredients
                       ) ORDER BY oi.order_item_id) AS items
                         FROM order_items oi
                         LEFT JOIN products p ON p.product_id = oi.product_id
                        WHERE oi.order_id = o.order_id
                   ) order_lines ON TRUE
                  WHERE o.customer_id = $1
                  ORDER BY o.created_at DESC, o.order_id DESC
                  LIMIT 100`, [req.user.id]);
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
        res.json({
            data: orders.map(({ delivery_confirmation_code: _code, delivery_earning_amount: _earning, ...order }) => order),
            meta: { count: orders.length, businessId },
        });
    }
    catch (error) {
        next(error);
    }
});
orderRoutes.get('/business/:businessId/inbox-counts', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user)
            throw unauthorized();
        const businessId = req.businessId;
        const counts = await withTenant(contextFor(req, businessId), async (client) => {
            const { rows } = await client.query(`SELECT
                    (SELECT count(*)::int FROM orders
                      WHERE business_id = $1 AND order_status = 'pending') AS pending_orders,
                    (SELECT count(*)::int FROM reviews
                      WHERE business_id = $1 AND status = 'pending')
                    +
                    (SELECT count(*)::int FROM product_reviews
                      WHERE business_id = $1 AND status = 'pending') AS pending_reviews`, [businessId]);
            return rows[0];
        });
        res.json({ data: counts });
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
        const { delivery_confirmation_code: _code, delivery_earning_amount: _earning, ...businessOrder } = payload.order;
        res.json({ data: { order: businessOrder, items: payload.items } });
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
        const { delivery_confirmation_code: _code, delivery_earning_amount: _earning, ...businessOrder } = order;
        res.json({ data: businessOrder });
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=order.routes.js.map