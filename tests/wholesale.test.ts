process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;
let sellerBusinessId: number;
let buyerBusinessId: number;
let outsiderBusinessId: number;
let buyerLocationId: number;
let sellerToken: string;
let buyerToken: string;
let outsiderToken: string;
let viewerToken: string;
let adminToken: string;
let offerId: number;
let sellerProductId: number;
let buyerProductId: number;
let outsiderProductId: number;
let outsiderOfferId: number;
let rfqId: number;
let orderId: number;
let orderItemId: number;

before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const { rows: users } = await adminPool.query<{ user_id: string; email: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ('wholesale-seller@hq.test', 'unused', 'Wholesale Seller', 'active'),
                ('wholesale-buyer@hq.test', 'unused', 'Wholesale Buyer', 'active'),
                ('wholesale-outsider@hq.test', 'unused', 'Wholesale Outsider', 'active'),
                ('wholesale-viewer@hq.test', 'unused', 'Wholesale Viewer', 'active'),
                ('wholesale-admin@hq.test', 'unused', 'Wholesale Admin', 'active')
         RETURNING user_id, email`,
    );
    const userIds = new Map(users.map((row) => [row.email, Number(row.user_id)]));
    const { signAccessToken } = await import('../src/middleware/auth.js');
    sellerToken = signAccessToken({ id: userIds.get('wholesale-seller@hq.test')!, email: 'wholesale-seller@hq.test', isPlatformAdmin: false, token_version: 0 });
    buyerToken = signAccessToken({ id: userIds.get('wholesale-buyer@hq.test')!, email: 'wholesale-buyer@hq.test', isPlatformAdmin: false, token_version: 0 });
    outsiderToken = signAccessToken({ id: userIds.get('wholesale-outsider@hq.test')!, email: 'wholesale-outsider@hq.test', isPlatformAdmin: false, token_version: 0 });
    viewerToken = signAccessToken({ id: userIds.get('wholesale-viewer@hq.test')!, email: 'wholesale-viewer@hq.test', isPlatformAdmin: false, token_version: 0 });
    adminToken = signAccessToken({ id: userIds.get('wholesale-admin@hq.test')!, email: 'wholesale-admin@hq.test', isPlatformAdmin: true, token_version: 0 });

    const { rows: businesses } = await adminPool.query<{ business_id: string; business_slug: string }>(
        `INSERT INTO businesses
            (business_name, business_slug, address, city, status, verification_status, is_verified, verified_at)
         VALUES ('Wholesale Seller', 'wholesale-seller', 'Seller address', 'Mogadishu', 'active', 'verified', TRUE, now()),
                ('Wholesale Buyer', 'wholesale-buyer', 'Buyer address', 'Mogadishu', 'active', 'verified', TRUE, now()),
                ('Wholesale Outsider', 'wholesale-outsider', 'Other address', 'Mogadishu', 'active', 'verified', TRUE, now())
         RETURNING business_id, business_slug`,
    );
    const businessIds = new Map(businesses.map((row) => [row.business_slug, Number(row.business_id)]));
    sellerBusinessId = businessIds.get('wholesale-seller')!;
    buyerBusinessId = businessIds.get('wholesale-buyer')!;
    outsiderBusinessId = businessIds.get('wholesale-outsider')!;

    const { rows: roles } = await adminPool.query<{ role_id: string; role_key: string }>(
        `SELECT role_id, role_key FROM roles
          WHERE (scope = 'business' AND role_key = 'business_owner')
           OR (scope = 'business' AND role_key = 'business_employee')
           OR (scope = 'platform' AND role_key = 'platform_admin')`,
    );
    const roleIds = new Map(roles.map((row) => [row.role_key, Number(row.role_id)]));
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now()), ($4, $5, $3, 'active', now()),
                ($6, $7, $3, 'active', now())`,
        [sellerBusinessId, userIds.get('wholesale-seller@hq.test'), roleIds.get('business_owner'),
            buyerBusinessId, userIds.get('wholesale-buyer@hq.test'),
            outsiderBusinessId, userIds.get('wholesale-outsider@hq.test')],
    );
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [buyerBusinessId, userIds.get('wholesale-viewer@hq.test'), roleIds.get('business_employee')],
    );
    await adminPool.query(
        `INSERT INTO user_platform_roles (user_id, role_id, granted_by)
         VALUES ($1, $2, $1)`,
        [userIds.get('wholesale-admin@hq.test'), roleIds.get('platform_admin')],
    );
    const { rows: location } = await adminPool.query<{ location_id: string }>(
        `INSERT INTO business_locations (business_id, location_name, is_primary, is_active)
         VALUES ($1, 'Wholesale receiving branch', TRUE, TRUE) RETURNING location_id`,
        [buyerBusinessId],
    );
    buyerLocationId = Number(location[0]!.location_id);

    const { rows: products } = await adminPool.query<{ product_id: string; product_name: string }>(
        `INSERT INTO products (business_id, product_name, price, currency, status, is_stock_tracked)
         VALUES ($1, 'Supplier carton', 12, 'USD', 'active', TRUE),
                ($2, 'Buyer stock item', 12, 'USD', 'active', TRUE),
                ($3, 'Other supplier carton', 12, 'USD', 'active', TRUE)
         RETURNING product_id, product_name`,
        [sellerBusinessId, buyerBusinessId, outsiderBusinessId],
    );
    sellerProductId = Number(products.find((product) => product.product_name === 'Supplier carton')!.product_id);
    buyerProductId = Number(products.find((product) => product.product_name === 'Buyer stock item')!.product_id);
    outsiderProductId = Number(products.find((product) => product.product_name === 'Other supplier carton')!.product_id);
});

after(async () => {
    await closePools?.();
});

function authorization(token: string): string {
    return ['Bearer', token].join(' ');
}

describe('HQ Wholesale supplier, offer, order and receipt workflow', () => {
    it('isolates businesses and replenishes mapped buyer stock only for idempotent physical receipts', async () => {
        const forbiddenDashboard = await request(app)
            .get(`/api/business/${sellerBusinessId}/wholesale`)
            .set('Authorization', authorization(buyerToken));
        assert.equal(forbiddenDashboard.status, 403);
        const outsiderDashboardAccess = await request(app)
            .get(`/api/business/${sellerBusinessId}/wholesale`)
            .set('Authorization', authorization(outsiderToken));
        assert.equal(outsiderDashboardAccess.status, 403);

        const application = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/supplier-application`)
            .set('Authorization', authorization(sellerToken))
            .send({ description: 'Verified local supplier' });
        assert.equal(application.status, 201, JSON.stringify(application.body));
        assert.equal(application.body.data.status, 'pending');

        const approval = await request(app)
            .patch(`/api/admin/wholesale/suppliers/${sellerBusinessId}`)
            .set('Authorization', authorization(adminToken))
            .send({ status: 'approved' });
        assert.equal(approval.status, 200, JSON.stringify(approval.body));

        const otherSupplierApplication = await request(app)
            .post(`/api/business/${outsiderBusinessId}/wholesale/supplier-application`)
            .set('Authorization', authorization(outsiderToken))
            .send({ description: 'Second wholesale supplier' });
        assert.equal(otherSupplierApplication.status, 201, JSON.stringify(otherSupplierApplication.body));
        const otherSupplierApproval = await request(app)
            .patch(`/api/admin/wholesale/suppliers/${outsiderBusinessId}`)
            .set('Authorization', authorization(adminToken))
            .send({ status: 'approved' });
        assert.equal(otherSupplierApproval.status, 200, JSON.stringify(otherSupplierApproval.body));
        const otherSupplierOffer = await request(app)
            .post(`/api/business/${outsiderBusinessId}/wholesale/offers`)
            .set('Authorization', authorization(outsiderToken))
            .send({
                productId: outsiderProductId,
                wholesalePrice: 11,
                currency: 'USD',
                minimumOrderQuantity: 2,
                availableQuantity: 20,
                tiers: [],
            });
        assert.equal(otherSupplierOffer.status, 201, JSON.stringify(otherSupplierOffer.body));
        outsiderOfferId = Number(otherSupplierOffer.body.data.offer_id);

        const offer = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/offers`)
            .set('Authorization', authorization(sellerToken))
            .send({
                productId: sellerProductId,
                wholesalePrice: 10,
                currency: 'USD',
                minimumOrderQuantity: 5,
                availableQuantity: 25,
                tiers: [
                    { minimumQuantity: 10, maximumQuantity: 19, unitPrice: 9 },
                    { minimumQuantity: 20, maximumQuantity: null, unitPrice: 8 },
                ],
            });
        assert.equal(offer.status, 201, JSON.stringify(offer.body));
        offerId = Number(offer.body.data.offer_id);

        const deactivateOffer = await request(app)
            .patch(`/api/business/${sellerBusinessId}/wholesale/offers/${offerId}`)
            .set('Authorization', authorization(sellerToken))
            .send({
                productId: sellerProductId,
                wholesalePrice: 10.5,
                currency: 'USD',
                minimumOrderQuantity: 5,
                availableQuantity: 25,
                status: 'inactive',
                tiers: [
                    { minimumQuantity: 10, maximumQuantity: 19, unitPrice: 9 },
                    { minimumQuantity: 20, maximumQuantity: null, unitPrice: 8 },
                ],
            });
        assert.equal(deactivateOffer.status, 200, JSON.stringify(deactivateOffer.body));
        assert.equal(deactivateOffer.body.data.status, 'inactive');
        const inactivePublicOffer = await request(app)
            .get(`/api/wholesale/offers?supplierBusinessId=${sellerBusinessId}`);
        assert.equal(inactivePublicOffer.body.data.some((row: { offer_id: number }) => Number(row.offer_id) === offerId), false);
        const reactivateOffer = await request(app)
            .patch(`/api/business/${sellerBusinessId}/wholesale/offers/${offerId}`)
            .set('Authorization', authorization(sellerToken))
            .send({
                productId: sellerProductId,
                wholesalePrice: 10.5,
                currency: 'USD',
                minimumOrderQuantity: 5,
                availableQuantity: 25,
                status: 'active',
                tiers: [
                    { minimumQuantity: 10, maximumQuantity: 19, unitPrice: 9 },
                    { minimumQuantity: 20, maximumQuantity: null, unitPrice: 8 },
                ],
            });
        assert.equal(reactivateOffer.status, 200, JSON.stringify(reactivateOffer.body));
        assert.equal(reactivateOffer.body.data.status, 'active');
        const invalidOfferTiers = await request(app)
            .patch(`/api/business/${sellerBusinessId}/wholesale/offers/${offerId}`)
            .set('Authorization', authorization(sellerToken))
            .send({
                productId: sellerProductId,
                wholesalePrice: 10.5,
                currency: 'USD',
                minimumOrderQuantity: 5,
                availableQuantity: 25,
                status: 'active',
                tiers: [
                    { minimumQuantity: 10, maximumQuantity: 19, unitPrice: 9 },
                    { minimumQuantity: 19, maximumQuantity: null, unitPrice: 8 },
                ],
            });
        assert.equal(invalidOfferTiers.status, 400, JSON.stringify(invalidOfferTiers.body));

        const foreignOfferEdit = await request(app)
            .patch(`/api/business/${buyerBusinessId}/wholesale/offers/${offerId}`)
            .set('Authorization', authorization(buyerToken))
            .send({
                productId: sellerProductId,
                wholesalePrice: 1,
                currency: 'USD',
                minimumOrderQuantity: 1,
                availableQuantity: 1,
                status: 'inactive',
                tiers: [],
            });
        assert.equal(foreignOfferEdit.status, 403, JSON.stringify(foreignOfferEdit.body));

        const supplierDashboard = await request(app)
            .get(`/api/business/${sellerBusinessId}/wholesale`)
            .set('Authorization', authorization(sellerToken));
        assert.equal(supplierDashboard.status, 200, JSON.stringify(supplierDashboard.body));
        assert.equal(supplierDashboard.body.data.canManageWholesale, true);
        assert.equal(supplierDashboard.body.data.offers.some((row: { offer_id: number }) => Number(row.offer_id) === offerId), true);
        assert.equal(supplierDashboard.body.data.events.some((row: { event_type: string }) => row.event_type === 'offer.created'), true);
        assert.equal(Number(supplierDashboard.body.data.offers.find(
            (row: { offer_id: number }) => Number(row.offer_id) === offerId,
        ).wholesale_price), 10.5, 'a buyer cannot change a supplier-owned offer through another business context');
        assert.equal(supplierDashboard.body.data.offers.some(
            (row: { offer_id: number }) => Number(row.offer_id) === outsiderOfferId,
        ), false, 'a supplier dashboard does not show another supplier offers');
        const foreignSupplierOfferEdit = await request(app)
            .patch(`/api/business/${outsiderBusinessId}/wholesale/offers/${offerId}`)
            .set('Authorization', authorization(outsiderToken))
            .send({
                productId: outsiderProductId,
                wholesalePrice: 1,
                currency: 'USD',
                minimumOrderQuantity: 1,
                availableQuantity: 1,
                status: 'inactive',
                tiers: [],
            });
        assert.equal(foreignSupplierOfferEdit.status, 404, JSON.stringify(foreignSupplierOfferEdit.body));
        const offerAudit = await adminPool.query<{ actor_email: string }>(
            `SELECT u.email AS actor_email
               FROM wholesale_events e JOIN users u ON u.user_id = e.actor_user_id
              WHERE e.entity_type = 'offer' AND e.entity_id = $1 AND e.event_type = 'offer.created'`,
            [offerId],
        );
        assert.equal(offerAudit.rows[0]?.actor_email, 'wholesale-seller@hq.test');

        const publicOffers = await request(app).get('/api/wholesale/offers');
        assert.equal(publicOffers.status, 200, JSON.stringify(publicOffers.body));
        assert.equal(publicOffers.body.data.some((row: { offer_id: number }) => Number(row.offer_id) === offerId), true);

        const belowMoq = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ items: [{ offerId, buyerProductId, quantity: 4 }] });
        assert.equal(belowMoq.status, 400, JSON.stringify(belowMoq.body));

        const foreignInventoryProduct = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ items: [{ offerId, buyerProductId: sellerProductId, quantity: 5 }] });
        assert.equal(foreignInventoryProduct.status, 400);

        const tierOrder = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ items: [{ offerId, buyerProductId, quantity: 10 }] });
        assert.equal(tierOrder.status, 201, JSON.stringify(tierOrder.body));
        assert.equal(Number(tierOrder.body.data.total_amount), 90, 'the 10-unit price tier must be used');
        const cancelTierOrder = await request(app)
            .patch(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${tierOrder.body.data.purchase_order_id}`)
            .set('Authorization', authorization(buyerToken))
            .send({ status: 'cancelled' });
        assert.equal(cancelTierOrder.status, 200, JSON.stringify(cancelTierOrder.body));
        const { rows: availableAfterCancel } = await adminPool.query<{ available_quantity: number }>(
            'SELECT available_quantity FROM wholesale_offers WHERE offer_id = $1',
            [offerId],
        );
        assert.equal(availableAfterCancel[0]!.available_quantity, 25, 'cancelling an unshipped order releases its reservation');

        const rfq = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/rfqs`)
            .set('Authorization', authorization(buyerToken))
            .send({
                supplierBusinessId: sellerBusinessId,
                deliveryLocationId: buyerLocationId,
                items: [{ offerId, buyerProductId, quantity: 10 }],
            });
        assert.equal(rfq.status, 201, JSON.stringify(rfq.body));
        rfqId = Number(rfq.body.data.rfq_id);
        const rfqItemId = Number(rfq.body.data.items[0].rfq_item_id);

        const readOnlyDashboard = await request(app)
            .get(`/api/business/${buyerBusinessId}/wholesale`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(readOnlyDashboard.status, 200, JSON.stringify(readOnlyDashboard.body));
        assert.equal(readOnlyDashboard.body.data.canManageWholesale, false);
        assert.equal(readOnlyDashboard.body.data.rfqs.some((row: { rfq_id: number }) => Number(row.rfq_id) === rfqId), true);
        const readOnlyRfqChange = await request(app)
            .patch(`/api/business/${buyerBusinessId}/wholesale/rfqs/${rfqId}`)
            .set('Authorization', authorization(viewerToken))
            .send({ decision: 'cancelled' });
        assert.equal(readOnlyRfqChange.status, 403, JSON.stringify(readOnlyRfqChange.body));
        const otherBuyerRfqChange = await request(app)
            .patch(`/api/business/${outsiderBusinessId}/wholesale/rfqs/${rfqId}`)
            .set('Authorization', authorization(outsiderToken))
            .send({ decision: 'cancelled' });
        assert.equal(otherBuyerRfqChange.status, 404, JSON.stringify(otherBuyerRfqChange.body));
        const otherSupplierQuote = await request(app)
            .post(`/api/business/${outsiderBusinessId}/wholesale/rfqs/${rfqId}/quote`)
            .set('Authorization', authorization(outsiderToken))
            .send({ items: [{ rfqItemId, unitPrice: 1 }] });
        assert.equal(otherSupplierQuote.status, 404, JSON.stringify(otherSupplierQuote.body));

        const quote = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/rfqs/${rfqId}/quote`)
            .set('Authorization', authorization(sellerToken))
            .send({
                items: [{ rfqItemId, unitPrice: 9 }],
                validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            });
        assert.equal(quote.status, 200, JSON.stringify(quote.body));
        const invalidQuoteDate = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/rfqs/${rfqId}/quote`)
            .set('Authorization', authorization(sellerToken))
            .send({ items: [{ rfqItemId, unitPrice: 9 }], validUntil: 'not-a-date' });
        assert.equal(invalidQuoteDate.status, 400, JSON.stringify(invalidQuoteDate.body));
        const expiredQuoteDate = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/rfqs/${rfqId}/quote`)
            .set('Authorization', authorization(sellerToken))
            .send({ items: [{ rfqItemId, unitPrice: 9 }], validUntil: new Date(Date.now() - 60_000).toISOString() });
        assert.equal(expiredQuoteDate.status, 400, JSON.stringify(expiredQuoteDate.body));
        const editedQuote = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/rfqs/${rfqId}/quote`)
            .set('Authorization', authorization(sellerToken))
            .send({
                items: [{ rfqItemId, unitPrice: 8.75 }],
                validUntil: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            });
        assert.equal(editedQuote.status, 200, JSON.stringify(editedQuote.body));
        assert.equal(Number(editedQuote.body.data.items[0].quoted_unit_price), 8.75);

        const accept = await request(app)
            .patch(`/api/business/${buyerBusinessId}/wholesale/rfqs/${rfqId}`)
            .set('Authorization', authorization(buyerToken))
            .send({ decision: 'accepted' });
        assert.equal(accept.status, 200, JSON.stringify(accept.body));

        const order = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ rfqId, deliveryLocationId: buyerLocationId });
        assert.equal(order.status, 201, JSON.stringify(order.body));
        orderId = Number(order.body.data.purchase_order_id);
        orderItemId = Number(order.body.data.items[0].purchase_order_item_id);
        assert.equal(Number(order.body.data.total_amount), 87.5);
        assert.equal(Number(order.body.data.items[0].product_id), sellerProductId);
        assert.equal('buyer_product_id' in order.body.data.items[0], false, 'buyer-only product mapping stays private');
        const readOnlyOrdersDashboard = await request(app)
            .get(`/api/business/${buyerBusinessId}/wholesale`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(readOnlyOrdersDashboard.body.data.canManageInventory, false);
        assert.equal(readOnlyOrdersDashboard.body.data.purchaseOrders.some(
            (row: { purchase_order_id: number }) => Number(row.purchase_order_id) === orderId,
        ), true);
        const readOnlyReceipt = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(viewerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'viewer-receipt-denied',
                items: [{ purchaseOrderItemId: orderItemId, quantity: 1 }],
            });
        assert.equal(readOnlyReceipt.status, 403, JSON.stringify(readOnlyReceipt.body));
        const supplierOrdersDashboard = await request(app)
            .get(`/api/business/${sellerBusinessId}/wholesale`)
            .set('Authorization', authorization(sellerToken));
        assert.equal(supplierOrdersDashboard.body.data.purchaseOrders.some(
            (row: { purchase_order_id: number }) => Number(row.purchase_order_id) === orderId,
        ), true);
        const foreignOrderTransition = await request(app)
            .patch(`/api/business/${outsiderBusinessId}/wholesale/purchase-orders/${orderId}`)
            .set('Authorization', authorization(outsiderToken))
            .send({ status: 'cancelled' });
        assert.equal(foreignOrderTransition.status, 404, JSON.stringify(foreignOrderTransition.body));

        const duplicateOrder = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ rfqId });
        assert.equal(duplicateOrder.status, 409);

        const overAvailability = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ items: [{ offerId, buyerProductId, quantity: 16 }] });
        assert.equal(overAvailability.status, 409);

        for (const status of ['confirmed', 'processing', 'shipped']) {
            const transition = await request(app)
                .patch(`/api/business/${sellerBusinessId}/wholesale/purchase-orders/${orderId}`)
                .set('Authorization', authorization(sellerToken))
                .send({ status });
            assert.equal(transition.status, 200, JSON.stringify(transition.body));
        }
        const { rows: availableAfterShip } = await adminPool.query<{ available_quantity: number }>(
            'SELECT available_quantity FROM wholesale_offers WHERE offer_id = $1',
            [offerId],
        );
        assert.equal(availableAfterShip[0]!.available_quantity, 15, 'shipping consumes the supplier offer quantity once');

        const stockOfBuyerProduct = async () => {
            const { rows } = await adminPool.query<{ quantity: number }>(
                `SELECT quantity FROM inventory_balances
                  WHERE business_id = $1 AND product_id = $2 AND location_id = $3`,
                [buyerBusinessId, buyerProductId, buyerLocationId],
            );
            return Number(rows[0]?.quantity ?? 0);
        };
        assert.equal(await stockOfBuyerProduct(), 0, 'creating, accepting and shipping an order must not increase stock');

        const receiptPayload = {
            locationId: buyerLocationId,
            idempotencyKey: 'wholesale-receipt-1',
            items: [{ purchaseOrderItemId: orderItemId, quantity: 4 }],
        };
        const receipt = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send(receiptPayload);
        assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
        assert.equal(await stockOfBuyerProduct(), 4);

        const lostResponseRecovery = await request(app)
            .get(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipt-attempts`)
            .set('Authorization', authorization(buyerToken));
        assert.equal(lostResponseRecovery.status, 200, JSON.stringify(lostResponseRecovery.body));
        const recoveredAttempt = lostResponseRecovery.body.data.find(
            (attempt: { attemptId: string }) => attempt.attemptId === receiptPayload.idempotencyKey,
        );
        assert.equal(recoveredAttempt?.state, 'completed');
        assert.equal(Number(recoveredAttempt?.result?.receipt_id), Number(receipt.body.data.receipt_id));
        const storageClearedRetry = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                ...receiptPayload,
                idempotencyKey: recoveredAttempt.attemptId,
            });
        assert.equal(storageClearedRetry.status, 200, JSON.stringify(storageClearedRetry.body));
        assert.equal(storageClearedRetry.body.data.replayed, true);
        assert.equal(await stockOfBuyerProduct(), 4, 'server recovery after browser storage loss must not add stock');

        const unauthorizedRecovery = await request(app)
            .get(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipt-attempts`)
            .set('Authorization', authorization(outsiderToken));
        assert.equal(unauthorizedRecovery.status, 403);
        const viewerRecovery = await request(app)
            .get(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipt-attempts`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(viewerRecovery.status, 403);

        const replay = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send(receiptPayload);
        assert.equal(replay.status, 200, JSON.stringify(replay.body));
        assert.equal(replay.body.data.replayed, true);
        assert.equal(await stockOfBuyerProduct(), 4, 'replaying an identical receipt must not add stock twice');

        const invalidQuantity = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'wholesale-receipt-invalid',
                items: [{ purchaseOrderItemId: orderItemId, quantity: 1.5 }],
            });
        assert.equal(invalidQuantity.status, 400);
        assert.equal(await stockOfBuyerProduct(), 4);

        const overReceipt = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'wholesale-receipt-over',
                items: [{ purchaseOrderItemId: orderItemId, quantity: 7 }],
            });
        assert.equal(overReceipt.status, 409, JSON.stringify(overReceipt.body));
        assert.equal(await stockOfBuyerProduct(), 4);

        const concurrentPayload = {
            locationId: buyerLocationId,
            idempotencyKey: 'wholesale-receipt-concurrent',
            items: [{ purchaseOrderItemId: orderItemId, quantity: 2 }],
        };
        const concurrentReceipts = await Promise.all([1, 2].map(() => request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send(concurrentPayload)));
        assert.deepEqual(concurrentReceipts.map((result) => result.status).sort(), [200, 201]);
        assert.equal(concurrentReceipts.filter((result) => result.body.data.replayed === true).length, 1);
        assert.equal(await stockOfBuyerProduct(), 6, 'concurrent identical receipt attempts add stock only once');

        const conflictingReplay = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({ ...concurrentPayload, items: [{ purchaseOrderItemId: orderItemId, quantity: 3 }] });
        assert.equal(conflictingReplay.status, 409);
        assert.equal(await stockOfBuyerProduct(), 6);
        const conflictingNoteReplay = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({ ...concurrentPayload, note: 'different receipt note' });
        assert.equal(conflictingNoteReplay.status, 409);
        assert.equal(await stockOfBuyerProduct(), 6);

        const finalReceipt = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'wholesale-receipt-2',
                items: [{ purchaseOrderItemId: orderItemId, quantity: 4 }],
            });
        assert.equal(finalReceipt.status, 201, JSON.stringify(finalReceipt.body));
        assert.equal(await stockOfBuyerProduct(), 10);
        assert.equal(Number(finalReceipt.body.data.items[0].product_id), buyerProductId);
        const finalReceiptReplay = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${orderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'wholesale-receipt-2',
                items: [{ purchaseOrderItemId: orderItemId, quantity: 4 }],
            });
        assert.equal(finalReceiptReplay.status, 200, JSON.stringify(finalReceiptReplay.body));
        assert.equal(await stockOfBuyerProduct(), 10, 'a final receipt retry after delivery must not add stock twice');
        const { rows: receiptMovementCounts } = await adminPool.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM stock_movements
              WHERE business_id = $1 AND source_type = 'wholesale_receipt'
                AND source_reference LIKE $2`,
            [buyerBusinessId, `${finalReceipt.body.data.receipt_id}:%`],
        );
        assert.equal(receiptMovementCounts[0]!.count, 1, 'each receipt line creates one inventory movement');

        const { rows: rollbackProducts } = await adminPool.query<{ product_id: string; business_id: string }>(
            `INSERT INTO products (business_id, product_name, price, currency, status, is_stock_tracked)
             VALUES ($1, 'Supplier rollback carton', 8, 'USD', 'active', TRUE),
                    ($2, 'Buyer rollback item', 8, 'USD', 'active', TRUE)
             RETURNING product_id, business_id`,
            [sellerBusinessId, buyerBusinessId],
        );
        const rollbackSupplierProductId = Number(rollbackProducts.find((row) => Number(row.business_id) === sellerBusinessId)!.product_id);
        const rollbackBuyerProductId = Number(rollbackProducts.find((row) => Number(row.business_id) === buyerBusinessId)!.product_id);
        const secondOffer = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/offers`)
            .set('Authorization', authorization(sellerToken))
            .send({
                productId: rollbackSupplierProductId,
                wholesalePrice: 8,
                currency: 'USD',
                minimumOrderQuantity: 2,
                availableQuantity: 10,
                tiers: [],
            });
        assert.equal(secondOffer.status, 201, JSON.stringify(secondOffer.body));
        const rollbackOrder = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ items: [
                { offerId, buyerProductId, quantity: 5 },
                { offerId: Number(secondOffer.body.data.offer_id), buyerProductId: rollbackBuyerProductId, quantity: 2 },
            ] });
        assert.equal(rollbackOrder.status, 201, JSON.stringify(rollbackOrder.body));
        const rollbackOrderId = Number(rollbackOrder.body.data.purchase_order_id);
        const rollbackItemIds = (rollbackOrder.body.data.items as Array<{ purchase_order_item_id: string }>)
            .map((item) => Number(item.purchase_order_item_id));
        for (const status of ['confirmed', 'processing', 'shipped']) {
            const transition = await request(app)
                .patch(`/api/business/${sellerBusinessId}/wholesale/purchase-orders/${rollbackOrderId}`)
                .set('Authorization', authorization(sellerToken))
                .send({ status });
            assert.equal(transition.status, 200, JSON.stringify(transition.body));
        }
        await adminPool.query(`
            CREATE FUNCTION test_fail_wholesale_inventory_update()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.product_id = ${rollbackBuyerProductId} THEN
                    RAISE EXCEPTION 'simulated wholesale inventory update failure';
                END IF;
                RETURN NEW;
            END;
            $$;
            CREATE TRIGGER test_fail_wholesale_inventory_update
                BEFORE UPDATE ON inventory_balances
                FOR EACH ROW EXECUTE FUNCTION test_fail_wholesale_inventory_update();
        `);
        let inventoryUpdateFailure: request.Response;
        try {
            inventoryUpdateFailure = await request(app)
                .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${rollbackOrderId}/receipts`)
                .set('Authorization', authorization(buyerToken))
                .send({
                    locationId: buyerLocationId,
                    idempotencyKey: 'wholesale-receipt-inventory-failure',
                    items: [
                        { purchaseOrderItemId: rollbackItemIds[0]!, quantity: 1 },
                        { purchaseOrderItemId: rollbackItemIds[1]!, quantity: 1 },
                    ],
                });
        } finally {
            await adminPool.query(`
                DROP TRIGGER test_fail_wholesale_inventory_update ON inventory_balances;
                DROP FUNCTION test_fail_wholesale_inventory_update();
            `);
        }
        assert.equal(inventoryUpdateFailure.status, 500);
        const inventoryFailureState = await adminPool.query<{ receipt_count: number; movement_count: number; attempt_count: number; second_quantity: number }>(
            `SELECT
                (SELECT count(*)::int FROM wholesale_receipts WHERE purchase_order_id = $1) AS receipt_count,
                (SELECT count(*)::int
                   FROM wholesale_receipts wr
                   JOIN wholesale_receipt_items ri USING (receipt_id)
                   JOIN stock_movements sm USING (stock_movement_id)
                  WHERE wr.purchase_order_id = $1 AND sm.source_type = 'wholesale_receipt') AS movement_count,
                (SELECT count(*)::int FROM wholesale_receipt_attempts WHERE purchase_order_id = $1) AS attempt_count,
                COALESCE((SELECT quantity FROM inventory_balances
                   WHERE business_id = $2 AND product_id = $3 AND location_id = $4), 0)::int AS second_quantity`,
            [rollbackOrderId, buyerBusinessId, rollbackBuyerProductId, buyerLocationId],
        );
        assert.deepEqual(inventoryFailureState.rows[0], {
            receipt_count: 0,
            movement_count: 0,
            attempt_count: 0,
            second_quantity: 0,
        }, 'inventory failure rolls back receipt, movements, attempt, and balance changes');

        const rollbackReceipt = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${rollbackOrderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'wholesale-receipt-rollback',
                items: [
                    { purchaseOrderItemId: rollbackItemIds[0]!, quantity: 1 },
                    { purchaseOrderItemId: rollbackItemIds[1]!, quantity: 3 },
                ],
            });
        assert.equal(rollbackReceipt.status, 409, JSON.stringify(rollbackReceipt.body));
        const rollbackState = await adminPool.query<{ receipt_count: number; movement_count: number; first_quantity: number; second_quantity: number }>(
            `SELECT
                (SELECT count(*)::int FROM wholesale_receipts WHERE purchase_order_id = $1) AS receipt_count,
                (SELECT count(*)::int
                   FROM wholesale_receipts wr
                   JOIN wholesale_receipt_items ri USING (receipt_id)
                   JOIN stock_movements sm USING (stock_movement_id)
                  WHERE wr.purchase_order_id = $1 AND sm.source_type = 'wholesale_receipt') AS movement_count,
                COALESCE((SELECT quantity FROM inventory_balances
                   WHERE business_id = $2 AND product_id = $3 AND location_id = $4), 0)::int AS first_quantity,
                COALESCE((SELECT quantity FROM inventory_balances
                   WHERE business_id = $2 AND product_id = $5 AND location_id = $4), 0)::int AS second_quantity`,
            [rollbackOrderId, buyerBusinessId, buyerProductId, buyerLocationId, rollbackBuyerProductId],
        );
        assert.equal(rollbackState.rows[0]!.receipt_count, 0);
        assert.equal(rollbackState.rows[0]!.movement_count, 0);
        assert.equal(rollbackState.rows[0]!.first_quantity, 10);
        assert.equal(rollbackState.rows[0]!.second_quantity, 0);
        const failedAttemptLedger = await adminPool.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM wholesale_receipt_attempts WHERE purchase_order_id = $1',
            [rollbackOrderId],
        );
        assert.equal(failedAttemptLedger.rows[0]!.count, 0, 'failed receipt transaction leaves no pending or completed attempt');
        const retryAfterInventoryFailure = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${rollbackOrderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'wholesale-receipt-inventory-failure',
                items: [
                    { purchaseOrderItemId: rollbackItemIds[0]!, quantity: 1 },
                    { purchaseOrderItemId: rollbackItemIds[1]!, quantity: 1 },
                ],
            });
        assert.equal(retryAfterInventoryFailure.status, 201, JSON.stringify(retryAfterInventoryFailure.body));
        const committedRollbackRetry = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${rollbackOrderId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'wholesale-receipt-rollback',
                items: [
                    { purchaseOrderItemId: rollbackItemIds[0]!, quantity: 1 },
                    { purchaseOrderItemId: rollbackItemIds[1]!, quantity: 1 },
                ],
            });
        assert.equal(committedRollbackRetry.status, 201, JSON.stringify(committedRollbackRetry.body));
        assert.equal(rollbackState.rows[0]!.receipt_count, 0, 'the failed receipt transaction left no receipt behind');
        const { rows: inventoryAfterCommit } = await adminPool.query<{ quantity: number }>(
            `SELECT quantity FROM inventory_balances
              WHERE business_id = $1 AND product_id = $2 AND location_id = $3`,
            [buyerBusinessId, rollbackBuyerProductId, buyerLocationId],
        );
        assert.equal(Number(inventoryAfterCommit[0]?.quantity ?? 0), 2);
        const invalidTransition = await request(app)
            .patch(`/api/business/${sellerBusinessId}/wholesale/purchase-orders/${orderId}`)
            .set('Authorization', authorization(sellerToken))
            .send({ status: 'processing' });
        assert.equal(invalidTransition.status, 409, JSON.stringify(invalidTransition.body));

        const expiredRfq = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/rfqs`)
            .set('Authorization', authorization(buyerToken))
            .send({ supplierBusinessId: sellerBusinessId, items: [{ offerId, buyerProductId, quantity: 5 }] });
        assert.equal(expiredRfq.status, 201, JSON.stringify(expiredRfq.body));
        const expiredRfqId = Number(expiredRfq.body.data.rfq_id);
        const expiredRfqItemId = Number(expiredRfq.body.data.items[0].rfq_item_id);
        const expiredQuote = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/rfqs/${expiredRfqId}/quote`)
            .set('Authorization', authorization(sellerToken))
            .send({
                items: [{ rfqItemId: expiredRfqItemId, unitPrice: 9 }],
                validUntil: new Date(Date.now() + 60_000).toISOString(),
            });
        assert.equal(expiredQuote.status, 200, JSON.stringify(expiredQuote.body));
        await adminPool.query('UPDATE wholesale_rfqs SET valid_until = now() - interval \'1 minute\' WHERE rfq_id = $1', [expiredRfqId]);
        const expiredAccept = await request(app)
            .patch(`/api/business/${buyerBusinessId}/wholesale/rfqs/${expiredRfqId}`)
            .set('Authorization', authorization(buyerToken))
            .send({ decision: 'accepted' });
        assert.equal(expiredAccept.status, 409, JSON.stringify(expiredAccept.body));
        const { rows: expiredState } = await adminPool.query<{ status: string; event_type: string; actor_email: string; entity_id: string }>(
            `SELECT r.status, e.event_type, u.email AS actor_email, e.entity_id
               FROM wholesale_rfqs r
               JOIN wholesale_events e ON e.entity_type = 'rfq' AND e.entity_id = r.rfq_id
               JOIN users u ON u.user_id = e.actor_user_id
              WHERE r.rfq_id = $1 AND e.event_type = 'rfq.expired'`,
            [expiredRfqId],
        );
        assert.equal(expiredState[0]?.status, 'expired');
        assert.equal(expiredState[0]?.event_type, 'rfq.expired');
        assert.equal(expiredState[0]?.actor_email, 'wholesale-buyer@hq.test');
        assert.equal(Number(expiredState[0]?.entity_id), expiredRfqId);

        const alreadyConsumedSupply = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ items: [{ offerId, buyerProductId, quantity: 16 }] });
        assert.equal(alreadyConsumedSupply.status, 409);

        const outsiderDashboard = await request(app)
            .get(`/api/business/${outsiderBusinessId}/wholesale`)
            .set('Authorization', authorization(outsiderToken));
        assert.equal(outsiderDashboard.status, 200, JSON.stringify(outsiderDashboard.body));
        assert.deepEqual(outsiderDashboard.body.data.rfqs, []);
        assert.equal(Number(outsiderDashboard.body.data.purchaseOrders.length), 0);
    });

    it('delivers authorized Wholesale notifications once and rolls them back with failed business events', async () => {
        const buyerInbox = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(buyerInbox.status, 200, JSON.stringify(buyerInbox.body));
        const sellerInbox = await request(app)
            .get(`/api/business/${sellerBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization(sellerToken));
        assert.equal(sellerInbox.status, 200, JSON.stringify(sellerInbox.body));

        const supportedTypes = [
            'wholesale.purchase_order.created',
            'wholesale.purchase_order.status_changed',
            'wholesale.rfq.created',
            'wholesale.rfq.quoted',
            'wholesale.rfq.decided',
            'wholesale.receipt.recorded',
        ];
        const { rows: typeRows } = await adminPool.query<{ event_type: string }>(
            `SELECT DISTINCT event_type FROM in_app_notifications`,
        );
        const actualTypes = new Set(typeRows.map((row) => row.event_type));
        for (const eventType of supportedTypes) assert.equal(actualTypes.has(eventType), true, eventType);

        const { rows: invalidRecipients } = await adminPool.query<{ count: number }>(
            `SELECT count(*)::INT AS count
               FROM in_app_notifications n
               JOIN wholesale_events e USING (event_id)
              WHERE n.business_id <> CASE n.event_type
                  WHEN 'wholesale.purchase_order.created' THEN e.supplier_business_id
                  WHEN 'wholesale.purchase_order.status_changed' THEN
                    CASE WHEN EXISTS (
                        SELECT 1 FROM business_users actor_membership
                         WHERE actor_membership.user_id = e.actor_user_id
                           AND actor_membership.business_id = e.buyer_business_id
                           AND actor_membership.status = 'active'
                    ) THEN e.supplier_business_id ELSE e.buyer_business_id END
                  WHEN 'wholesale.rfq.created' THEN e.supplier_business_id
                  WHEN 'wholesale.rfq.quoted' THEN e.buyer_business_id
                  WHEN 'wholesale.rfq.decided' THEN e.supplier_business_id
                  WHEN 'wholesale.receipt.recorded' THEN e.buyer_business_id
                END
                OR NOT EXISTS (
                    SELECT 1
                      FROM business_users bu
                      JOIN users u ON u.user_id = bu.user_id AND u.status = 'active'
                      JOIN roles r ON r.role_id = bu.role_id AND r.is_active AND r.scope = 'business'
                      JOIN role_permissions rp ON rp.role_id = r.role_id
                      JOIN permissions p ON p.permission_id = rp.permission_id
                     WHERE bu.user_id = n.recipient_user_id
                       AND bu.business_id = n.business_id
                       AND bu.status = 'active'
                       AND p.permission_key = 'wholesale.view'
                )`,
        );
        assert.equal(invalidRecipients[0]!.count, 0, 'only active Wholesale viewers in the event recipient business are notified');
        const { rows: outsiderNotifications } = await adminPool.query<{ count: number }>(
            'SELECT count(*)::INT AS count FROM in_app_notifications WHERE business_id = $1',
            [outsiderBusinessId],
        );
        assert.equal(outsiderNotifications[0]!.count, 0, 'an unrelated business receives no Wholesale notifications');

        const paginated = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=1&offset=0`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(paginated.status, 200);
        assert.equal(paginated.body.data.notifications.length, 1);
        assert.equal(paginated.body.data.limit, 1);
        assert.equal(paginated.body.data.total, buyerInbox.body.data.total);
        assert.equal(paginated.body.data.hasMore, paginated.body.data.total > 1);
        const firstPage = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=2&offset=0`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(firstPage.status, 200, JSON.stringify(firstPage.body));
        const nextPage = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=2&offset=2`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(nextPage.status, 200, JSON.stringify(nextPage.body));
        const firstPageIds = firstPage.body.data.notifications.map(
            (notification: { notification_id: string }) => notification.notification_id,
        );
        const nextPageIds = nextPage.body.data.notifications.map(
            (notification: { notification_id: string }) => notification.notification_id,
        );
        assert.equal(new Set([...firstPageIds, ...nextPageIds]).size, 4, 'successive pages contain no duplicate notifications');
        assert.deepEqual(
            [...firstPageIds, ...nextPageIds],
            buyerInbox.body.data.notifications.slice(0, 4).map(
                (notification: { notification_id: string }) => notification.notification_id,
            ),
            'successive pages contain no skipped notifications',
        );
        const invalidPagination = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=0`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(invalidPagination.status, 400);
        const unauthenticatedInbox = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications`);
        assert.equal(unauthenticatedInbox.status, 401);

        const buyerUnread = buyerInbox.body.data.notifications.find(
            (notification: { read_at: string | null }) => notification.read_at === null,
        );
        assert.ok(buyerUnread, 'the buyer inbox contains unread notifications');
        const buyerNotificationDetail = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications/${buyerUnread.notification_id}`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(buyerNotificationDetail.status, 200, JSON.stringify(buyerNotificationDetail.body));
        assert.equal(buyerNotificationDetail.body.data.notification_id, buyerUnread.notification_id);
        const unreadBefore = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications/unread-count`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(unreadBefore.status, 200);
        assert.equal(unreadBefore.body.data.unreadCount, buyerInbox.body.data.unreadCount);
        const markedRead = await request(app)
            .patch(`/api/business/${buyerBusinessId}/notifications/${buyerUnread.notification_id}/read`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(markedRead.status, 200, JSON.stringify(markedRead.body));
        assert.ok(markedRead.body.data.read_at);
        const markedReadAgain = await request(app)
            .patch(`/api/business/${buyerBusinessId}/notifications/${buyerUnread.notification_id}/read`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(markedReadAgain.body.data.read_at, markedRead.body.data.read_at, 'mark-as-read is idempotent');
        const unreadAfter = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications/unread-count`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(unreadAfter.body.data.unreadCount, unreadBefore.body.data.unreadCount - 1);

        const crossBusinessList = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications`)
            .set('Authorization', authorization(outsiderToken));
        assert.notEqual(crossBusinessList.status, 200);
        const crossBusinessDetail = await request(app)
            .get(`/api/business/${sellerBusinessId}/notifications/${buyerUnread.notification_id}`)
            .set('Authorization', authorization(sellerToken));
        assert.equal(crossBusinessDetail.status, 404, JSON.stringify(crossBusinessDetail.body));
        const crossBusinessUpdate = await request(app)
            .patch(`/api/business/${sellerBusinessId}/notifications/${buyerUnread.notification_id}/read`)
            .set('Authorization', authorization(sellerToken));
        assert.equal(crossBusinessUpdate.status, 404, JSON.stringify(crossBusinessUpdate.body));
        const { rows: notificationProduct } = await adminPool.query<{ product_id: string }>(
            `INSERT INTO products (business_id, product_name, price, currency, status, is_stock_tracked)
             VALUES ($1, 'Notification test carton', 6, 'USD', 'active', TRUE)
             RETURNING product_id`,
            [sellerBusinessId],
        );
        const notificationOffer = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/offers`)
            .set('Authorization', authorization(sellerToken))
            .send({
                productId: Number(notificationProduct[0]!.product_id),
                wholesalePrice: 6,
                currency: 'USD',
                minimumOrderQuantity: 1,
                availableQuantity: 10,
                tiers: [],
            });
        assert.equal(notificationOffer.status, 201, JSON.stringify(notificationOffer.body));
        const { rows: beforeFailure } = await adminPool.query<{ rfqs: number; events: number }>(
            `SELECT
                (SELECT count(*)::INT FROM wholesale_rfqs) AS rfqs,
                (SELECT count(*)::INT FROM wholesale_events) AS events`,
        );
        const notificationPayload = {
            supplierBusinessId: sellerBusinessId,
            items: [{
                offerId: Number(notificationOffer.body.data.offer_id),
                buyerProductId,
                quantity: 1,
            }],
        };

        await adminPool.query(`
            CREATE FUNCTION test_fail_wholesale_notification_insert()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'simulated notification persistence failure';
            END;
            $$;
            CREATE TRIGGER test_fail_wholesale_notification_insert
                BEFORE INSERT ON in_app_notifications
                FOR EACH ROW EXECUTE FUNCTION test_fail_wholesale_notification_insert();
        `);
        let failedRfq: request.Response;
        try {
            failedRfq = await request(app)
                .post(`/api/business/${buyerBusinessId}/wholesale/rfqs`)
                .set('Authorization', authorization(buyerToken))
                .send(notificationPayload);
        } finally {
            await adminPool.query(`
                DROP TRIGGER test_fail_wholesale_notification_insert ON in_app_notifications;
                DROP FUNCTION test_fail_wholesale_notification_insert();
            `);
        }
        assert.equal(failedRfq.status, 500);
        const { rows: afterFailure } = await adminPool.query<{ rfqs: number; events: number }>(
            `SELECT
                (SELECT count(*)::INT FROM wholesale_rfqs) AS rfqs,
                (SELECT count(*)::INT FROM wholesale_events) AS events`,
        );
        assert.deepEqual(afterFailure[0], beforeFailure[0], 'notification persistence failure rolls back the RFQ and audit event');

        const retriedRfq = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/rfqs`)
            .set('Authorization', authorization(buyerToken))
            .send(notificationPayload);
        assert.equal(retriedRfq.status, 201, JSON.stringify(retriedRfq.body));
        const notificationRfqId = Number(retriedRfq.body.data.rfq_id);
        const notificationRfqItemId = Number(retriedRfq.body.data.items[0].rfq_item_id);
        const stableExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const quotePayload = {
            items: [{ rfqItemId: notificationRfqItemId, unitPrice: 5.5 }],
            validUntil: stableExpiry,
        };
        const concurrentQuoteRetries = await Promise.all([0, 1].map(() => request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/rfqs/${notificationRfqId}/quote`)
            .set('Authorization', authorization(sellerToken))
            .send(quotePayload)));
        assert.deepEqual(concurrentQuoteRetries.map((response) => response.status), [200, 200]);
        const { rows: duplicateQuoteNotifications } = await adminPool.query<{ count: number; event_count: number }>(
            `SELECT
                (SELECT count(DISTINCT dedupe_key)::INT FROM in_app_notifications
                  WHERE target_type = 'rfq' AND target_id = $1
                    AND event_type = 'wholesale.rfq.quoted') AS count,
                (SELECT count(*)::INT FROM wholesale_events
                  WHERE entity_type = 'rfq' AND entity_id = $1
                    AND event_type = 'rfq.quoted') AS event_count`,
            [notificationRfqId],
        );
        assert.equal(duplicateQuoteNotifications[0]!.event_count, 2);
        assert.equal(duplicateQuoteNotifications[0]!.count, 1, 'an identical retried quotation creates only one notification');
        const changedQuote = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/rfqs/${notificationRfqId}/quote`)
            .set('Authorization', authorization(sellerToken))
            .send({ ...quotePayload, items: [{ rfqItemId: notificationRfqItemId, unitPrice: 5 }] });
        assert.equal(changedQuote.status, 200, JSON.stringify(changedQuote.body));
        const { rows: changedQuoteNotifications } = await adminPool.query<{ count: number }>(
            `SELECT count(DISTINCT dedupe_key)::INT AS count
               FROM in_app_notifications
              WHERE target_type = 'rfq' AND target_id = $1
                AND event_type = 'wholesale.rfq.quoted'`,
            [notificationRfqId],
        );
        assert.equal(changedQuoteNotifications[0]!.count, 2, 'a changed quotation is a distinct meaningful event');

        const { rows: notificationDuplicates } = await adminPool.query<{ duplicates: number }>(
            `SELECT count(*)::INT AS duplicates
               FROM (
                   SELECT recipient_user_id, dedupe_key
                     FROM in_app_notifications
                    GROUP BY recipient_user_id, dedupe_key
                   HAVING count(*) > 1
               ) duplicate_keys`,
        );
        assert.equal(notificationDuplicates[0]!.duplicates, 0);
    });
});

    it('creates and delivers wholesale notification events for RFQ and purchase order lifecycle with proper recipients and unread counts', async () => {
        // Clear existing notifications for clean test
        await adminPool.query('TRUNCATE in_app_notifications RESTART IDENTITY CASCADE');

        // Create a fresh supplier product and offer
        const { rows: productRows } = await adminPool.query<{ product_id: string }>(
            `INSERT INTO products (business_id, product_name, price, currency, status, is_stock_tracked)
             VALUES ($1, 'Notification lifecycle test', 15, 'USD', 'active', TRUE)
             RETURNING product_id`,
            [sellerBusinessId],
        );
        const lifecycleProductId = Number(productRows[0]!.product_id);

        const offer = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/offers`)
            .set('Authorization', authorization(sellerToken))
            .send({
                productId: lifecycleProductId,
                wholesalePrice: 12,
                currency: 'USD',
                minimumOrderQuantity: 5,
                availableQuantity: 100,
                tiers: [],
            });
        assert.equal(offer.status, 201, JSON.stringify(offer.body));
        const offerId2 = Number(offer.body.data.offer_id);

        // 1. RFQ creation notification
        const rfq = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/rfqs`)
            .set('Authorization', authorization(buyerToken))
            .send({
                supplierBusinessId: sellerBusinessId,
                deliveryLocationId: buyerLocationId,
                items: [{ offerId: offerId2, buyerProductId, quantity: 10 }],
            });
        assert.equal(rfq.status, 201, JSON.stringify(rfq.body));
        const lifecycleRfqId = Number(rfq.body.data.rfq_id);
        const lifecycleRfqItemId = Number(rfq.body.data.items[0].rfq_item_id);

        // Check seller received rfq.created notification
        let sellerInbox = await request(app)
            .get(`/api/business/${sellerBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization(sellerToken));
        assert.equal(sellerInbox.status, 200);
        const rfqCreatedNotif = sellerInbox.body.data.notifications.find(
            (n: { event_type: string; target_id: string }) => n.event_type === 'wholesale.rfq.created' && n.target_id === String(lifecycleRfqId),
        );
        assert.ok(rfqCreatedNotif, 'seller should receive rfq.created notification');

        // 2. Quotation submission notification to correct buyer
        const quote = await request(app)
            .post(`/api/business/${sellerBusinessId}/wholesale/rfqs/${lifecycleRfqId}/quote`)
            .set('Authorization', authorization(sellerToken))
            .send({
                items: [{ rfqItemId: lifecycleRfqItemId, unitPrice: 11 }],
                validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            });
        assert.equal(quote.status, 200, JSON.stringify(quote.body));

        let buyerInbox = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(buyerInbox.status, 200);
        const quotedNotif = buyerInbox.body.data.notifications.find(
            (n: { event_type: string; target_id: string }) => n.event_type === 'wholesale.rfq.quoted' && n.target_id === String(lifecycleRfqId),
        );
        assert.ok(quotedNotif, 'buyer should receive rfq.quoted notification');

        // 3. Accept RFQ and create PO - purchase order created notification to supplier
        await request(app)
            .patch(`/api/business/${buyerBusinessId}/wholesale/rfqs/${lifecycleRfqId}`)
            .set('Authorization', authorization(buyerToken))
            .send({ decision: 'accepted' });

        const po = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders`)
            .set('Authorization', authorization(buyerToken))
            .send({ rfqId: lifecycleRfqId, deliveryLocationId: buyerLocationId });
        assert.equal(po.status, 201, JSON.stringify(po.body));
        const lifecyclePoId = Number(po.body.data.purchase_order_id);
        const lifecyclePoItemId = Number(po.body.data.items[0].purchase_order_item_id);

        sellerInbox = await request(app)
            .get(`/api/business/${sellerBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization(sellerToken));
        assert.equal(sellerInbox.status, 200);
        const poCreatedNotif = sellerInbox.body.data.notifications.find(
            (n: { event_type: string; target_id: string }) => n.event_type === 'wholesale.purchase_order.created' && n.target_id === String(lifecyclePoId),
        );
        assert.ok(poCreatedNotif, 'supplier should receive purchase_order.created notification');

        // 4. Order status change notification
        await request(app)
            .patch(`/api/business/${sellerBusinessId}/wholesale/purchase-orders/${lifecyclePoId}`)
            .set('Authorization', authorization(sellerToken))
            .send({ status: 'confirmed' });

        buyerInbox = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(buyerInbox.status, 200);
        const statusChangedNotif = buyerInbox.body.data.notifications.find(
            (n: { event_type: string; target_id: string }) => n.event_type === 'wholesale.purchase_order.status_changed' && n.target_id === String(lifecyclePoId),
        );
        assert.ok(statusChangedNotif, 'buyer should receive purchase_order.status_changed notification');

        // 5. Receipt recorded notification
        await request(app)
            .patch(`/api/business/${sellerBusinessId}/wholesale/purchase-orders/${lifecyclePoId}`)
            .set('Authorization', authorization(sellerToken))
            .send({ status: 'processing' });
        await request(app)
            .patch(`/api/business/${sellerBusinessId}/wholesale/purchase-orders/${lifecyclePoId}`)
            .set('Authorization', authorization(sellerToken))
            .send({ status: 'shipped' });

        const receipt = await request(app)
            .post(`/api/business/${buyerBusinessId}/wholesale/purchase-orders/${lifecyclePoId}/receipts`)
            .set('Authorization', authorization(buyerToken))
            .send({
                locationId: buyerLocationId,
                idempotencyKey: 'lifecycle-receipt-1',
                items: [{ purchaseOrderItemId: lifecyclePoItemId, quantity: 5 }],
            });
        assert.equal(receipt.status, 201, JSON.stringify(receipt.body));

        buyerInbox = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(buyerInbox.status, 200);
        const receiptNotif = buyerInbox.body.data.notifications.find(
            (n: { event_type: string; target_id: string }) => n.event_type === 'wholesale.receipt.recorded' && n.target_id === String(lifecyclePoId),
        );
        assert.ok(receiptNotif, 'buyer should receive receipt.recorded notification');

        // Test unread count and mark-as-read
        const unreadCount = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications/unread-count`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(unreadCount.status, 200);
        assert.ok(unreadCount.body.data.unreadCount >= 1);

        if (statusChangedNotif) {
            const markRead = await request(app)
                .patch(`/api/business/${buyerBusinessId}/notifications/${statusChangedNotif.notification_id}/read`)
                .set('Authorization', authorization(viewerToken));
            assert.equal(markRead.status, 200);
            assert.ok(markRead.body.data.read_at);
        }

        // Test pagination
        const page1 = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=2&offset=0`)
            .set('Authorization', authorization(viewerToken));
        assert.equal(page1.status, 200);
        assert.equal(page1.body.data.limit, 2);
        assert.ok(Array.isArray(page1.body.data.notifications));
        assert.ok(page1.body.data.total >= 0);

        // Test tenant isolation
        const outsiderInbox = await request(app)
            .get(`/api/business/${outsiderBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization(outsiderToken));
        assert.equal(outsiderInbox.status, 200);
        // Outsider should not see notifications from other businesses
        const outsiderHasOtherBusinessNotif = outsiderInbox.body.data.notifications.some(
            (n: { business_id: string }) => n.business_id === String(buyerBusinessId) || n.business_id === String(sellerBusinessId),
        );
        assert.equal(outsiderHasOtherBusinessNotif, false, 'outsider should not see other businesses notifications');

        // Test unauthorized access
        const noPerm = await request(app)
            .get(`/api/business/${buyerBusinessId}/notifications?limit=100`)
            .set('Authorization', authorization('Bearer invalid'));
        assert.equal(noPerm.status, 401);
    });
