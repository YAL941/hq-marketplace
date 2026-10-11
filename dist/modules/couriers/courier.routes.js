import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { badRequest, conflict, notFound, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { normalisePhone, PhoneValidationError } from '../auth/phone.js';
import { assertPermission } from '../services/service.repository.js';
export const courierRoutes = Router();
const manageCouriers = rateLimiter('write');
const courierAccess = rateLimiter('write');
const idSchema = z.string().regex(/^[1-9]\d*$/);
const createCourierSchema = z.object({
    fullName: z.string().trim().min(2).max(200),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(30).optional().or(z.literal('')),
    password: z.string().min(8).max(128),
});
courierRoutes.get('/business/:businessId/couriers', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId;
        const couriers = await withTenant(contextFor(req, businessId), async (client) => {
            await assertPermission(client, businessId, 'employees.manage');
            const { rows } = await client.query(`SELECT bc.business_courier_id, bc.user_id, bc.active, bc.created_at,
                        u.full_name, u.email, u.phone
                   FROM business_couriers bc
                   JOIN users u ON u.user_id = bc.user_id
                  WHERE bc.business_id = $1
                  ORDER BY bc.created_at DESC`, [businessId]);
            return rows;
        });
        res.json({ data: couriers });
    }
    catch (error) {
        next(error);
    }
});
courierRoutes.post('/business/:businessId/couriers', manageCouriers, authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const businessId = req.businessId;
        const input = createCourierSchema.parse(req.body);
        let phone = null;
        if (input.phone) {
            try {
                phone = normalisePhone(input.phone);
            }
            catch (error) {
                if (error instanceof PhoneValidationError) {
                    throw badRequest(error.message, { field: 'phone', reason: error.reason });
                }
                throw error;
            }
        }
        const email = input.email.toLowerCase();
        const passwordHash = await bcrypt.hash(input.password, 12);
        const courier = await withTenant(contextFor(req, businessId), async (client) => {
            await assertPermission(client, businessId, 'employees.manage');
            await client.query('SELECT set_config($1, $2, true)', ['app.registering_email', email]);
            await client.query('SELECT set_config($1, $2, true)', ['app.registering_phone', phone ?? '']);
            const { rows: userRows } = await client.query(`INSERT INTO users (email, phone, password_hash, full_name, status)
                 VALUES ($1, $2, $3, $4, 'active')
                 RETURNING user_id, full_name, email, phone`, [email, phone, passwordHash, input.fullName]);
            const user = userRows[0];
            const { rows } = await client.query(`INSERT INTO business_couriers (business_id, user_id, created_by)
                 VALUES ($1, $2, $3)
                 RETURNING business_courier_id, user_id, active, created_at`, [businessId, user.user_id, userId]);
            return { ...rows[0], full_name: user.full_name, email: user.email, phone: user.phone };
        });
        res.status(201).json({ data: courier });
    }
    catch (error) {
        next(error);
    }
});
courierRoutes.patch('/business/:businessId/couriers/:courierId', manageCouriers, authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId;
        const courierId = idSchema.parse(req.params['courierId']);
        const { active } = z.object({ active: z.boolean() }).parse(req.body);
        const courier = await withTenant(contextFor(req, businessId), async (client) => {
            await assertPermission(client, businessId, 'employees.manage');
            const { rows } = await client.query(`UPDATE business_couriers
                    SET active = $3
                  WHERE business_id = $1 AND business_courier_id = $2
                  RETURNING business_courier_id, user_id, active`, [businessId, courierId, active]);
            if (!rows[0])
                throw notFound('Courier account not found');
            return rows[0];
        });
        res.json({ data: courier });
    }
    catch (error) {
        next(error);
    }
});
/**
 * The unassigned projection deliberately excludes customer coordinates,
 * address notes, phone, and identity. Those are only returned for an active
 * delivery assigned to this account.
 */
courierRoutes.get('/courier/deliveries', authenticate, async (req, res, next) => {
    try {
        if (!req.user)
            throw unauthorized();
        const completedAfter = z.string().datetime().parse(req.query['completedAfter']);
        const courierUserId = req.user.id;
        const payload = await withTenant(contextFor(req), async (client) => {
            const { rows: available } = await client.query(`SELECT o.order_id, o.order_number, o.business_id, b.business_name, b.city,
                        o.delivery_fee, o.currency, o.created_at
                   FROM orders o
                   JOIN business_couriers bc ON bc.business_id = o.business_id
                   JOIN businesses b ON b.business_id = o.business_id
                  WHERE bc.user_id = $1 AND bc.active
                    AND o.order_status = 'ready'
                    AND o.delivery_requested
                    AND o.delivery_status = 'waiting'
                    AND o.delivery_courier_id IS NULL
                  ORDER BY o.created_at`, [courierUserId]);
            const { rows: assigned } = await client.query(`SELECT o.order_id, o.order_number, o.business_id, b.business_name, b.city,
                        b.address AS pickup_address, b.phone AS business_phone,
                        b.whatsapp_number AS business_whatsapp, o.delivery_fee, o.currency,
                        o.delivery_earning_amount,
                        o.order_status, o.delivery_status, o.delivery_status_history,
                        o.delivery_latitude, o.delivery_longitude, o.delivery_note,
                        o.customer_phone, o.created_at
                   FROM orders o
                   JOIN businesses b ON b.business_id = o.business_id
                  WHERE o.delivery_courier_id = $1
                    AND o.delivery_status IN ('assigned', 'picked_up', 'on_the_way')
                  ORDER BY o.created_at`, [courierUserId]);
            const { rows: completedToday } = await client.query(`SELECT o.order_id, o.order_number, o.business_id, b.business_name,
                        o.delivery_earning_amount, o.currency, o.completed_at
                   FROM orders o
                   JOIN businesses b ON b.business_id = o.business_id
                  WHERE o.delivery_courier_id = $1
                    AND o.delivery_status = 'delivered'
                    AND o.completed_at >= $2::timestamptz
                  ORDER BY o.completed_at DESC`, [courierUserId, completedAfter]);
            const { rows: dailyEarnings } = await client.query(`SELECT currency, COALESCE(SUM(delivery_earning_amount), 0)::numeric(14, 2)::text AS amount
                   FROM orders
                  WHERE delivery_courier_id = $1
                    AND delivery_status = 'delivered'
                    AND completed_at >= $2::timestamptz
                  GROUP BY currency
                  ORDER BY currency`, [courierUserId, completedAfter]);
            return { available, assigned, completedToday, dailyEarnings };
        });
        res.json({ data: payload });
    }
    catch (error) {
        next(error);
    }
});
courierRoutes.post('/courier/deliveries/:orderId/claim', courierAccess, authenticate, async (req, res, next) => {
    try {
        if (!req.user)
            throw unauthorized();
        const courierUserId = req.user.id;
        const orderId = idSchema.parse(req.params['orderId']);
        const { proposedEarningAmount } = z.object({
            proposedEarningAmount: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/)
                .refine((amount) => Number(amount) > 0 && Number(amount) <= 100000, 'Enter an amount above zero'),
        }).parse(req.body);
        const confirmationCode = String(randomInt(1000, 10_000));
        const order = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query(`UPDATE orders o
                    SET delivery_courier_id = $2,
                        delivery_status = 'assigned',
                        delivery_confirmation_code = $3,
                        delivery_earning_amount = $4
                  WHERE o.order_id = $1
                    AND o.order_status = 'ready'
                    AND o.delivery_requested
                    AND o.location_consent
                    AND o.delivery_latitude IS NOT NULL
                    AND o.delivery_status = 'waiting'
                    AND o.delivery_courier_id IS NULL
                    AND EXISTS (
                        SELECT 1 FROM business_couriers bc
                         WHERE bc.business_id = o.business_id
                           AND bc.user_id = $2
                           AND bc.active
                    )
                  RETURNING o.order_id, o.delivery_status`, [orderId, courierUserId, confirmationCode, proposedEarningAmount]);
            if (!rows[0])
                throw conflict('This delivery is no longer available to your account');
            return rows[0];
        });
        res.json({ data: order });
    }
    catch (error) {
        next(error);
    }
});
courierRoutes.patch('/courier/deliveries/:orderId/status', courierAccess, authenticate, async (req, res, next) => {
    try {
        if (!req.user)
            throw unauthorized();
        const orderId = idSchema.parse(req.params['orderId']);
        const { deliveryStatus, confirmationCode } = z.object({
            deliveryStatus: z.enum(['picked_up', 'on_the_way', 'delivered']),
            confirmationCode: z.string().regex(/^\d{4}$/).optional(),
        }).parse(req.body);
        if (deliveryStatus === 'delivered' && !confirmationCode) {
            throw badRequest('The customer delivery confirmation code is required', { field: 'confirmationCode' });
        }
        const courierUserId = req.user.id;
        const order = await withTenant(contextFor(req), async (client) => {
            const expected = {
                picked_up: 'assigned',
                on_the_way: 'picked_up',
                delivered: 'on_the_way',
            }[deliveryStatus];
            const { rows } = await client.query(`UPDATE orders
                    SET delivery_status = $3,
                        order_status = CASE
                            WHEN $3 = 'picked_up' THEN 'out_for_delivery'::order_status
                            WHEN $3 = 'delivered' THEN 'completed'::order_status
                            ELSE order_status
                        END,
                        completed_at = CASE WHEN $3 = 'delivered' THEN now() ELSE completed_at END,
                        delivery_confirmation_code = CASE WHEN $3 = 'delivered' THEN NULL ELSE delivery_confirmation_code END
                  WHERE order_id = $1
                    AND delivery_courier_id = $2
                    AND delivery_status = $4
                    AND ($3 <> 'delivered' OR delivery_confirmation_code = $5)
                    AND (
                        ($3 = 'picked_up' AND order_status = 'ready')
                        OR ($3 = 'on_the_way' AND order_status = 'out_for_delivery')
                        OR ($3 = 'delivered' AND order_status = 'out_for_delivery')
                    )
                  RETURNING order_id, order_status, delivery_status, delivery_status_history`, [orderId, courierUserId, deliveryStatus, expected, confirmationCode ?? null]);
            if (!rows[0])
                throw conflict('Delivery status changed or this delivery is not assigned to you');
            return rows[0];
        });
        res.json({ data: order });
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=courier.routes.js.map