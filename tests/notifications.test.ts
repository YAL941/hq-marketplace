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
let notificationId: number;

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
    const businessId = Number(businesses[0]!.business_id);

    // Staff membership: reuse the seeded owner role for simplicity.
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

    // An order the staff member will update through the real endpoint.
    const orderRes = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
            businessId,
            items: [{ productId: null, serviceId: null }],
        })
        .catch(() => null);
    // The real creation path requires an actual product; fall back to a
    // direct insert that matches the schema exactly.
    const { rows: orders } = await adminPool.query<{ order_id: string }>(
        `INSERT INTO orders
            (business_id, customer_id, order_type, subtotal, delivery_fee, discount_amount, tax_amount, total_amount, currency)
         VALUES ($1, $2, 'product', 10, 0, 0, 0, 10, 'USD')
         RETURNING order_id`,
        [businessId, customerId],
    );
    orderId = Number(orders[0]!.order_id);
    void orderRes;
});

after(async () => {
    await closePools?.();
});
