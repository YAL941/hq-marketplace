/**
 * Phase 1 acceptance tests - the eight scenarios required by the brief.
 *
 * These run against a REAL PostgreSQL database (hq_marketplace_test),
 * because the isolation guarantees under test are enforced by the
 * database itself, not by application code that could be mocked away.
 */

// The test database must be selected before the config module is loaded,
// so every import below is dynamic.
process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';

const assert: typeof assertModule = assertModule;

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;

const PASSWORD = 'Password123!';

interface Fixtures {
    ownerA: { id: number; token: string; businessA: number };
    ownerB: { id: number; token: string; businessB: number };
    customer: { id: number; token: string };
}

async function createUser(email: string, fullName: string): Promise<number> {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const { rows } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active') RETURNING user_id`,
        [email, passwordHash, fullName],
    );
    return Number(rows[0]!.user_id);
}

async function createBusiness(name: string, slug: string, ownerId: number, status = 'active'): Promise<number> {
    const { rows } = await adminPool.query<{ business_id: string }>(
        `INSERT INTO businesses
            (business_name, business_slug, business_description, phone, email, city, district,
             status, verification_status, is_verified, verified_at)
         VALUES ($1, $2, $3, '+9630000001', $4, 'Damascus', 'Central', $5::business_status,
                 CASE WHEN $5::text = 'active' THEN 'verified'::verification_status ELSE 'pending'::verification_status END,
                 $5::text = 'active', CASE WHEN $5::text = 'active' THEN now() ELSE NULL END)
         RETURNING business_id`,
        [name, slug, `${name} description`, `${slug}@hq.test`, status],
    );
    const businessId = Number(rows[0]!.business_id);
    const { rows: roleRows } = await adminPool.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business'`,
    );
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [businessId, ownerId, roleRows[0]!.role_id],
    );
    return businessId;
}

async function login(email: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.data.token as string;
}

let fixtures: Fixtures;

before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    // migrate + grants + truncate, serialised across test processes
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const ownerAId = await createUser('owner-a@hq.test', 'Owner A');
    const ownerBId = await createUser('owner-b@hq.test', 'Owner B');
    const customerId = await createUser('customer@hq.test', 'Customer');

    const businessA = await createBusiness('ABC Clinic', 'abc-clinic', ownerAId);
    const businessB = await createBusiness('ABC Clinic', 'abc-clinic-branch', ownerBId);

    fixtures = {
        ownerA: { id: ownerAId, token: '', businessA },
        ownerB: { id: ownerBId, token: '', businessB },
        customer: { id: customerId, token: '' },
    };
    fixtures.ownerA.token = await login('owner-a@hq.test');
    fixtures.ownerB.token = await login('owner-b@hq.test');
    fixtures.customer.token = await login('customer@hq.test');
});

after(async () => {
    await closePools?.();
});

// ---------------------------------------------------------------------------
// Test 1 - a business creates a product and the product belongs to it
// ---------------------------------------------------------------------------
describe('Test 1: Business A creates a Product', () => {
    it('stores the product with the creating business id and returns it in that business only', async () => {
        const { businessA } = fixtures.ownerA;
        const created = await request(app)
            .post(`/api/business/${businessA}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ productName: 'MRI Scan Voucher', price: 120, currency: 'USD', stockQuantity: 5, status: 'active' });

        assert.equal(created.status, 201);
        assert.equal(Number(created.body.data.business_id), businessA);

        const list = await request(app)
            .get(`/api/business/${businessA}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`);
        assert.equal(list.status, 200);
        assert.ok(list.body.data.some((p: { product_id: string }) => p.product_id === created.body.data.product_id));
    });
});

// ---------------------------------------------------------------------------
// Test 2 - Business B cannot reach Business A products, not even in SQL
// ---------------------------------------------------------------------------
describe('Test 2: Business B cannot access Business A data', () => {
    it('is rejected at the API boundary', async () => {
        const res = await request(app)
            .get(`/api/business/${fixtures.ownerA.businessA}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerB.token}`);
        assert.equal(res.status, 403);
    });

    it('cannot read another business rows in SQL, even with no WHERE clause', async () => {
        const { appPool } = await import('../src/db/pool.js');
        const businessA = fixtures.ownerA.businessA;

        // arrange: private rows that belong to business A only
        await adminPool.query(
            `INSERT INTO products (business_id, product_name, price, status)
             VALUES ($1, 'A internal draft', 10, 'draft')`,
            [businessA],
        );
        await adminPool.query(
            `INSERT INTO orders (business_id, customer_id, order_status, subtotal, total_amount)
             VALUES ($1, $2, 'pending', 10, 10)`,
            [businessA, fixtures.customer.id],
        );
        const probeUser = await createUser(`rls-probe-${Date.now()}@hq.test`, 'RLS Probe');
        await adminPool.query(
            `INSERT INTO reviews (business_id, user_id, rating, review_text, status)
             VALUES ($1, $2, 4, 'A internal review', 'pending')`,
            [businessA, probeUser],
        );

        const client = await appPool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT set_config($1, $2, true)', ['app.user_id', String(fixtures.ownerB.id)]);
            await client.query('SELECT set_config($1, $2, true)', ['app.is_platform_admin', 'false']);
            await client.query('SELECT set_config($1, $2, true)', [
                'app.current_business_id',
                String(fixtures.ownerB.businessB),
            ]);

            // deliberately unfiltered queries: only RLS stands between B and A
            const orders = await client.query<{ business_id: string }>('SELECT business_id FROM orders');
            const orderItems = await client.query<{ business_id: string }>('SELECT business_id FROM order_items');
            const reviews = await client.query<{ business_id: string }>('SELECT business_id FROM reviews');
            const drafts = await client.query<{ business_id: string }>(
                "SELECT business_id FROM products WHERE status <> 'active'",
            );
            const stats = await client.query<{ business_id: string }>('SELECT business_id FROM business_statistics');
            await client.query('COMMIT');

            for (const [label, result] of Object.entries({ orders, orderItems, reviews, drafts, stats })) {
                const visible = [...new Set(result.rows.map((r) => Number(r.business_id)))];
                assert.ok(
                    !visible.includes(businessA),
                    `business A rows leaked into business B through ${label}`,
                );
            }
        } finally {
            client.release();
        }
    });
});

// ---------------------------------------------------------------------------
// Test 3 - an owner cannot modify another business
// ---------------------------------------------------------------------------
describe('Test 3: Business Owner A cannot modify Business B', () => {
    it('is rejected for the business profile', async () => {
        const res = await request(app)
            .patch(`/api/business/${fixtures.ownerB.businessB}`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ businessName: 'Hijacked Name' });
        assert.equal(res.status, 403);
    });

    it('is rejected for the catalogue, even with a spoofed business header', async () => {
        const created = await request(app)
            .post(`/api/business/${fixtures.ownerB.businessB}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .set('X-Business-Id', String(fixtures.ownerB.businessB))
            .send({ productName: 'Injected Product', price: 10 });
        assert.equal(created.status, 403);

        const { rows } = await adminPool.query('SELECT count(*)::int AS count FROM products WHERE product_name = $1', [
            'Injected Product',
        ]);
        assert.equal(rows[0]?.count, 0);
    });

    it('leaves business B untouched after the attempt', async () => {
        const { rows } = await adminPool.query<{ business_name: string }>(
            'SELECT business_name FROM businesses WHERE business_id = $1',
            [fixtures.ownerB.businessB],
        );
        assert.equal(rows[0]?.business_name, 'ABC Clinic');
    });
});

// ---------------------------------------------------------------------------
// Test 4 - a customer sees the public directory of active businesses
// ---------------------------------------------------------------------------
describe('Test 4: Customer sees public businesses', () => {
    it('lists active businesses without authentication', async () => {
        const res = await request(app).get('/api/businesses');
        assert.equal(res.status, 200);
        const ids = res.body.data.map((b: { business_id: string }) => Number(b.business_id));
        assert.ok(ids.includes(fixtures.ownerA.businessA));
        assert.ok(ids.includes(fixtures.ownerB.businessB));
    });

    it('hides pending (unapproved) businesses from the public directory', async () => {
        const pendingOwner = await createUser('pending-owner@hq.test', 'Pending Owner');
        const pendingBusiness = await createBusiness('Pending Shop', 'pending-shop', pendingOwner, 'pending');

        const res = await request(app).get('/api/businesses');
        const ids = res.body.data.map((b: { business_id: string }) => Number(b.business_id));
        assert.ok(!ids.includes(pendingBusiness));

        const direct = await request(app).get(`/api/businesses/${pendingBusiness}`);
        assert.equal(direct.status, 404);
    });
});

// ---------------------------------------------------------------------------
// Test 5 - a customer can place an order against a specific business
// ---------------------------------------------------------------------------
describe('Test 5: Customer creates an Order for one business', () => {
    it('creates the order with the business id and frozen prices', async () => {
        assert.equal(app.get('ordersEnabled'), true);
        const product = await request(app)
            .post(`/api/business/${fixtures.ownerA.businessA}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({
                productName: 'Blood Test Panel',
                price: 50,
                currency: 'USD',
                stockQuantity: 5,
                status: 'active',
            });
        assert.equal(product.status, 201);
        const productId = Number(product.body.data.product_id);

        const order = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${fixtures.customer.token}`)
            .send({
                businessId: fixtures.ownerA.businessA,
                items: [{ productId, quantity: 2 }],
                deliveryFee: 5,
            });

        assert.equal(order.status, 201, JSON.stringify(order.body));
        assert.equal(Number(order.body.data.business_id), fixtures.ownerA.businessA);
        assert.equal(order.body.data.subtotal, '100.00');
        assert.equal(order.body.data.total_amount, '100.00', 'client supplied fees are not applied');
        assert.equal(order.body.data.order_status, 'pending');

        // changing the catalogue price must not rewrite the order
        await request(app)
            .patch(`/api/business/${fixtures.ownerA.businessA}/products/${productId}`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ price: 999 });

        const reread = await request(app)
            .get(`/api/orders/mine/${order.body.data.order_id}`)
            .set('Authorization', `Bearer ${fixtures.customer.token}`);
        assert.equal(Number(reread.body.data.order.total_amount), 100);
        assert.equal(reread.body.data.items[0].unit_price, '50.00');
        const stock = await adminPool.query<{ stock_quantity: number }>(
            'SELECT stock_quantity FROM products WHERE product_id = $1',
            [productId],
        );
        assert.equal(Number(stock.rows[0]!.stock_quantity), 3);
    });

    it('rejects orders for more tracked stock than is available', async () => {
        const product = await request(app)
            .post(`/api/business/${fixtures.ownerA.businessA}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({
                productName: 'Limited Stock Item',
                price: 12,
                stockQuantity: 1,
                status: 'active',
            });
        const response = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${fixtures.customer.token}`)
            .send({
                businessId: fixtures.ownerA.businessA,
                items: [{ productId: Number(product.body.data.product_id), quantity: 2 }],
            });
        assert.equal(response.status, 409, JSON.stringify(response.body));
    });

    it('refuses to sell a product that belongs to another business', async () => {
        const otherProduct = await request(app)
            .post(`/api/business/${fixtures.ownerB.businessB}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerB.token}`)
            .send({ productName: 'Business B Burger', price: 12, status: 'active' });

        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${fixtures.customer.token}`)
            .send({
                businessId: fixtures.ownerA.businessA,
                items: [{ productId: Number(otherProduct.body.data.product_id), quantity: 1 }],
            });
        assert.equal(res.status, 404);
    });

    it('returns the unknown-route 404 when disabled while order reads stay available', async () => {
        assert.equal(app.get('ordersEnabled'), true);
        app.set('ordersEnabled', false);
        try {
            const hidden = await request(app).post('/api/orders').send({});
            assert.equal(hidden.status, 404);
            assert.deepEqual(hidden.body, {
                error: { code: 'NOT_FOUND', message: 'Route not found' },
            });

            const existingOrders = await request(app)
                .get('/api/orders/mine')
                .set('Authorization', `Bearer ${fixtures.customer.token}`);
            assert.equal(existingOrders.status, 200);
        } finally {
            app.set('ordersEnabled', true);
        }
    });
});

// ---------------------------------------------------------------------------
// Test 6 - reviews never cross business boundaries
// ---------------------------------------------------------------------------
describe('Test 6: Reviews stay inside their business', () => {
    it('prevents a business owner from reviewing their own business', async () => {
        const completedOrder = await adminPool.query<{ order_id: string }>(
            `INSERT INTO orders (business_id, customer_id, order_status, subtotal, total_amount, completed_at)
             VALUES ($1, $2, 'completed', 0, 0, now()) RETURNING order_id`,
            [fixtures.ownerA.businessA, fixtures.ownerA.id],
        );
        const response = await request(app)
            .post('/api/reviews')
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({
                businessId: fixtures.ownerA.businessA,
                orderId: Number(completedOrder.rows[0]!.order_id),
                rating: 5,
            });
        assert.equal(response.status, 400);
    });

    it('returns only the reviews of the requested business', async () => {
        const otherCustomer = await createUser('customer2@hq.test', 'Second Customer');
        const otherToken = await login('customer2@hq.test');

        const noPurchase = await request(app)
            .post('/api/reviews')
            .set('Authorization', `Bearer ${fixtures.customer.token}`)
            .send({ businessId: fixtures.ownerA.businessA, rating: 5, reviewText: 'Great hospital' });
        assert.equal(noPurchase.status, 400);

        const completedOrderA = await adminPool.query<{ order_id: string }>(
            `INSERT INTO orders (business_id, customer_id, order_status, subtotal, total_amount, completed_at)
             VALUES ($1, $2, 'completed', 0, 0, now()) RETURNING order_id`,
            [fixtures.ownerA.businessA, fixtures.customer.id],
        );
        const completedOrderB = await adminPool.query<{ order_id: string }>(
            `INSERT INTO orders (business_id, customer_id, order_status, subtotal, total_amount, completed_at)
             VALUES ($1, $2, 'completed', 0, 0, now()) RETURNING order_id`,
            [fixtures.ownerB.businessB, otherCustomer],
        );

        const reviewA = await request(app)
            .post('/api/reviews')
            .set('Authorization', `Bearer ${fixtures.customer.token}`)
            .send({
                businessId: fixtures.ownerA.businessA,
                orderId: Number(completedOrderA.rows[0]!.order_id),
                rating: 5,
                reviewText: 'Great hospital',
            });
        const reviewB = await request(app)
            .post('/api/reviews')
            .set('Authorization', `Bearer ${otherToken}`)
            .send({
                businessId: fixtures.ownerB.businessB,
                orderId: Number(completedOrderB.rows[0]!.order_id),
                rating: 2,
                reviewText: 'Slow service',
            });
        assert.equal(reviewA.status, 201);
        assert.equal(reviewB.status, 201);
        assert.equal(reviewA.body.data.status, 'pending', 'new reviews still require moderation');

        const duplicate = await request(app)
            .post('/api/reviews')
            .set('Authorization', `Bearer ${fixtures.customer.token}`)
            .send({
                businessId: fixtures.ownerA.businessA,
                orderId: Number(completedOrderA.rows[0]!.order_id),
                rating: 4,
            });
        assert.equal(duplicate.status, 409);

        await adminPool.query(`UPDATE reviews SET status = 'published' WHERE review_id = ANY($1::bigint[])`, [
            [reviewA.body.data.review_id, reviewB.body.data.review_id],
        ]);

        const listB = await request(app)
            .get(`/api/business/${fixtures.ownerB.businessB}/reviews`)
            .set('Authorization', `Bearer ${fixtures.ownerB.token}`);
        assert.equal(listB.status, 200);
        const ids = listB.body.data.map((r: { review_id: string }) => Number(r.review_id));
        assert.ok(ids.includes(Number(reviewB.body.data.review_id)));
        assert.ok(!ids.includes(Number(reviewA.body.data.review_id)), 'business A review leaked into business B');

        const publicList = await request(app).get(`/api/reviews?businessId=${fixtures.ownerB.businessB}`);
        const publicIds = publicList.body.data.map((r: { review_id: string }) => Number(r.review_id));
        assert.ok(!publicIds.includes(Number(reviewA.body.data.review_id)));
    });
});

describe('Order status transitions and product reviews', () => {
    it('allows only the next valid business-side order status', async () => {
        const { rows } = await adminPool.query<{ order_id: string }>(
            `INSERT INTO orders (business_id, customer_id, order_status, subtotal, total_amount)
             VALUES ($1, $2, 'pending', 0, 0) RETURNING order_id`,
            [fixtures.ownerA.businessA, fixtures.customer.id],
        );
        const orderId = rows[0]!.order_id;

        const confirmed = await request(app)
            .patch(`/api/business/${fixtures.ownerA.businessA}/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ orderStatus: 'confirmed' });
        assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
        assert.equal(confirmed.body.data.order_status, 'confirmed');
        assert.ok(confirmed.body.data.confirmed_at);

        const illegalJump = await request(app)
            .patch(`/api/business/${fixtures.ownerA.businessA}/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ orderStatus: 'completed' });
        assert.equal(illegalJump.status, 400);

        const inProgress = await request(app)
            .patch(`/api/business/${fixtures.ownerA.businessA}/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ orderStatus: 'in_progress' });
        assert.equal(inProgress.status, 200, JSON.stringify(inProgress.body));
    });

    it('requires location consent for delivery and calculates the configured fee server-side', async () => {
        await adminPool.query(
            'UPDATE businesses SET delivery_enabled = TRUE, delivery_fee = 7.5 WHERE business_id = $1',
            [fixtures.ownerA.businessA],
        );
        const product = await request(app)
            .post(`/api/business/${fixtures.ownerA.businessA}/products`)
            .set('Authorization', 'Bearer ' + fixtures.ownerA.token)
            .send({ productName: 'Delivery Test Item', price: 20, stockQuantity: 5, status: 'active' });
        assert.equal(product.status, 201, JSON.stringify(product.body));
        const productId = Number(product.body.data.product_id);

        const withoutConsent = await request(app)
            .post('/api/orders')
            .set('Authorization', 'Bearer ' + fixtures.customer.token)
            .send({
                businessId: fixtures.ownerA.businessA,
                items: [{ productId }],
                deliveryRequested: true,
                locationConsent: false,
                deliveryLatitude: 2.05,
                deliveryLongitude: 45.32,
                customerPhone: '+252612345678',
            });
        assert.equal(withoutConsent.status, 400);

        const deliveredByRequest = await request(app)
            .post('/api/orders')
            .set('Authorization', 'Bearer ' + fixtures.customer.token)
            .send({
                businessId: fixtures.ownerA.businessA,
                items: [{ productId }],
                deliveryRequested: true,
                locationConsent: true,
                deliveryLatitude: 2.05,
                deliveryLongitude: 45.32,
                deliveryNote: 'Near the main road',
                customerPhone: '+252612345678',
                deliveryFee: 0,
            });
        assert.equal(deliveredByRequest.status, 201, JSON.stringify(deliveredByRequest.body));
        assert.equal(Number(deliveredByRequest.body.data.delivery_fee), 7.5);
        assert.equal(Number(deliveredByRequest.body.data.total_amount), 27.5);
        assert.equal(deliveredByRequest.body.data.location_consent, true);
        assert.equal(deliveredByRequest.body.data.delivery_latitude, '2.050000');
        assert.deepEqual(deliveredByRequest.body.data.status_history.map(
            (entry: { status: string }) => entry.status,
        ), ['pending']);

        const orderId = deliveredByRequest.body.data.order_id as string;
        const cancelled = await request(app)
            .post(`/api/orders/mine/${orderId}/cancel`)
            .set('Authorization', 'Bearer ' + fixtures.customer.token)
            .send({});
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.data.delivery_latitude, null);
        assert.equal(cancelled.body.data.delivery_longitude, null);
        assert.deepEqual(cancelled.body.data.status_history.map(
            (entry: { status: string }) => entry.status,
        ), ['pending', 'cancelled']);
    });

    it('accepts product feedback only from customers with a completed purchase', async () => {
        const productResponse = await request(app)
            .post(`/api/business/${fixtures.ownerA.businessA}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({
                productName: 'Feedback Product',
                description: 'Test product description',
                ingredients: 'Water, natural extract',
                price: 10,
                currency: 'USD',
                stockQuantity: 4,
                status: 'active',
            });
        assert.equal(productResponse.status, 201, JSON.stringify(productResponse.body));
        const productId = productResponse.body.data.product_id as string;
        assert.equal(productResponse.body.data.ingredients, 'Water, natural extract');

        const orderResult = await adminPool.query<{ order_id: string }>(
            `INSERT INTO orders (business_id, customer_id, order_status, subtotal, total_amount, completed_at)
             VALUES ($1, $2, 'completed', 10, 10, now()) RETURNING order_id`,
            [fixtures.ownerA.businessA, fixtures.customer.id],
        );
        const orderId = orderResult.rows[0]!.order_id;
        await adminPool.query(
            `INSERT INTO order_items
                (order_id, business_id, product_id, item_type, item_name, quantity, unit_price, total_price)
             VALUES ($1, $2, $3, 'product', 'Feedback Product', 1, 10, 10)`,
            [orderId, fixtures.ownerA.businessA, productId],
        );

        const eligibility = await request(app)
            .get(`/api/product-reviews/eligibility/${productId}`)
            .set('Authorization', `Bearer ${fixtures.customer.token}`);
        assert.equal(eligibility.status, 200, JSON.stringify(eligibility.body));
        assert.equal(eligibility.body.data.eligible, true);
        assert.equal(eligibility.body.data.is_member, false);

        const ownerEligibility = await request(app)
            .get(`/api/product-reviews/eligibility/${productId}`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`);
        assert.equal(ownerEligibility.status, 200, JSON.stringify(ownerEligibility.body));
        assert.equal(ownerEligibility.body.data.eligible, false);
        assert.equal(ownerEligibility.body.data.is_member, true);

        const review = await request(app)
            .post('/api/product-reviews')
            .set('Authorization', `Bearer ${fixtures.customer.token}`)
            .send({
                productId: Number(productId),
                orderId: Number(orderId),
                rating: 5,
                reviewText: 'Exactly as described',
            });
        assert.equal(review.status, 201, JSON.stringify(review.body));
        assert.equal(review.body.data.status, 'pending');

        const hiddenUntilApproved = await request(app).get(`/api/product-reviews?productId=${productId}`);
        assert.equal(hiddenUntilApproved.body.data.length, 0);

        const unpurchased = await request(app)
            .post('/api/product-reviews')
            .set('Authorization', `Bearer ${fixtures.ownerB.token}`)
            .send({ productId: Number(productId), orderId: Number(orderId), rating: 4 });
        assert.equal(unpurchased.status, 400);

        const published = await request(app)
            .patch(`/api/business/${fixtures.ownerA.businessA}/product-reviews/${review.body.data.product_review_id}/moderate`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ status: 'published' });
        assert.equal(published.status, 200, JSON.stringify(published.body));

        const response = await request(app)
            .post(`/api/business/${fixtures.ownerA.businessA}/product-reviews/${review.body.data.product_review_id}/respond`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ response: 'Thank you for your feedback.' });
        assert.equal(response.status, 200, JSON.stringify(response.body));

        const visible = await request(app).get(`/api/product-reviews?productId=${productId}`);
        assert.equal(visible.status, 200);
        assert.equal(visible.body.data.length, 1);
        assert.equal(visible.body.data[0].review_text, 'Exactly as described');
        assert.equal(visible.body.data[0].author_name, 'Customer');
        assert.equal(visible.body.data[0].business_response, 'Thank you for your feedback.');
        const updatedProduct = await request(app).get(`/api/products?businessId=${fixtures.ownerA.businessA}`);
        const ratedProduct = updatedProduct.body.data.find((item: { product_id: string }) => item.product_id === productId);
        assert.equal(ratedProduct.rating_count, 1);
        assert.equal(Number(ratedProduct.rating_avg), 5);
    });
});

// ---------------------------------------------------------------------------
// Test 7 - a business can have many branches
// ---------------------------------------------------------------------------
describe('Test 7: A business can have multiple locations', () => {
    it('creates and lists three branches under the same business', async () => {
        const { businessA } = fixtures.ownerA;
        for (const name of ['Main Branch', 'North Branch', 'Airport Branch']) {
            const res = await request(app)
                .post(`/api/business/${businessA}/locations`)
                .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
                .send({ locationName: name, address: 'Some street', city: 'Damascus' });
            assert.equal(res.status, 201);
            assert.equal(Number(res.body.data.business_id), businessA);
        }

        const list = await request(app)
            .get(`/api/business/${businessA}/locations`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`);
        assert.equal(list.body.data.length, 3);
        assert.ok(list.body.data.every((l: { business_id: string }) => Number(l.business_id) === businessA));
    });
});

// ---------------------------------------------------------------------------
// Test 8 - two businesses may share a name
// ---------------------------------------------------------------------------
describe('Test 8: Two businesses can have the same name', () => {
    it('stores both, keeps slugs unique, and keeps their data separate', async () => {
        const { rows } = await adminPool.query<{ business_id: string; business_name: string; business_slug: string }>(
            'SELECT business_id, business_name, business_slug FROM businesses WHERE business_name = $1 ORDER BY business_id',
            ['ABC Clinic'],
        );
        assert.equal(rows.length, 2);
        assert.notEqual(rows[0]!.business_slug, rows[1]!.business_slug);

        const createdA = await request(app)
            .post(`/api/business/${fixtures.ownerA.businessA}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`)
            .send({ productName: 'Same Name Product A', price: 10, status: 'active' });
        const createdB = await request(app)
            .post(`/api/business/${fixtures.ownerB.businessB}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerB.token}`)
            .send({ productName: 'Same Name Product B', price: 20, status: 'active' });
        assert.equal(createdA.status, 201);
        assert.equal(createdB.status, 201);

        const listA = await request(app)
            .get(`/api/business/${fixtures.ownerA.businessA}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerA.token}`);
        const listB = await request(app)
            .get(`/api/business/${fixtures.ownerB.businessB}/products`)
            .set('Authorization', `Bearer ${fixtures.ownerB.token}`);

        assert.ok(listA.body.data.some((p: { product_name: string }) => p.product_name === 'Same Name Product A'));
        assert.ok(listA.body.data.every((p: { product_name: string }) => p.product_name !== 'Same Name Product B'));
        assert.ok(listB.body.data.some((p: { product_name: string }) => p.product_name === 'Same Name Product B'));
        assert.ok(listB.body.data.every((p: { product_name: string }) => p.product_name !== 'Same Name Product A'));
    });
});
