/**
 * Stock taken when an order is created must come back when the order is
 * cancelled or rejected, exactly once, and must stay taken for a completed
 * order. The restocking itself is a database trigger (migration 030), so these
 * tests go through the real HTTP routes against the real database.
 */

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

let businessId: number;
let ownerToken: string;
let customerToken: string;

async function createUser(email: string, fullName: string): Promise<number> {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const { rows } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active') RETURNING user_id`,
        [email, passwordHash, fullName],
    );
    return Number(rows[0]!.user_id);
}

async function login(email: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.data.token as string;
}

before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const ownerId = await createUser('stock-owner@hq.test', 'Stock Owner');
    await createUser('stock-customer@hq.test', 'Stock Customer');

    const { rows } = await adminPool.query<{ business_id: string }>(
        `INSERT INTO businesses
            (business_name, business_slug, business_description, phone, email, city, district,
             status, verification_status, is_verified, verified_at)
         VALUES ('Stock Shop', 'stock-shop', 'Stock Shop description', '+9630000002', 'stock-shop@hq.test',
                 'Damascus', 'Central', 'active', 'verified', true, now())
         RETURNING business_id`,
    );
    businessId = Number(rows[0]!.business_id);
    const { rows: roleRows } = await adminPool.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business'`,
    );
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [businessId, ownerId, roleRows[0]!.role_id],
    );

    ownerToken = await login('stock-owner@hq.test');
    customerToken = await login('stock-customer@hq.test');
});

after(async () => {
    await closePools?.();
});

async function createProduct(name: string, stock: number): Promise<number> {
    const res = await request(app)
        .post(`/api/business/${businessId}/products`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ productName: name, price: 10, currency: 'USD', stockQuantity: stock, status: 'active' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return Number(res.body.data.product_id);
}

async function stockOf(productId: number): Promise<number> {
    const { rows } = await adminPool.query<{ stock_quantity: number }>(
        'SELECT stock_quantity FROM products WHERE product_id = $1',
        [productId],
    );
    return Number(rows[0]!.stock_quantity);
}

async function placeOrder(items: Array<{ productId: number; quantity: number }>): Promise<number> {
    const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ businessId, items });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return Number(res.body.data.order_id);
}

async function setStatus(orderId: number, orderStatus: string): Promise<void> {
    const res = await request(app)
        .patch(`/api/business/${businessId}/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ orderStatus });
    assert.equal(res.status, 200, JSON.stringify(res.body));
}

describe('Stock is returned when an order does not go ahead', () => {
    it('gives the stock back when the customer cancels, and only once', async () => {
        const productId = await createProduct('Cancel Me', 5);
        const orderId = await placeOrder([{ productId, quantity: 2 }]);
        assert.equal(await stockOf(productId), 3);

        const cancel = await request(app)
            .post(`/api/orders/mine/${orderId}/cancel`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ reason: 'changed my mind' });
        assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
        assert.equal(await stockOf(productId), 5);

        const again = await request(app)
            .post(`/api/orders/mine/${orderId}/cancel`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({});
        assert.equal(again.status, 403);
        assert.equal(await stockOf(productId), 5, 'a second cancel must not add stock again');
    });

    it('gives the stock back when the business rejects a pending order', async () => {
        const productId = await createProduct('Reject Me', 4);
        const orderId = await placeOrder([{ productId, quantity: 3 }]);
        assert.equal(await stockOf(productId), 1);

        await setStatus(orderId, 'rejected');
        assert.equal(await stockOf(productId), 4);
    });

    it('gives the stock back when the business cancels a confirmed order', async () => {
        const productId = await createProduct('Cancel Later', 6);
        const orderId = await placeOrder([{ productId, quantity: 4 }]);
        assert.equal(await stockOf(productId), 2);

        await setStatus(orderId, 'confirmed');
        assert.equal(await stockOf(productId), 2, 'confirming an order does not change stock');
        await setStatus(orderId, 'cancelled');
        assert.equal(await stockOf(productId), 6);
    });

    it('returns every line of an order with several products', async () => {
        const first = await createProduct('Line One', 5);
        const second = await createProduct('Line Two', 8);
        const orderId = await placeOrder([
            { productId: first, quantity: 2 },
            { productId: second, quantity: 5 },
        ]);
        assert.equal(await stockOf(first), 3);
        assert.equal(await stockOf(second), 3);

        await setStatus(orderId, 'rejected');
        assert.equal(await stockOf(first), 5);
        assert.equal(await stockOf(second), 8);
    });

    it('keeps the stock taken for an order that was completed', async () => {
        const productId = await createProduct('Sold For Real', 5);
        const orderId = await placeOrder([{ productId, quantity: 2 }]);
        for (const status of ['confirmed', 'in_progress', 'ready', 'completed']) {
            await setStatus(orderId, status);
        }
        assert.equal(await stockOf(productId), 3);
    });
});
