/**
 * Order-status notifications, tested through the real API and the real
 * trigger. The scenarios this file pins down:
 *
 *   * the trigger exists: a staff status change creates a notification
 *     for the customer, without any application code calling it;
 *   * the payload carries what the frontend needs to render the badge:
 *     order number, from/to status and the business id;
 *   * RLS is the filter: user A never sees user B's notifications, not
 *     even by guessing the id, and cannot mark them read;
 *   * a status update to the same status creates nothing (the trigger
 *     compares old and new, not just "an UPDATE happened");
 *   * read-all and mark-one-read keep the unread count honest.
 */

process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';

const assert: typeof assertModule = assertModule;

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;

let customerToken: string;
let staffToken: string;
let outsiderToken: string;
let orderId: number;
let businessId: number;

before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;

    const { prepareTestDatabase, TEST_TABLES } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool, {
        truncate: ['user_notifications', ...TEST_TABLES],
    });

    // Three users: the customer, the business owner (staff), an outsider.
    const { rows: users } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ('notif-customer@hq.test', 'unused', 'Notif Customer', 'active'),
                ('notif-staff@hq.test',     'unused', 'Notif Staff',     'active'),
                ('notif-outsider@hq.test',  'unused', 'Notif Outsider',  'active')
         RETURNING user_id`,
    );
    const [customerId, staffId, outsiderId] = users.map((u) => Number(u.user_id));

    const { rows: businesses } = await adminPool.query<{ business_id: string }>(
        `INSERT INTO businesses
            (business_name, business_slug, address, status, verification_status, is_verified, verified_at)
         VALUES ('Notif Test Shop', 'notif-test-shop', 'Test address', 'active', 'verified', TRUE, now())
         RETURNING business_id`,
    );
    businessId = Number(businesses[0]!.business_id);

    // Staff membership with the seeded owner role.
    const { rows: roles } = await adminPool.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_key = 'business_owner'`,
    );
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [businessId, staffId, Number(roles[0]!.role_id)],
    );

    const { signAccessToken } = await import('../src/middleware/auth.js');
    customerToken = signAccessToken({ id: customerId, email: 'notif-customer@hq.test', isPlatformAdmin: false });
    staffToken = signAccessToken({ id: staffId, email: 'notif-staff@hq.test', isPlatformAdmin: false });
    outsiderToken = signAccessToken({ id: outsiderId, email: 'notif-outsider@hq.test', isPlatformAdmin: false });

    // A pending order placed directly (fixtures are seeded per-file, and the
    // POST /api/orders path needs a real catalogue to copy prices from).
    const { rows: orders } = await adminPool.query<{ order_id: string }>(
        `INSERT INTO orders
            (business_id, customer_id, order_type, subtotal, delivery_fee, discount_amount, tax_amount, total_amount, currency)
         VALUES ($1, $2, 'product', 10, 0, 0, 0, 10, 'USD')
         RETURNING order_id`,
        [businessId, customerId],
    );
    orderId = Number(orders[0]!.order_id);
});

after(async () => {
    await closePools?.();
});

describe('order-status notifications', () => {
    it('is created by a staff status change, with the payload the UI needs', async () => {
        const patched = await request(app)
            .patch(`/api/business/${businessId}/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ orderStatus: 'confirmed' });
        assert.equal(patched.status, 200, `staff PATCH failed: ${JSON.stringify(patched.body)}`);

        const listed = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(listed.status, 200);
        assert.equal(listed.body.meta.unreadCount, 1);
        assert.equal(listed.body.data.length, 1);

        const first = listed.body.data[0];
        assert.equal(first.notification_type, 'order_status');
        assert.equal(first.is_read, false);
        assert.equal(first.payload.toStatus, 'confirmed');
        assert.equal(first.payload.fromStatus, 'pending');
        assert.equal(first.payload.businessId, businessId);
        assert.ok(first.payload.orderNumber, 'payload carries the order number');
    });

    it('is invisible to another user: RLS is the filter', async () => {
        const listed = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${outsiderToken}`);
        assert.equal(listed.status, 200);
        assert.equal(listed.body.data.length, 0);
        assert.equal(listed.body.meta.unreadCount, 0);
    });

    it('cannot be marked read by another user, even by id', async () => {
        const listed = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${customerToken}`);
        const id = listed.body.data[0].notification_id;

        const foreign = await request(app)
            .patch(`/api/notifications/${id}/read`)
            .set('Authorization', `Bearer ${outsiderToken}`);
        assert.equal(foreign.status, 404, 'RLS must hide the row, and a hidden row is not found');
    });

    it('is not created when the status does not actually change', async () => {
        const before = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${customerToken}`);
        const countBefore = before.body.data.length;

        // A no-op status update: the trigger compares OLD and NEW, so a
        // second PATCH to the same value must not notify anyone.
        const res = await request(app)
            .patch(`/api/business/${businessId}/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ orderStatus: 'confirmed' });
        assert.equal(res.status, 200, 're-confirming an order is still a valid staff action');

        const after = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(after.body.data.length, countBefore, 'no new notification for a no-op status');
    });

    it('supports mark-one-read and keeps the unread count honest', async () => {
        const listed = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${customerToken}`);
        const id = listed.body.data[0].notification_id;
        assert.equal(listed.body.meta.unreadCount, 1);

        const marked = await request(app)
            .patch(`/api/notifications/${id}/read`)
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(marked.status, 200);
        assert.equal(marked.body.data.is_read, true);
        assert.ok(marked.body.data.read_at);

        const after = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(after.body.meta.unreadCount, 0);

        // unreadOnly=true now hides the read row.
        const unreadOnly = await request(app)
            .get('/api/notifications?unreadOnly=true')
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(unreadOnly.body.data.length, 0);
    });

    it('supports read-all for every remaining row', async () => {
        // One more status change creates one more notification.
        const res = await request(app)
            .patch(`/api/business/${businessId}/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ orderStatus: 'in_progress' });
        assert.equal(res.status, 200);

        const before = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${customerToken}`);
        assert.ok(before.body.meta.unreadCount >= 1);

        const all = await request(app)
            .post('/api/notifications/read-all')
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(all.status, 200);
        assert.ok(all.body.data.updated >= 1);

        const after = await request(app)
            .get('/api/notifications')
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(after.body.meta.unreadCount, 0);
    });

    it('requires authentication on every endpoint', async () => {
        assert.equal((await request(app).get('/api/notifications')).status, 401);
        assert.equal((await request(app).patch('/api/notifications/1/read')).status, 401);
        assert.equal((await request(app).post('/api/notifications/read-all')).status, 401);
    });
});
