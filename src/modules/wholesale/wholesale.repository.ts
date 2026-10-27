import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { badRequest, conflict, forbidden, notFound } from '../../db/errors.js';
import type { TenantContext } from '../../db/tenant.js';
import { realtimeService } from '../realtime/realtime.service.js';
import {
    assertInventoryPermission,
    createStockMovement,
    validateInventoryLocation,
} from '../inventory/inventory.repository.js';

export type WholesaleOfferStatus = 'active' | 'inactive';
export type WholesaleRfqStatus = 'pending' | 'quoted' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
export type WholesaleOrderStatus =
    | 'pending_confirmation' | 'confirmed' | 'processing' | 'shipped'
    | 'partially_delivered' | 'delivered' | 'cancelled';

export interface WholesaleTierInput {
    minimumQuantity: number;
    maximumQuantity?: number | null;
    unitPrice: number;
}

function isCurrencyAmount(value: number): boolean {
    return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

export interface WholesaleOfferInput {
    productId: number;
    wholesalePrice: number;
    currency: string;
    minimumOrderQuantity: number;
    availableQuantity: number;
    status?: WholesaleOfferStatus;
    tiers: WholesaleTierInput[];
}

function validateTiers(minimumOrderQuantity: number, tiers: WholesaleTierInput[]): void {
    if (tiers.length > 50) throw badRequest('An offer can have at most 50 pricing tiers');
    let previousMaximum: number | null = null;
    for (const tier of tiers) {
        if (!Number.isSafeInteger(tier.minimumQuantity) || tier.minimumQuantity < minimumOrderQuantity) {
            throw badRequest('Each tier minimum must be a whole number at or above the offer MOQ');
        }
        if (!isCurrencyAmount(tier.unitPrice) || tier.unitPrice <= 0 || tier.unitPrice > 99_999_999_999.99) {
            throw badRequest('Tier prices must be positive and within the supported range');
        }
        if (tier.maximumQuantity != null
            && (!Number.isSafeInteger(tier.maximumQuantity) || tier.maximumQuantity < tier.minimumQuantity)) {
            throw badRequest('Tier maximum must be a whole number greater than or equal to its minimum');
        }
        if (previousMaximum === null && tiers.indexOf(tier) > 0) {
            throw badRequest('An unbounded pricing tier must be the final tier');
        }
        if (previousMaximum !== null && tier.minimumQuantity <= previousMaximum) {
            throw badRequest('Pricing tiers must be ordered and cannot overlap');
        }
        previousMaximum = tier.maximumQuantity ?? null;
    }
    if (tiers.some((tier, index) => tier.maximumQuantity == null && index < tiers.length - 1)) {
        throw badRequest('An unbounded pricing tier must be the final tier');
    }
}

async function validateBuyerProduct(client: PoolClient, businessId: number, productId: number): Promise<void> {
    const { rows } = await client.query<{ is_stock_tracked: boolean }>(
        `SELECT is_stock_tracked
           FROM products
          WHERE product_id = $1 AND business_id = $2
            AND status = 'active' AND deleted_at IS NULL
          FOR KEY SHARE`,
        [productId, businessId],
    );
    if (!rows[0]) throw badRequest('Buyer inventory product must belong to the purchasing business and be active');
    if (!rows[0].is_stock_tracked) throw badRequest('Buyer inventory product must have stock tracking enabled');
}

export async function applySupplier(
    ctx: TenantContext,
    client: PoolClient,
    businessId: number,
    description: string | null,
) {
    const { rows: businessRows } = await client.query<{ eligible: boolean }>(
        `SELECT (status = 'active' AND is_verified AND verification_status = 'verified') AS eligible
           FROM businesses WHERE business_id = $1`,
        [businessId],
    );
    if (!businessRows[0]?.eligible) throw forbidden('Only an approved business can apply as a wholesale supplier');
    const { rows } = await client.query(
        `INSERT INTO wholesale_suppliers (business_id, description, applied_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (business_id) DO UPDATE
            SET description = EXCLUDED.description,
                status = 'pending',
                applied_by = EXCLUDED.applied_by,
                applied_at = now(),
                reviewed_by = NULL,
                reviewed_at = NULL,
                rejection_reason = NULL
          WHERE wholesale_suppliers.status = 'rejected'
         RETURNING *`,
        [businessId, description, ctx.userId],
    );
    if (!rows[0]) throw conflict('Supplier application already exists or is not eligible for resubmission');
    await recordEvent(client, {
        buyerBusinessId: null, supplierBusinessId: businessId, actorUserId: ctx.userId,
        entityType: 'supplier', entityId: businessId, eventType: 'supplier.applied',
    });
    return rows[0];
}

export async function reviewSupplier(
    client: PoolClient,
    businessId: number,
    reviewerId: number,
    status: 'approved' | 'rejected',
    reason: string | null,
) {
    const { rows } = await client.query(
        `UPDATE wholesale_suppliers
            SET status = $2, reviewed_by = $3, reviewed_at = now(),
                rejection_reason = CASE WHEN $2 = 'rejected' THEN NULLIF($4, '') ELSE NULL END
          WHERE business_id = $1 AND status = 'pending'
         RETURNING *`,
        [businessId, status, reviewerId, reason],
    );
    if (!rows[0]) throw notFound('Pending supplier application not found');
    await recordEvent(client, {
        buyerBusinessId: null, supplierBusinessId: businessId, actorUserId: reviewerId,
        entityType: 'supplier', entityId: businessId, eventType: `supplier.${status}`,
        details: reason ? { reason } : {},
    });
    return rows[0];
}

export async function listSupplierApplications(client: PoolClient, status?: string) {
    const { rows } = await client.query(
        `SELECT ws.*, b.business_name, b.city, b.email, b.phone
           FROM wholesale_suppliers ws JOIN businesses b USING (business_id)
          WHERE ($1::TEXT IS NULL OR ws.status = $1)
          ORDER BY ws.applied_at DESC, ws.business_id DESC
          LIMIT 100`,
        [status ?? null],
    );
    return rows;
}

export async function getSupplierStatus(client: PoolClient, businessId: number) {
    const { rows } = await client.query(
        `SELECT ws.*, b.business_name, b.city
           FROM wholesale_suppliers ws JOIN businesses b USING (business_id)
          WHERE ws.business_id = $1`,
        [businessId],
    );
    return rows[0] ?? null;
}

export async function upsertOffer(
    ctx: TenantContext,
    client: PoolClient,
    businessId: number,
    offerId: number | null,
    input: WholesaleOfferInput,
) {
    validateTiers(input.minimumOrderQuantity, input.tiers);
    if (!Number.isSafeInteger(input.minimumOrderQuantity) || input.minimumOrderQuantity < 1
        || !Number.isSafeInteger(input.availableQuantity) || input.availableQuantity < 0) {
        throw badRequest('MOQ must be positive and available quantity must be a non-negative whole number');
    }
    if (!isCurrencyAmount(input.wholesalePrice) || input.wholesalePrice <= 0
        || input.wholesalePrice > 99_999_999_999.99) {
        throw badRequest('Wholesale price must be positive and within the supported range');
    }
    const currency = input.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('Currency must be a three-letter code');
    const { rows: supplierRows } = await client.query<{ status: string }>(
        'SELECT status FROM wholesale_suppliers WHERE business_id = $1',
        [businessId],
    );
    if (supplierRows[0]?.status !== 'approved') throw forbidden('An approved supplier profile is required');
    const { rows: productRows } = await client.query<{ currency: string; is_stock_tracked: boolean }>(
        `SELECT currency, is_stock_tracked FROM products
          WHERE product_id = $1 AND business_id = $2 AND status = 'active' AND deleted_at IS NULL
          FOR UPDATE`,
        [input.productId, businessId],
    );
    const product = productRows[0];
    if (!product) throw notFound('Active product not found in this supplier business');
    if (product.currency.trim().toUpperCase() !== currency) throw badRequest('Offer currency must match the product currency');
    if (offerId != null) {
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtextextended('wholesale-offer:' || $1::TEXT, 0))`,
            [offerId],
        );
        const { rows: existing } = await client.query<{ offer_id: string }>(
            `SELECT offer_id FROM wholesale_offers
              WHERE offer_id = $1 AND supplier_business_id = $2 FOR UPDATE`,
            [offerId, businessId],
        );
        if (!existing[0]) throw notFound('Wholesale offer not found');
        const { rows: openOrderRows } = await client.query<{ count: string }>(
            `SELECT COALESCE(sum(i.ordered_quantity), 0)::TEXT AS count
               FROM wholesale_purchase_order_items i
               JOIN wholesale_purchase_orders po USING (purchase_order_id)
              WHERE i.offer_id = $1
                AND po.status IN ('pending_confirmation', 'confirmed', 'processing')`,
            [offerId],
        );
        const committed = Number(openOrderRows[0]?.count ?? 0);
        if (input.availableQuantity < committed) {
            throw conflict('Available quantity cannot be lower than quantities already committed to open orders');
        }
    }

    const isCreate = offerId == null;
    let saved: Record<string, unknown>;
    if (offerId == null) {
        const { rows } = await client.query(
            `INSERT INTO wholesale_offers
                (supplier_business_id, product_id, wholesale_price, currency,
                 minimum_order_quantity, available_quantity, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [businessId, input.productId, input.wholesalePrice, currency,
                input.minimumOrderQuantity, input.availableQuantity, input.status ?? 'active'],
        );
        saved = rows[0] as Record<string, unknown>;
        offerId = Number(saved.offer_id);
    } else {
        const { rows } = await client.query(
            `UPDATE wholesale_offers
                SET product_id = $3, wholesale_price = $4, currency = $5,
                    minimum_order_quantity = $6, available_quantity = $7, status = $8
              WHERE offer_id = $1 AND supplier_business_id = $2
             RETURNING *`,
            [offerId, businessId, input.productId, input.wholesalePrice, currency,
                input.minimumOrderQuantity, input.availableQuantity, input.status ?? 'active'],
        );
        saved = rows[0] as Record<string, unknown>;
    }
    await client.query('DELETE FROM wholesale_offer_tiers WHERE offer_id = $1', [offerId]);
    for (const tier of input.tiers) {
        await client.query(
            `INSERT INTO wholesale_offer_tiers (offer_id, minimum_quantity, maximum_quantity, unit_price)
             VALUES ($1, $2, $3, $4)`,
            [offerId, tier.minimumQuantity, tier.maximumQuantity ?? null, tier.unitPrice],
        );
    }
    await recordEvent(client, {
        buyerBusinessId: null, supplierBusinessId: businessId, actorUserId: ctx.userId,
        entityType: 'offer', entityId: offerId, eventType: isCreate ? 'offer.created' : 'offer.saved',
    });
    return getOfferById(client, offerId, true) ?? saved;
}

export async function getOfferById(client: PoolClient, offerId: number, includeInactive = false) {
    const { rows } = await client.query(
        `SELECT o.offer_id, o.supplier_business_id, o.product_id, o.wholesale_price,
                o.currency, o.minimum_order_quantity, o.available_quantity, o.status,
                p.product_name, p.sku, p.image_url, b.business_name, b.city
           FROM wholesale_offers o
           JOIN products p ON p.product_id = o.product_id AND p.business_id = o.supplier_business_id
           JOIN businesses b ON b.business_id = o.supplier_business_id
          WHERE o.offer_id = $1 AND ($2 OR o.status = 'active')`,
        [offerId, includeInactive],
    );
    if (!rows[0]) return null;
    const { rows: tiers } = await client.query(
        `SELECT tier_id, minimum_quantity, maximum_quantity, unit_price
           FROM wholesale_offer_tiers WHERE offer_id = $1 ORDER BY minimum_quantity`,
        [offerId],
    );
    return { ...rows[0], tiers };
}

export async function listOffers(
    client: PoolClient,
    filters: { search?: string; supplierBusinessId?: number; limit?: number; offset?: number },
) {
    const { rows } = await client.query(
        `SELECT o.offer_id, o.supplier_business_id, o.product_id, o.wholesale_price,
                o.currency, o.minimum_order_quantity, o.available_quantity, o.status,
                p.product_name, p.sku, p.image_url, b.business_name, b.city,
                COALESCE(json_agg(json_build_object(
                    'minimum_quantity', t.minimum_quantity,
                    'maximum_quantity', t.maximum_quantity,
                    'unit_price', t.unit_price
                ) ORDER BY t.minimum_quantity) FILTER (WHERE t.tier_id IS NOT NULL), '[]'::json) AS tiers
           FROM wholesale_offers o
           JOIN wholesale_suppliers ws ON ws.business_id = o.supplier_business_id AND ws.status = 'approved'
           JOIN businesses b ON b.business_id = o.supplier_business_id
           JOIN products p ON p.product_id = o.product_id AND p.business_id = o.supplier_business_id
           LEFT JOIN wholesale_offer_tiers t ON t.offer_id = o.offer_id
          WHERE o.status = 'active' AND b.status = 'active' AND b.is_verified
            AND b.verification_status = 'verified'
            AND ($1::TEXT IS NULL OR p.product_name ILIKE '%' || $1 || '%' OR b.business_name ILIKE '%' || $1 || '%')
            AND ($2::BIGINT IS NULL OR o.supplier_business_id = $2)
          GROUP BY o.offer_id, p.product_name, p.sku, p.image_url, b.business_name, b.city
          ORDER BY p.product_name, o.wholesale_price, o.offer_id
          LIMIT $3 OFFSET $4`,
        [filters.search?.trim() || null, filters.supplierBusinessId ?? null,
            Math.min(filters.limit ?? 50, 100), Math.max(filters.offset ?? 0, 0)],
    );
    return rows;
}

export async function listSupplierOffers(client: PoolClient, businessId: number) {
    const { rows } = await client.query(
        `SELECT o.offer_id FROM wholesale_offers o
          WHERE o.supplier_business_id = $1 ORDER BY o.updated_at DESC`,
        [businessId],
    );
    const offers = [];
    for (const row of rows) {
        const offer = await getOfferById(client, Number(row.offer_id), true);
        if (offer) offers.push(offer);
    }
    return offers;
}

export async function createRfq(
    ctx: TenantContext,
    client: PoolClient,
    buyerBusinessId: number,
    input: {
        supplierBusinessId: number;
        items: Array<{ offerId: number; buyerProductId: number; quantity: number }>;
        deliveryLocationId?: number | null;
        deliveryAddress?: string | null;
        deliveryCity?: string | null;
        requestedDeliveryDate?: string | null;
        note?: string | null;
    },
) {
    if (input.items.length < 1 || input.items.length > 100) throw badRequest('RFQ must contain between 1 and 100 items');
    if (new Set(input.items.map((item) => item.offerId)).size !== input.items.length) {
        throw badRequest('An RFQ cannot contain duplicate offers');
    }
    const locationId = await validateInventoryLocation(client, buyerBusinessId, input.deliveryLocationId);
    const offers = await lockOffers(client, input.items.map((item) => item.offerId));
    if (offers.length !== input.items.length
        || offers.some((offer) => Number(offer.supplier_business_id) !== input.supplierBusinessId || offer.status !== 'active')) {
        throw badRequest('Every RFQ item must be an active offer from the selected supplier');
    }
    const currencies = new Set(offers.map((offer) => String(offer.currency).trim().toUpperCase()));
    if (currencies.size !== 1) throw badRequest('All items in an RFQ must use the same currency');
    for (const item of input.items) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw badRequest('Requested quantities must be positive whole numbers');
        await validateBuyerProduct(client, buyerBusinessId, item.buyerProductId);
    }
    const { rows } = await client.query(
        `INSERT INTO wholesale_rfqs
            (buyer_business_id, supplier_business_id, delivery_location_id, delivery_address,
             delivery_city, requested_delivery_date, buyer_note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [buyerBusinessId, input.supplierBusinessId, locationId, input.deliveryAddress ?? null,
            input.deliveryCity ?? null, input.requestedDeliveryDate ?? null, input.note ?? null, ctx.userId],
    );
    const rfq = rows[0] as Record<string, unknown>;
    for (const item of input.items) {
        const offer = offers.find((candidate) => Number(candidate.offer_id) === item.offerId)!;
        await client.query(
            `INSERT INTO wholesale_rfq_items
                (rfq_id, buyer_business_id, supplier_business_id, offer_id, product_id,
                 buyer_product_id, requested_quantity)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [rfq.rfq_id, buyerBusinessId, input.supplierBusinessId, item.offerId,
                offer.product_id, item.buyerProductId, item.quantity],
        );
    }
    await recordEvent(client, {
        buyerBusinessId, supplierBusinessId: input.supplierBusinessId, actorUserId: ctx.userId,
        entityType: 'rfq', entityId: Number(rfq.rfq_id), eventType: 'rfq.created',
        notification: {
            businessId: input.supplierBusinessId,
            eventType: 'wholesale.rfq.created',
            targetType: 'rfq',
            targetId: Number(rfq.rfq_id),
            metadata: {},
        },
    });
    return getRfq(client, Number(rfq.rfq_id), buyerBusinessId);
}

export async function listRfqs(client: PoolClient, businessId: number) {
    const { rows } = await client.query(
        `SELECT r.*, buyer.business_name AS buyer_name, supplier.business_name AS supplier_name
           FROM wholesale_rfqs r
           JOIN businesses buyer ON buyer.business_id = r.buyer_business_id
           JOIN businesses supplier ON supplier.business_id = r.supplier_business_id
          WHERE r.buyer_business_id = $1 OR r.supplier_business_id = $1
          ORDER BY r.updated_at DESC LIMIT 100`,
        [businessId],
    );
    const rfqs = [];
    for (const row of rows) rfqs.push(await getRfq(client, Number(row.rfq_id), businessId));
    return rfqs;
}

export async function getRfq(client: PoolClient, rfqId: number, viewerBusinessId?: number) {
    const { rows } = await client.query(
        `SELECT r.*, buyer.business_name AS buyer_name, supplier.business_name AS supplier_name
           FROM wholesale_rfqs r
           JOIN businesses buyer ON buyer.business_id = r.buyer_business_id
           JOIN businesses supplier ON supplier.business_id = r.supplier_business_id
          WHERE r.rfq_id = $1`,
        [rfqId],
    );
    if (!rows[0]) return null;
    const { rows: items } = await client.query(
        `SELECT ri.rfq_item_id, ri.rfq_id, ri.offer_id, ri.product_id,
                CASE WHEN r.buyer_business_id = $2 THEN ri.buyer_product_id END AS buyer_product_id,
                ri.requested_quantity, ri.quoted_unit_price,
                p.product_name, p.sku, o.wholesale_price, o.currency,
                o.minimum_order_quantity, o.available_quantity
           FROM wholesale_rfq_items ri
           JOIN wholesale_rfqs r ON r.rfq_id = ri.rfq_id
           JOIN wholesale_offers o ON o.offer_id = ri.offer_id
           JOIN products p ON p.product_id = ri.product_id
          WHERE ri.rfq_id = $1 ORDER BY ri.rfq_item_id`,
        [rfqId, viewerBusinessId ?? null],
    );
    return { ...rows[0], items };
}

export async function quoteRfq(
    ctx: TenantContext,
    client: PoolClient,
    supplierBusinessId: number,
    rfqId: number,
    input: { items: Array<{ rfqItemId: number; unitPrice: number }>; validUntil?: string | null; note?: string | null },
) {
    if (input.items.length < 1 || input.items.length > 100) throw badRequest('Quote must include at least one line');
    if (input.validUntil != null && new Date(input.validUntil).getTime() <= Date.now()) {
        throw badRequest('Quote expiry must be in the future');
    }
    const { rows: rfqs } = await client.query<{ buyer_business_id: string; supplier_business_id: string; status: string }>(
        `SELECT buyer_business_id, supplier_business_id, status FROM wholesale_rfqs WHERE rfq_id = $1 FOR UPDATE`,
        [rfqId],
    );
    const rfq = rfqs[0];
    if (!rfq || Number(rfq.supplier_business_id) !== supplierBusinessId) throw notFound('RFQ not found for this supplier');
    if (rfq.status !== 'pending' && rfq.status !== 'quoted') throw conflict('RFQ can no longer be quoted');
    const ids = [...new Set(input.items.map((item) => item.rfqItemId))];
    if (ids.length !== input.items.length) throw badRequest('RFQ item ids must be unique');
    const { rows: rfqItems } = await client.query<{ rfq_item_id: string }>(
        `SELECT ri.rfq_item_id
           FROM wholesale_rfq_items ri JOIN wholesale_offers o USING (offer_id)
          WHERE ri.rfq_id = $1 AND o.supplier_business_id = $2
            AND ri.rfq_item_id = ANY($3::BIGINT[]) FOR UPDATE OF ri`,
        [rfqId, supplierBusinessId, ids],
    );
    if (rfqItems.length !== ids.length) throw badRequest('Quote contains an item not included in this RFQ');
    const { rows: allItems } = await client.query<{ rfq_item_id: string }>(
        'SELECT rfq_item_id FROM wholesale_rfq_items WHERE rfq_id = $1 ORDER BY rfq_item_id',
        [rfqId],
    );
    if (allItems.length !== ids.length || allItems.some((item) => !ids.includes(Number(item.rfq_item_id)))) {
        throw badRequest('A quotation must include every item in the RFQ');
    }
    for (const item of input.items) {
        if (!isCurrencyAmount(item.unitPrice) || item.unitPrice <= 0 || item.unitPrice > 99_999_999_999.99) {
            throw badRequest('Quoted prices must be positive and within the supported range');
        }
        await client.query('UPDATE wholesale_rfq_items SET quoted_unit_price = $3 WHERE rfq_id = $1 AND rfq_item_id = $2', [
            rfqId, item.rfqItemId, item.unitPrice,
        ]);
    }
    const { rows } = await client.query(
        `UPDATE wholesale_rfqs SET status = 'quoted', valid_until = $2, supplier_note = $3
          WHERE rfq_id = $1 RETURNING *`,
        [rfqId, input.validUntil ?? null, input.note ?? null],
    );
    await recordEvent(client, {
        buyerBusinessId: Number(rfq.buyer_business_id), supplierBusinessId, actorUserId: ctx.userId,
        entityType: 'rfq', entityId: rfqId, eventType: 'rfq.quoted',
        notification: {
            businessId: Number(rfq.buyer_business_id),
            eventType: 'wholesale.rfq.quoted',
            targetType: 'rfq',
            targetId: rfqId,
            metadata: {
                quoteFingerprint: createHash('sha256').update(JSON.stringify({
                    items: [...input.items]
                        .sort((left, right) => left.rfqItemId - right.rfqItemId)
                        .map((item) => [item.rfqItemId, item.unitPrice]),
                    validUntil: input.validUntil ?? null,
                    note: input.note ?? null,
                })).digest('hex'),
            },
        },
    });
    return getRfq(client, Number(rows[0]!.rfq_id), supplierBusinessId);
}

export async function decideRfq(
    ctx: TenantContext,
    client: PoolClient,
    buyerBusinessId: number,
    rfqId: number,
    decision: 'accepted' | 'rejected' | 'cancelled',
) {
    const { rows } = await client.query<{ supplier_business_id: string; status: string; valid_until: Date | null }>(
        `SELECT supplier_business_id, status, valid_until FROM wholesale_rfqs
          WHERE rfq_id = $1 AND buyer_business_id = $2 FOR UPDATE`,
        [rfqId, buyerBusinessId],
    );
    const rfq = rows[0];
    if (!rfq) throw notFound('RFQ not found for this buyer');
    if (decision === 'cancelled') {
        if (rfq.status !== 'pending' && rfq.status !== 'quoted') throw conflict('RFQ cannot be cancelled in its current state');
    } else {
        if (rfq.status !== 'quoted') throw conflict('Only a quoted RFQ can be accepted or rejected');
        if (rfq.valid_until && rfq.valid_until.getTime() <= Date.now()) {
            const { rows: expiredRows } = await client.query(
                `UPDATE wholesale_rfqs SET status = 'expired' WHERE rfq_id = $1 RETURNING *`,
                [rfqId],
            );
            await recordEvent(client, {
                buyerBusinessId, supplierBusinessId: Number(rfq.supplier_business_id),
                actorUserId: ctx.userId, entityType: 'rfq', entityId: rfqId, eventType: 'rfq.expired',
            });
            return getRfq(client, Number(expiredRows[0]!.rfq_id), buyerBusinessId);
        }
    }
    const { rows: updated } = await client.query(
        'UPDATE wholesale_rfqs SET status = $2 WHERE rfq_id = $1 RETURNING *',
        [rfqId, decision],
    );
    await recordEvent(client, {
        buyerBusinessId, supplierBusinessId: Number(rfq.supplier_business_id), actorUserId: ctx.userId,
        entityType: 'rfq', entityId: rfqId, eventType: `rfq.${decision}`,
        notification: {
            businessId: Number(rfq.supplier_business_id),
            eventType: 'wholesale.rfq.decided',
            targetType: 'rfq',
            targetId: rfqId,
            metadata: { decision },
        },
    });
    return getRfq(client, Number(updated[0]!.rfq_id), buyerBusinessId);
}

export async function createPurchaseOrder(
    ctx: TenantContext,
    client: PoolClient,
    buyerBusinessId: number,
    input: {
        items?: Array<{ offerId: number; buyerProductId: number; quantity: number }>;
        rfqId?: number;
        deliveryLocationId?: number | null;
        deliveryAddress?: string | null;
        deliveryCity?: string | null;
        requestedDeliveryDate?: string | null;
        note?: string | null;
    },
) {
    const locationId = await validateInventoryLocation(client, buyerBusinessId, input.deliveryLocationId);
    let lines: Array<{ offerId: number; productId: number; buyerProductId: number; quantity: number; unitPrice: number }>;
    let supplierBusinessId: number;
    let currency: string;
    if (input.rfqId != null) {
        const rfq = await getRfq(client, input.rfqId, buyerBusinessId);
        if (!rfq || Number(rfq.buyer_business_id) !== buyerBusinessId) throw notFound('RFQ not found for this buyer');
        if (rfq.status !== 'accepted' || (rfq.valid_until && new Date(rfq.valid_until as string).getTime() <= Date.now())) {
            throw conflict('Purchase orders require an accepted, unexpired quotation');
        }
        const { rows: existingOrders } = await client.query(
            'SELECT 1 FROM wholesale_purchase_orders WHERE rfq_id = $1',
            [input.rfqId],
        );
        if (existingOrders.length) throw conflict('This quotation already has a purchase order');
        supplierBusinessId = Number(rfq.supplier_business_id);
        const rfqItems = rfq.items as Array<Record<string, unknown>>;
        if (rfqItems.some((item) => item.quoted_unit_price == null)) throw conflict('Every RFQ item must have a quoted price');
        lines = rfqItems.map((item) => ({
            offerId: Number(item.offer_id), productId: Number(item.product_id),
            buyerProductId: Number(item.buyer_product_id),
            quantity: Number(item.requested_quantity), unitPrice: Number(item.quoted_unit_price),
        }));
        currency = String(rfqItems[0]?.currency ?? '');
    } else {
        const items = input.items ?? [];
        if (items.length < 1 || items.length > 100) throw badRequest('Purchase order must contain between 1 and 100 items');
        for (const item of items) {
            if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw badRequest('Order quantities must be positive whole numbers');
            await validateBuyerProduct(client, buyerBusinessId, item.buyerProductId);
        }
        const offers = await lockOffers(client, items.map((item) => item.offerId));
        if (offers.length !== items.length) throw notFound('One or more wholesale offers do not exist');
        if (new Set(items.map((item) => item.offerId)).size !== items.length) {
            throw badRequest('A purchase order cannot contain duplicate offers');
        }
        const supplierIds = new Set(offers.map((offer) => Number(offer.supplier_business_id)));
        if (supplierIds.size !== 1 || offers.some((offer) => offer.status !== 'active')) {
            throw badRequest('A purchase order must contain active offers from one supplier');
        }
        supplierBusinessId = Number(offers[0]!.supplier_business_id);
        const currencies = new Set(offers.map((offer) => String(offer.currency).trim().toUpperCase()));
        if (currencies.size !== 1) throw badRequest('All items in an order must use the same currency');
        currency = [...currencies][0]!;
        lines = [];
        for (const item of items) {
            const offer = offers.find((candidate) => Number(candidate.offer_id) === item.offerId)!;
            if (item.quantity < Number(offer.minimum_order_quantity)) throw badRequest('Quantity is below the offer MOQ');
            const { rows: reserved } = await client.query<{ quantity: string }>(
                `SELECT COALESCE(sum(i.ordered_quantity), 0)::TEXT AS quantity
                   FROM wholesale_purchase_order_items i
                   JOIN wholesale_purchase_orders po USING (purchase_order_id)
                  WHERE i.offer_id = $1
                    AND po.status IN ('pending_confirmation', 'confirmed', 'processing')`,
                [item.offerId],
            );
            if (Number(reserved[0]?.quantity ?? 0) + item.quantity > Number(offer.available_quantity)) {
                throw conflict('Requested quantity exceeds the offer availability');
            }
            const { rows: tiers } = await client.query<{ minimum_quantity: number; maximum_quantity: number | null; unit_price: string }>(
                `SELECT minimum_quantity, maximum_quantity, unit_price
                   FROM wholesale_offer_tiers WHERE offer_id = $1 ORDER BY minimum_quantity DESC`,
                [item.offerId],
            );
            const tier = tiers.find((candidate) =>
                item.quantity >= candidate.minimum_quantity
                && (candidate.maximum_quantity == null || item.quantity <= candidate.maximum_quantity));
            lines.push({
                offerId: item.offerId,
                productId: Number(offer.product_id),
                buyerProductId: item.buyerProductId,
                quantity: item.quantity,
                unitPrice: tier ? Number(tier.unit_price) : Number(offer.wholesale_price),
            });
        }
    }
    const offers = await lockOffers(client, lines.map((line) => line.offerId));
    if (offers.length !== lines.length || offers.some((offer) =>
        Number(offer.supplier_business_id) !== supplierBusinessId || offer.status !== 'active')) {
        throw conflict('An offer is no longer available');
    }
    const uuid = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
    const totalCents = lines.reduce(
        (sum, line) => sum + BigInt(line.quantity) * BigInt(Math.round(line.unitPrice * 100)),
        0n,
    );
    if (totalCents > 99_999_999_999_999n) {
        throw badRequest('Purchase order total exceeds the supported range');
    }
    const total = Number(totalCents) / 100;
    const { rows } = await client.query(
        `INSERT INTO wholesale_purchase_orders
            (order_number, buyer_business_id, supplier_business_id, rfq_id, currency, total_amount,
             delivery_location_id, delivery_address, delivery_city, requested_delivery_date, buyer_note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [`HWP-${uuid}`, buyerBusinessId, supplierBusinessId, input.rfqId ?? null, currency, total,
            locationId, input.deliveryAddress ?? null, input.deliveryCity ?? null,
            input.requestedDeliveryDate ?? null, input.note ?? null, ctx.userId],
    );
    const order = rows[0] as Record<string, unknown>;
    for (const line of lines) {
        await validateBuyerProduct(client, buyerBusinessId, line.buyerProductId);
        const offer = offers.find((candidate) => Number(candidate.offer_id) === line.offerId)!;
        if (line.quantity < Number(offer.minimum_order_quantity)) throw badRequest('Quantity is below the offer MOQ');
        const { rows: reserved } = await client.query<{ quantity: string }>(
            `SELECT COALESCE(sum(i.ordered_quantity), 0)::TEXT AS quantity
               FROM wholesale_purchase_order_items i
               JOIN wholesale_purchase_orders po USING (purchase_order_id)
              WHERE i.offer_id = $1
                AND po.status IN ('pending_confirmation', 'confirmed', 'processing')`,
            [line.offerId],
        );
        if (Number(reserved[0]?.quantity ?? 0) + line.quantity > Number(offer.available_quantity)) {
            throw conflict('Requested quantity exceeds the offer availability');
        }
    }
    for (const line of lines) {
        await client.query(
            `INSERT INTO wholesale_purchase_order_items
                (purchase_order_id, buyer_business_id, supplier_business_id, offer_id,
                 product_id, buyer_product_id, ordered_quantity, unit_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [order.purchase_order_id, buyerBusinessId, supplierBusinessId, line.offerId,
                line.productId, line.buyerProductId, line.quantity, line.unitPrice],
        );
    }
    await recordEvent(client, {
        buyerBusinessId, supplierBusinessId, actorUserId: ctx.userId,
        entityType: 'purchase_order', entityId: Number(order.purchase_order_id), eventType: 'purchase_order.created',
        notification: {
            businessId: supplierBusinessId,
            eventType: 'wholesale.purchase_order.created',
            targetType: 'purchase_order',
            targetId: Number(order.purchase_order_id),
            metadata: {},
        },
    });
    return getPurchaseOrder(client, Number(order.purchase_order_id));
}

async function lockOffers(client: PoolClient, offerIds: number[]) {
    const sortedIds = [...new Set(offerIds)].sort((a, b) => a - b);
    if (sortedIds.length !== offerIds.length) throw badRequest('Offer ids must be unique');
    for (const offerId of sortedIds) {
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtextextended('wholesale-offer:' || $1::TEXT, 0))`,
            [offerId],
        );
    }
    const { rows } = await client.query(
        `SELECT o.* FROM wholesale_offers o
          WHERE o.offer_id = ANY($1::BIGINT[])
          ORDER BY o.offer_id`,
        [sortedIds],
    );
    return rows as Array<Record<string, unknown>>;
}

export async function listPurchaseOrders(client: PoolClient, businessId: number) {
    const { rows } = await client.query(
        `SELECT purchase_order_id FROM wholesale_purchase_orders
          WHERE buyer_business_id = $1 OR supplier_business_id = $1
          ORDER BY updated_at DESC LIMIT 100`,
        [businessId],
    );
    const orders = [];
    for (const row of rows) orders.push(await getPurchaseOrder(client, Number(row.purchase_order_id)));
    return orders;
}

export async function getPurchaseOrder(client: PoolClient, orderId: number) {
    const { rows } = await client.query(
        `SELECT po.*, buyer.business_name AS buyer_name, supplier.business_name AS supplier_name
           FROM wholesale_purchase_orders po
           JOIN businesses buyer ON buyer.business_id = po.buyer_business_id
           JOIN businesses supplier ON supplier.business_id = po.supplier_business_id
          WHERE po.purchase_order_id = $1`,
        [orderId],
    );
    if (!rows[0]) return null;
    const { rows: items } = await client.query(
        `SELECT i.purchase_order_item_id, i.purchase_order_id, i.offer_id, i.product_id,
                i.ordered_quantity, i.received_quantity, i.unit_price,
                p.product_name, p.sku
           FROM wholesale_purchase_order_items i JOIN products p ON p.product_id = i.product_id
          WHERE i.purchase_order_id = $1 ORDER BY i.purchase_order_item_id`,
        [orderId],
    );
    const { rows: events } = await client.query(
        `SELECT event_id, actor_user_id, event_type, details, created_at
           FROM wholesale_events
          WHERE entity_type = 'purchase_order' AND entity_id = $1
          ORDER BY created_at, event_id`,
        [orderId],
    );
    return { ...rows[0], items, events };
}

const SUPPLIER_TRANSITIONS: Record<string, WholesaleOrderStatus[]> = {
    pending_confirmation: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: [],
    partially_delivered: [],
    delivered: [],
    cancelled: [],
};

export async function transitionPurchaseOrder(
    ctx: TenantContext,
    client: PoolClient,
    businessId: number,
    orderId: number,
    status: WholesaleOrderStatus,
    note: string | null,
) {
    const { rows } = await client.query<{
        buyer_business_id: string; supplier_business_id: string; status: WholesaleOrderStatus;
    }>(
        `SELECT buyer_business_id, supplier_business_id, status
           FROM wholesale_purchase_orders WHERE purchase_order_id = $1 FOR UPDATE`,
        [orderId],
    );
    const order = rows[0];
    if (!order || (Number(order.buyer_business_id) !== businessId && Number(order.supplier_business_id) !== businessId)) {
        throw notFound('Purchase order not found for this business');
    }
    const isSupplier = Number(order.supplier_business_id) === businessId;
    const allowed = isSupplier
        ? SUPPLIER_TRANSITIONS[order.status]?.includes(status) === true
        : order.status === 'pending_confirmation' && status === 'cancelled';
    if (!allowed) throw conflict('Invalid purchase order status transition');
    if (status === 'shipped') {
        const { rows: items } = await client.query<{ offer_id: string; ordered_quantity: number }>(
            `SELECT offer_id, ordered_quantity
               FROM wholesale_purchase_order_items
              WHERE purchase_order_id = $1 ORDER BY offer_id`,
            [orderId],
        );
        const offers = await lockOffers(client, items.map((item) => Number(item.offer_id)));
        if (offers.length !== items.length) throw conflict('A purchase order offer is no longer available');
        for (const item of items) {
            const { rows: updatedOffer } = await client.query(
                `UPDATE wholesale_offers
                    SET available_quantity = available_quantity - $3
                  WHERE offer_id = $1 AND supplier_business_id = $2
                    AND available_quantity >= $3
                 RETURNING offer_id`,
                [item.offer_id, businessId, item.ordered_quantity],
            );
            if (!updatedOffer[0]) throw conflict('Offer availability no longer covers this shipment');
        }
    }
    const { rows: updated } = await client.query(
        `UPDATE wholesale_purchase_orders SET status = $2,
                supplier_note = CASE WHEN $3 THEN COALESCE($4, supplier_note) ELSE supplier_note END
          WHERE purchase_order_id = $1 RETURNING *`,
        [orderId, status, isSupplier, note],
    );
    await recordEvent(client, {
        buyerBusinessId: Number(order.buyer_business_id),
        supplierBusinessId: Number(order.supplier_business_id),
        actorUserId: ctx.userId,
        entityType: 'purchase_order', entityId: orderId,
        eventType: `purchase_order.${status}`,
        details: note ? { note } : {},
        notification: {
            businessId: isSupplier ? Number(order.buyer_business_id) : Number(order.supplier_business_id),
            eventType: 'wholesale.purchase_order.status_changed',
            targetType: 'purchase_order',
            targetId: orderId,
            metadata: { status },
        },
    });
    return getPurchaseOrder(client, Number(updated[0]!.purchase_order_id));
}

export async function receivePurchaseOrder(
    ctx: TenantContext,
    client: PoolClient,
    buyerBusinessId: number,
    orderId: number,
    input: {
        locationId: number;
        idempotencyKey: string;
        note?: string | null;
        items: Array<{ purchaseOrderItemId: number; quantity: number }>;
    },
) {
    await assertInventoryPermission(client, buyerBusinessId, 'inventory.manage');
    const locationId = await validateInventoryLocation(client, buyerBusinessId, input.locationId);
    if (locationId == null) throw badRequest('Select an active inventory location to receive stock');
    if (input.items.length < 1 || input.items.length > 100) throw badRequest('Receipt must contain between 1 and 100 items');
    if (new Set(input.items.map((item) => item.purchaseOrderItemId)).size !== input.items.length) {
        throw badRequest('Receipt item ids must be unique');
    }
    for (const item of input.items) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw badRequest('Received quantities must be positive whole numbers');
    }
    const { rows: orders } = await client.query<{
        buyer_business_id: string; supplier_business_id: string; status: WholesaleOrderStatus;
    }>(
        'SELECT buyer_business_id, supplier_business_id, status FROM wholesale_purchase_orders WHERE purchase_order_id = $1 FOR UPDATE',
        [orderId],
    );
    const order = orders[0];
    if (!order || Number(order.buyer_business_id) !== buyerBusinessId) throw notFound('Purchase order not found for this buyer');
    const canonicalPayload = JSON.stringify({
        buyerBusinessId,
        purchaseOrderId: orderId,
        locationId,
        note: input.note ?? null,
        items: input.items
            .map((item) => ({ purchaseOrderItemId: item.purchaseOrderItemId, quantity: item.quantity }))
            .sort((a, b) => a.purchaseOrderItemId - b.purchaseOrderItemId),
    });
    const payloadHash = createHash('sha256').update(canonicalPayload).digest('hex');
    const { rows: attempts } = await client.query<{
        payload_hash: string; state: 'pending' | 'completed'; result: Record<string, unknown> | null;
    }>(
        `SELECT payload_hash, state, result
           FROM wholesale_receipt_attempts
          WHERE buyer_business_id = $1 AND purchase_order_id = $2 AND attempt_id = $3
          FOR UPDATE`,
        [buyerBusinessId, orderId, input.idempotencyKey],
    );
    const priorAttempt = attempts[0];
    if (priorAttempt) {
        if (priorAttempt.payload_hash !== payloadHash) {
            throw conflict('Idempotency key was already used with a different receipt payload');
        }
        if (priorAttempt.state !== 'completed' || !priorAttempt.result) {
            throw conflict('Receipt attempt is still pending; retry it with the same payload');
        }
        return { ...priorAttempt.result, replayed: true };
    }
    const { rows: replay } = await client.query<{ receipt_id: string }>(
        'SELECT receipt_id FROM wholesale_receipts WHERE purchase_order_id = $1 AND idempotency_key = $2',
        [orderId, input.idempotencyKey],
    );
    if (replay[0]) {
        const prior = await getReceipt(client, Number(replay[0].receipt_id));
        if (!prior) throw new Error('Existing receipt was not available inside its transaction');
        const priorLines = prior.items as Array<Record<string, unknown>>;
        const same = String(prior.note ?? '') === String(input.note ?? '')
            && priorLines.length === input.items.length && input.items.every((line) =>
            priorLines.some((priorLine) => Number(priorLine.purchase_order_item_id) === line.purchaseOrderItemId
                && Number(priorLine.received_quantity) === line.quantity));
        if (!same || Number(prior.location_id) !== locationId) {
            throw conflict('Idempotency key was already used with a different receipt payload');
        }
        await client.query(
            `INSERT INTO wholesale_receipt_attempts
                (buyer_business_id, purchase_order_id, supplier_business_id, attempt_id, payload_hash, state,
                 receipt_id, result, completed_at)
             VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, now())`,
            [buyerBusinessId, orderId, order.supplier_business_id, input.idempotencyKey, payloadHash, prior.receipt_id, prior],
        );
        return { ...prior, replayed: true };
    }
    if (order.status !== 'shipped' && order.status !== 'partially_delivered') {
        throw conflict('Stock can only be received for a shipped purchase order');
    }
    await client.query(
        `INSERT INTO wholesale_receipt_attempts
            (buyer_business_id, purchase_order_id, supplier_business_id, attempt_id, payload_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [buyerBusinessId, orderId, order.supplier_business_id, input.idempotencyKey, payloadHash],
    );
    const ids = input.items.map((item) => item.purchaseOrderItemId).sort((a, b) => a - b);
    const { rows: orderItems } = await client.query<{
        purchase_order_item_id: string; offer_id: string; buyer_product_id: string;
        ordered_quantity: number; received_quantity: number;
    }>(
        `SELECT purchase_order_item_id, offer_id, buyer_product_id, ordered_quantity, received_quantity
           FROM wholesale_purchase_order_items
          WHERE purchase_order_id = $1 AND purchase_order_item_id = ANY($2::BIGINT[])
          ORDER BY purchase_order_item_id FOR UPDATE`,
        [orderId, ids],
    );
    if (orderItems.length !== input.items.length) throw badRequest('Receipt includes an item outside this purchase order');
    const { rows: receipts } = await client.query(
        `INSERT INTO wholesale_receipts
            (purchase_order_id, buyer_business_id, location_id, idempotency_key, received_by, note)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [orderId, buyerBusinessId, locationId, input.idempotencyKey, ctx.userId, input.note ?? null],
    );
    const receipt = receipts[0] as Record<string, unknown>;
    for (const requested of input.items) {
        const poItem = orderItems.find((item) => Number(item.purchase_order_item_id) === requested.purchaseOrderItemId)!;
        if (poItem.received_quantity + requested.quantity > poItem.ordered_quantity) {
            throw conflict('Received quantity exceeds the outstanding quantity');
        }
        const movement = await createStockMovement(ctx, client, {
            businessId: buyerBusinessId,
            productId: Number(poItem.buyer_product_id),
            locationId,
            movementType: 'purchase',
            quantity: requested.quantity,
            sourceType: 'wholesale_receipt',
            sourceReference: `${receipt.receipt_id}:${poItem.purchase_order_item_id}`,
            note: input.note ?? `Wholesale order ${orderId} physical receipt`,
        });
        await client.query(
            `INSERT INTO wholesale_receipt_items
                (receipt_id, purchase_order_item_id, received_quantity, stock_movement_id)
             VALUES ($1, $2, $3, $4)`,
            [receipt.receipt_id, poItem.purchase_order_item_id, requested.quantity, movement.stock_movement_id],
        );
        await client.query(
            `UPDATE wholesale_purchase_order_items
                SET received_quantity = received_quantity + $2
              WHERE purchase_order_item_id = $1`,
            [requested.purchaseOrderItemId, requested.quantity],
        );
    }
    const { rows: remaining } = await client.query<{ outstanding: boolean }>(
        `SELECT bool_or(received_quantity < ordered_quantity) AS outstanding
           FROM wholesale_purchase_order_items WHERE purchase_order_id = $1`,
        [orderId],
    );
    const nextStatus: WholesaleOrderStatus = remaining[0]?.outstanding ? 'partially_delivered' : 'delivered';
    await client.query('UPDATE wholesale_purchase_orders SET status = $2 WHERE purchase_order_id = $1', [orderId, nextStatus]);
    await recordEvent(client, {
        buyerBusinessId, supplierBusinessId: Number(order.supplier_business_id), actorUserId: ctx.userId,
        entityType: 'receipt', entityId: Number(receipt.receipt_id), eventType: 'purchase_order.received',
        details: { purchaseOrderId: orderId, status: nextStatus },
        notification: {
            businessId: buyerBusinessId,
            eventType: 'wholesale.receipt.recorded',
            targetType: 'purchase_order',
            targetId: orderId,
            metadata: { receiptId: Number(receipt.receipt_id), status: nextStatus },
        },
    });
    const result = await getReceipt(client, Number(receipt.receipt_id));
    if (!result) throw new Error('Committed receipt was not available inside its transaction');
    await client.query(
        `UPDATE wholesale_receipt_attempts
            SET state = 'completed', receipt_id = $4, result = $5, completed_at = now()
          WHERE buyer_business_id = $1 AND purchase_order_id = $2 AND attempt_id = $3`,
        [buyerBusinessId, orderId, input.idempotencyKey, receipt.receipt_id, result],
    );
    return result;
}

export async function getReceipt(client: PoolClient, receiptId: number) {
    const { rows } = await client.query(
        `SELECT receipt_id, purchase_order_id, buyer_business_id, location_id,
                idempotency_key, received_by, note, created_at
           FROM wholesale_receipts WHERE receipt_id = $1`,
        [receiptId],
    );
    if (!rows[0]) return null;
    const { rows: items } = await client.query(
        `SELECT ri.receipt_item_id, ri.purchase_order_item_id, ri.received_quantity, ri.stock_movement_id,
                p.product_id, p.product_name
           FROM wholesale_receipt_items ri
           JOIN wholesale_purchase_order_items poi USING (purchase_order_item_id)
           JOIN products p ON p.product_id = poi.buyer_product_id
          WHERE ri.receipt_id = $1 ORDER BY ri.receipt_item_id`,
        [receiptId],
    );
    return { ...rows[0], items };
}

export async function listReceiptAttempts(
    client: PoolClient,
    buyerBusinessId: number,
    orderId: number,
) {
    await assertInventoryPermission(client, buyerBusinessId, 'inventory.manage');
    const { rows: orders } = await client.query(
        'SELECT purchase_order_id FROM wholesale_purchase_orders WHERE purchase_order_id = $1 AND buyer_business_id = $2',
        [orderId, buyerBusinessId],
    );
    if (!orders[0]) throw notFound('Purchase order not found for this buyer');

    const { rows: attempts } = await client.query<{
        attempt_id: string; payload_hash: string; state: 'pending' | 'completed';
        result: Record<string, unknown> | null; created_at: Date; completed_at: Date | null;
    }>(
        `SELECT attempt_id, payload_hash, state, result, created_at, completed_at
           FROM wholesale_receipt_attempts
          WHERE buyer_business_id = $1 AND purchase_order_id = $2
          ORDER BY created_at, attempt_id`,
        [buyerBusinessId, orderId],
    );
    const { rows: legacyReceipts } = await client.query<{ receipt_id: string; idempotency_key: string; created_at: Date }>(
        `SELECT r.receipt_id, r.idempotency_key, r.created_at
           FROM wholesale_receipts r
          WHERE r.buyer_business_id = $1 AND r.purchase_order_id = $2
            AND NOT EXISTS (
                SELECT 1 FROM wholesale_receipt_attempts a
                 WHERE a.buyer_business_id = r.buyer_business_id
                   AND a.purchase_order_id = r.purchase_order_id
                   AND a.attempt_id = r.idempotency_key
            )
          ORDER BY r.created_at, r.receipt_id`,
        [buyerBusinessId, orderId],
    );
    const recorded = await Promise.all(attempts.map(async (attempt) => ({
        attemptId: attempt.attempt_id,
        payloadHash: attempt.payload_hash,
        state: attempt.state,
        result: attempt.result,
        createdAt: attempt.created_at,
        completedAt: attempt.completed_at,
    })));
    const legacy = await Promise.all(legacyReceipts.map(async (receipt) => ({
        attemptId: receipt.idempotency_key,
        payloadHash: null,
        state: 'completed' as const,
        result: await getReceipt(client, Number(receipt.receipt_id)),
        createdAt: receipt.created_at,
        completedAt: receipt.created_at,
    })));
    return [...recorded, ...legacy].sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function listEvents(client: PoolClient, businessId: number) {
    const { rows } = await client.query(
        `SELECT event_id, entity_type, entity_id, event_type, details, created_at
           FROM wholesale_events
          WHERE buyer_business_id = $1 OR supplier_business_id = $1
          ORDER BY created_at DESC, event_id DESC LIMIT 100`,
        [businessId],
    );
    return rows;
}

async function recordEvent(
    client: PoolClient,
    event: {
        buyerBusinessId: number | null;
        supplierBusinessId: number | null;
        actorUserId: number | null;
        entityType: string;
        entityId: number;
        eventType: string;
        details?: Record<string, unknown>;
        notification?: {
            businessId: number;
            eventType: string;
            targetType: 'purchase_order' | 'rfq';
            targetId: number;
            metadata: Record<string, unknown>;
        };
    },
): Promise<void> {
    const { rows } = await client.query<{ event_id: string }>(
        `INSERT INTO wholesale_events
            (buyer_business_id, supplier_business_id, actor_user_id, entity_type, entity_id, event_type, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB)
         RETURNING event_id`,
        [event.buyerBusinessId, event.supplierBusinessId, event.actorUserId,
            event.entityType, event.entityId, event.eventType, JSON.stringify(event.details ?? {})],
    );
    if (event.notification) {
        await client.query(
            `SELECT create_wholesale_event_notifications($1, $2, $3, $4, $5, $6::JSONB)`,
            [rows[0]!.event_id, event.notification.eventType, event.notification.businessId,
                event.notification.targetType, event.notification.targetId, JSON.stringify(event.notification.metadata)],
        );
        // Broadcast real-time notification
        try {
            realtimeService.broadcastToBusiness(event.notification.businessId, {
                type: 'notification',
                businessId: event.notification.businessId,
                data: {
                    eventType: event.notification.eventType,
                    targetType: event.notification.targetType,
                    targetId: event.notification.targetId,
                    metadata: event.notification.metadata,
                },
            });
        } catch {}
    }
}
