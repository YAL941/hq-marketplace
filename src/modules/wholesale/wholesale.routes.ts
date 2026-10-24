import { Router } from 'express';
import { z } from 'zod';
import { conflict, forbidden, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor, optionalAuth } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import {
    applySupplier,
    createPurchaseOrder,
    createRfq,
    decideRfq,
    getSupplierStatus,
    listEvents,
    listOffers,
    listPurchaseOrders,
    listReceiptAttempts,
    listRfqs,
    listSupplierApplications,
    listSupplierOffers,
    quoteRfq,
    receivePurchaseOrder,
    reviewSupplier,
    transitionPurchaseOrder,
    upsertOffer,
    type WholesaleOfferInput,
} from './wholesale.repository.js';

const tiersSchema = z.array(z.object({
    minimumQuantity: z.number().int().positive(),
    maximumQuantity: z.number().int().positive().nullable().optional(),
    unitPrice: z.number().positive().max(99_999_999_999.99),
})).max(50).default([]);

const offerSchema = z.object({
    productId: z.number().int().positive(),
    wholesalePrice: z.number().positive().max(99_999_999_999.99),
    currency: z.string().length(3),
    minimumOrderQuantity: z.number().int().positive(),
    availableQuantity: z.number().int().nonnegative(),
    status: z.enum(['active', 'inactive']).optional(),
    tiers: tiersSchema,
});

const rfqSchema = z.object({
    supplierBusinessId: z.number().int().positive(),
    items: z.array(z.object({
        offerId: z.number().int().positive(),
        buyerProductId: z.number().int().positive(),
        quantity: z.number().int().positive(),
    })).min(1).max(100),
    deliveryLocationId: z.number().int().positive().nullable().optional(),
    deliveryAddress: z.string().trim().max(500).nullable().optional(),
    deliveryCity: z.string().trim().max(120).nullable().optional(),
    requestedDeliveryDate: z.string().date().nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
});

const quoteSchema = z.object({
    items: z.array(z.object({
        rfqItemId: z.number().int().positive(),
        unitPrice: z.number().positive().max(99_999_999_999.99),
    })).min(1).max(100),
    validUntil: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
});

const orderSchema = z.object({
    items: z.array(z.object({
        offerId: z.number().int().positive(),
        buyerProductId: z.number().int().positive(),
        quantity: z.number().int().positive(),
    })).min(1).max(100).optional(),
    rfqId: z.number().int().positive().optional(),
    deliveryLocationId: z.number().int().positive().nullable().optional(),
    deliveryAddress: z.string().trim().max(500).nullable().optional(),
    deliveryCity: z.string().trim().max(120).nullable().optional(),
    requestedDeliveryDate: z.string().date().nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => (value.rfqId != null) !== (value.items != null), {
    message: 'Provide either rfqId or offer items',
});

const receiptSchema = z.object({
    locationId: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(128),
    note: z.string().trim().max(1000).nullable().optional(),
    items: z.array(z.object({
        purchaseOrderItemId: z.number().int().positive(),
        quantity: z.number().int().positive(),
    })).min(1).max(100),
});

const reviewSupplierSchema = z.object({
    status: z.enum(['approved', 'rejected']),
    reason: z.string().trim().max(500).nullable().optional(),
});
const transitionSchema = z.object({
    status: z.enum(['confirmed', 'processing', 'shipped', 'cancelled']),
    note: z.string().trim().max(1000).nullable().optional(),
});

async function assertWholesalePermission(
    client: import('pg').PoolClient,
    businessId: number,
    permission: 'wholesale.view' | 'wholesale.manage',
): Promise<void> {
    const { rows } = await client.query<{ allowed: boolean }>(
        'SELECT (app_has_business_permission($1, $2) OR app_is_platform_admin()) AS allowed',
        [businessId, permission],
    );
    if (rows[0]?.allowed !== true) throw forbidden(`Missing permission: ${permission}`);
}

export const wholesaleRoutes: Router = Router();
const writeLimiter = rateLimiter('write');

wholesaleRoutes.get('/wholesale/offers', optionalAuth, async (req, res, next) => {
    try {
        const query = z.object({
            search: z.string().trim().max(120).optional(),
            supplierBusinessId: z.coerce.number().int().positive().optional(),
            limit: z.coerce.number().int().positive().max(100).optional(),
            offset: z.coerce.number().int().min(0).optional(),
        }).parse(req.query);
        const offers = await withTenant(contextFor(req), (client) => listOffers(client, query));
        res.json({ data: offers, meta: { count: offers.length } });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.get('/admin/wholesale/suppliers', authenticate, async (req, res, next) => {
    try {
        if (!req.user?.isPlatformAdmin) throw forbidden('Platform administration required');
        const status = z.enum(['pending', 'approved', 'rejected', 'suspended']).optional().parse(req.query['status']);
        const suppliers = await withTenant(contextFor(req), (client) => listSupplierApplications(client, status));
        res.json({ data: suppliers });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.patch('/admin/wholesale/suppliers/:businessId', authenticate, writeLimiter, async (req, res, next) => {
    try {
        if (!req.user?.isPlatformAdmin) throw forbidden('Platform administration required');
        const businessId = z.coerce.number().int().positive().parse(req.params['businessId']);
        const input = reviewSupplierSchema.parse(req.body);
        const supplier = await withTenant(contextFor(req), async (client) => {
            const { rows: allowed } = await client.query<{ allowed: boolean }>(
                `SELECT (app_has_business_permission($1, 'business.verify') OR app_is_platform_admin()) AS allowed`,
                [businessId],
            );
            if (allowed[0]?.allowed !== true) throw forbidden('Missing permission: business.verify');
            return reviewSupplier(client, businessId, req.user!.id, input.status, input.reason ?? null);
        });
        res.json({ data: supplier });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.get('/business/:businessId/wholesale', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const data = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.view');
            const { rows: permissions } = await client.query<{ can_manage_wholesale: boolean; can_manage_inventory: boolean }>(
                `SELECT (app_has_business_permission($1, 'wholesale.manage') OR app_is_platform_admin()) AS can_manage_wholesale,
                        (app_has_business_permission($1, 'inventory.manage') OR app_is_platform_admin()) AS can_manage_inventory`,
                [businessId],
            );
            const supplier = await getSupplierStatus(client, businessId);
            const offers = await listSupplierOffers(client, businessId);
            const rfqs = await listRfqs(client, businessId);
            const purchaseOrders = await listPurchaseOrders(client, businessId);
            const events = await listEvents(client, businessId);
            const { rows: stats } = await client.query(
                `SELECT count(*) FILTER (WHERE po.supplier_business_id = $1)::int AS incoming_orders,
                        count(*) FILTER (WHERE po.buyer_business_id = $1)::int AS placed_orders,
                        (SELECT COALESCE(json_object_agg(s.currency, s.amount), '{}'::json)
                           FROM (
                               SELECT currency, sum(total_amount)::TEXT AS amount
                                 FROM wholesale_purchase_orders
                                WHERE supplier_business_id = $1 AND status <> 'cancelled'
                                GROUP BY currency
                           ) s) AS supplier_sales_by_currency
                   FROM wholesale_purchase_orders po
                  WHERE po.supplier_business_id = $1 OR po.buyer_business_id = $1`,
                [businessId],
            );
            return {
                supplier, offers, rfqs, purchaseOrders, events, stats: stats[0],
                canManageWholesale: permissions[0]?.can_manage_wholesale === true,
                canManageInventory: permissions[0]?.can_manage_inventory === true,
            };
        });
        res.json({ data });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.post('/business/:businessId/wholesale/supplier-application', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const input = z.object({ description: z.string().trim().max(2000).nullable().optional() }).parse(req.body);
        const supplier = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return applySupplier(contextFor(req, businessId), client, businessId, input.description ?? null);
        });
        res.status(201).json({ data: supplier });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.post('/business/:businessId/wholesale/offers', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const input: WholesaleOfferInput = offerSchema.parse(req.body);
        const offer = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return upsertOffer(contextFor(req, businessId), client, businessId, null, input);
        });
        res.status(201).json({ data: offer });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.patch('/business/:businessId/wholesale/offers/:offerId', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const offerId = z.coerce.number().int().positive().parse(req.params['offerId']);
        const input: WholesaleOfferInput = offerSchema.parse(req.body);
        const offer = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return upsertOffer(contextFor(req, businessId), client, businessId, offerId, input);
        });
        res.json({ data: offer });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.post('/business/:businessId/wholesale/rfqs', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const input = rfqSchema.parse(req.body);
        const rfq = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return createRfq(contextFor(req, businessId), client, businessId, input);
        });
        res.status(201).json({ data: rfq });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.post('/business/:businessId/wholesale/rfqs/:rfqId/quote', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const rfqId = z.coerce.number().int().positive().parse(req.params['rfqId']);
        const input = quoteSchema.parse(req.body);
        const rfq = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return quoteRfq(contextFor(req, businessId), client, businessId, rfqId, input);
        });
        res.json({ data: rfq });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.patch('/business/:businessId/wholesale/rfqs/:rfqId', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const rfqId = z.coerce.number().int().positive().parse(req.params['rfqId']);
        const decision = z.object({ decision: z.enum(['accepted', 'rejected', 'cancelled']) }).parse(req.body);
        const rfq = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return decideRfq(contextFor(req, businessId), client, businessId, rfqId, decision.decision);
        });
        if (rfq?.status === 'expired') throw conflict('Quotation has expired');
        res.json({ data: rfq });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.post('/business/:businessId/wholesale/purchase-orders', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const input = orderSchema.parse(req.body);
        const order = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return createPurchaseOrder(contextFor(req, businessId), client, businessId, input);
        });
        res.status(201).json({ data: order });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.patch('/business/:businessId/wholesale/purchase-orders/:orderId', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const orderId = z.coerce.number().int().positive().parse(req.params['orderId']);
        const input = transitionSchema.parse(req.body);
        const order = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return transitionPurchaseOrder(
                contextFor(req, businessId), client, businessId, orderId,
                input.status, input.note ?? null,
            );
        });
        res.json({ data: order });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.post('/business/:businessId/wholesale/purchase-orders/:orderId/receipts', authenticate, resolveBusiness, writeLimiter, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const orderId = z.coerce.number().int().positive().parse(req.params['orderId']);
        const input = receiptSchema.parse(req.body);
        const receipt = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return receivePurchaseOrder(contextFor(req, businessId), client, businessId, orderId, input);
        });
        res.status(receipt.replayed ? 200 : 201).json({ data: receipt });
    } catch (error) {
        next(error);
    }
});

wholesaleRoutes.get('/business/:businessId/wholesale/purchase-orders/:orderId/receipt-attempts', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const orderId = z.coerce.number().int().positive().parse(req.params['orderId']);
        const attempts = await withTenant(contextFor(req, businessId), async (client) => {
            await assertWholesalePermission(client, businessId, 'wholesale.manage');
            return listReceiptAttempts(client, businessId, orderId);
        });
        res.json({ data: attempts });
    } catch (error) {
        next(error);
    }
});
