process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool, PoolClient } from 'pg';

let adminPool: Pool;
let closePools: () => Promise<void>;
let withTenant: typeof import('../src/db/tenant.js').withTenant;
let businessContext: typeof import('../src/db/tenant.js').businessContext;
let enqueueNewOrderEmail: typeof import('../src/modules/notifications/email-outbox.repository.js').enqueueNewOrderEmail;
let enqueueOrderStatusEmail: typeof import('../src/modules/notifications/email-outbox.repository.js').enqueueOrderStatusEmail;
let updateOrderStatus: typeof import('../src/modules/orders/order.repository.js').updateOrderStatus;
let SmtpEmailAdapter: typeof import('../src/modules/notifications/email-adapter.js').SmtpEmailAdapter;
let ownerId: number;
let customerId: number;
let businessId: number;
let orderId: number;

before(async () => {
    const pools = await import('../src/db/pool.js');
    adminPool = (await import('../src/db/admin-pool.js')).adminPool;
    closePools = pools.closePools;
    const tenant = await import('../src/db/tenant.js');
    withTenant = tenant.withTenant;
    businessContext = tenant.businessContext;
    const outbox = await import('../src/modules/notifications/email-outbox.repository.js');
    enqueueNewOrderEmail = outbox.enqueueNewOrderEmail;
    enqueueOrderStatusEmail = outbox.enqueueOrderStatusEmail;
    updateOrderStatus = (await import('../src/modules/orders/order.repository.js')).updateOrderStatus;
    SmtpEmailAdapter = (await import('../src/modules/notifications/email-adapter.js')).SmtpEmailAdapter;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const { rows: users } = await adminPool.query<{ user_id: string }>(`
        INSERT INTO public.users (email, password_hash, full_name, status, email_verified_at)
        VALUES ('email-outbox-owner@hq.test', 'test-hash', 'Outbox Owner', 'active', now()),
               ('email-outbox-customer@hq.test', 'test-hash', 'Outbox Customer', 'active', now())
        RETURNING user_id
    `);
    ownerId = Number(users[0]!.user_id);
    customerId = Number(users[1]!.user_id);
    const { rows: businesses } = await adminPool.query<{ business_id: string }>(`
        INSERT INTO public.businesses
            (business_name, business_slug, phone, email, city, district, status,
             verification_status, is_verified, verified_at)
        VALUES ('Outbox Event Shop', 'outbox-event-shop', '+15550001111', 'shop@hq.test',
                'Test City', 'Test District', 'active', 'verified', true, now())
        RETURNING business_id
    `);
    businessId = Number(businesses[0]!.business_id);
    await adminPool.query(`
        INSERT INTO public.business_users (business_id, user_id, role_id, status, joined_at)
        SELECT $1, $2, role_id, 'active', now() FROM public.roles
         WHERE role_key = 'business_owner' AND scope = 'business'
    `, [businessId, ownerId]);
    const { rows: orders } = await adminPool.query<{ order_id: string }>(`
        INSERT INTO public.orders
            (order_number, business_id, customer_id, order_status, subtotal, total_amount,
             currency, notification_language)
        VALUES ('OUTBOX-EVENT-1', $1, $2, 'pending', 12.5, 12.5, 'USD', 'so')
        RETURNING order_id
    `, [businessId, customerId]);
    orderId = Number(orders[0]!.order_id);
});

after(async () => { await closePools?.(); });

async function worker<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await adminPool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE hq_notification_worker');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally { client.release(); }
}

describe('transactional marketplace email events', () => {
    it('resolves a verified business owner and deduplicates repeated order-created processing', async () => {
        const ids = await withTenant(businessContext(customerId, businessId), async (client) => [
            await enqueueNewOrderEmail(client, String(orderId)),
            await enqueueNewOrderEmail(client, String(orderId)),
        ]);
        assert.ok(ids[0]);
        assert.equal(ids[1], ids[0]);
        const { rows } = await adminPool.query<{
            recipient_user_id: string; locale: string; payload: Record<string, unknown>;
        }>(`SELECT recipient_user_id, locale, payload
              FROM notification_private.notification_outbox
             WHERE outbox_id = $1`, [ids[0]]);
        assert.equal(Number(rows[0]!.recipient_user_id), ownerId);
        assert.equal(rows[0]!.locale, 'en');
        const { rows: actualOrder } = await adminPool.query<{ order_number: string }>(
            'SELECT order_number FROM public.orders WHERE order_id = $1', [orderId],
        );
        assert.deepEqual(rows[0]!.payload, { order_number: actualOrder[0]!.order_number, business_name: 'Outbox Event Shop' });
    });

    it('rolls the business status change and its email event back together', async () => {
        await assert.rejects(withTenant(businessContext(ownerId, businessId), async (client) => {
            const changed = await updateOrderStatus(client, businessId, orderId, 'confirmed');
            await enqueueOrderStatusEmail(client, String(businessId), changed.order_id);
            throw new Error('force rollback for integration test');
        }), /force rollback for integration test/);

        const { rows } = await adminPool.query<{ order_status: string; count: string }>(`
            SELECT o.order_status,
                   (SELECT count(*)::text FROM notification_private.notification_outbox n
                     WHERE n.order_id = o.order_id AND n.event_type = 'order.status_changed') AS count
              FROM public.orders AS o WHERE o.order_id = $1
        `, [orderId]);
        assert.equal(rows[0]!.order_status, 'pending');
        assert.equal(rows[0]!.count, '0');
    });

    it('enqueues a distinct status transition once using the customer language', async () => {
        const id = await withTenant(businessContext(ownerId, businessId), async (client) => {
            const changed = await updateOrderStatus(client, businessId, orderId, 'confirmed');
            return enqueueOrderStatusEmail(client, String(businessId), changed.order_id);
        });
        assert.ok(id);
        const retryId = await withTenant(businessContext(ownerId, businessId), (client) =>
            enqueueOrderStatusEmail(client, String(businessId), String(orderId)));
        assert.equal(retryId, id);
        const { rows } = await adminPool.query<{ recipient_user_id: string; locale: string; payload: Record<string, unknown>; count: string }>(`
            SELECT recipient_user_id, locale, payload, count(*) OVER ()::text AS count
              FROM notification_private.notification_outbox
             WHERE order_id = $1 AND event_type = 'order.status_changed'
        `, [orderId]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.count, '1');
        assert.equal(Number(rows[0]!.recipient_user_id), customerId);
        assert.equal(rows[0]!.locale, 'so');
        const { rows: actualOrder } = await adminPool.query<{ order_number: string }>(
            'SELECT order_number FROM public.orders WHERE order_id = $1', [orderId],
        );
        assert.deepEqual(rows[0]!.payload, { order_number: actualOrder[0]!.order_number, status: 'confirmed' });
    });

    it('does not resolve or send to a customer whose email is currently unverified', async () => {
        const { rows: event } = await adminPool.query<{ outbox_id: string }>(
            `SELECT outbox_id FROM notification_private.notification_outbox
              WHERE order_id = $1 AND event_type = 'order.status_changed'`, [orderId],
        );
        await adminPool.query(`
            UPDATE notification_private.notification_outbox
               SET status = 'sent', sent_at = now()
             WHERE order_id = $1 AND event_type = 'order.created' AND status = 'pending'
        `, [orderId]);
        await adminPool.query('UPDATE public.users SET email_verified_at = NULL WHERE user_id = $1', [customerId]);
        const claimed = await worker(async (client) => {
            const result = await client.query<{ outbox_id: string; lease_token: string }>(
                'SELECT outbox_id, lease_token FROM notification_api.claim_email_batch(1, 120)',
            );
            const matching = result.rows.find((row) => row.outbox_id === event[0]!.outbox_id);
            if (!matching) throw new Error('status notification was not claimable');
            const resolution = await client.query(
                'SELECT * FROM notification_api.resolve_email_recipient($1, $2)',
                [matching.outbox_id, matching.lease_token],
            );
            return resolution.rows.length;
        });
        assert.equal(claimed, 0);
    });

    it('skips a missing or unverified merchant recipient without exposing a contact fallback', async () => {
        const { rows: unverifiedOwner } = await adminPool.query<{ user_id: string }>(`
            INSERT INTO public.users (email, password_hash, full_name, status)
            VALUES ('email-outbox-unverified@hq.test', 'test-hash', 'Unverified Owner', 'active')
            RETURNING user_id
        `);
        const { rows: businesses } = await adminPool.query<{ business_id: string }>(`
            INSERT INTO public.businesses
                (business_name, business_slug, phone, email, city, district, status,
                 verification_status, is_verified, verified_at)
            VALUES ('No Verified Owner Shop', 'no-verified-owner-shop', '+15550002222',
                    'contact-fallback@hq.test', 'Test City', 'Test District',
                    'active', 'verified', true, now()) RETURNING business_id
        `);
        const unverifiedBusinessId = Number(businesses[0]!.business_id);
        await adminPool.query(`
            INSERT INTO public.business_users (business_id, user_id, role_id, status, joined_at)
            SELECT $1, $2, role_id, 'active', now() FROM public.roles
             WHERE role_key = 'business_owner' AND scope = 'business'
        `, [unverifiedBusinessId, unverifiedOwner[0]!.user_id]);
        const { rows: orders } = await adminPool.query<{ order_id: string }>(`
            INSERT INTO public.orders
                (business_id, customer_id, order_status, subtotal, total_amount, currency)
            VALUES ($1, $2, 'pending', 3, 3, 'USD') RETURNING order_id
        `, [unverifiedBusinessId, customerId]);
        const id = await withTenant(businessContext(customerId, unverifiedBusinessId), (client) =>
            enqueueNewOrderEmail(client, orders[0]!.order_id));
        assert.equal(id, null);
        const { rows: leaked } = await adminPool.query<{ count: string }>(`
            SELECT count(*)::text AS count FROM notification_private.notification_outbox
             WHERE order_id = $1
        `, [orders[0]!.order_id]);
        assert.equal(leaked[0]!.count, '0');

        const { rows: noOwnerBusinesses } = await adminPool.query<{ business_id: string }>(`
            INSERT INTO public.businesses
                (business_name, business_slug, phone, email, city, district, status,
                 verification_status, is_verified, verified_at)
            VALUES ('Ownerless Shop', 'ownerless-shop', '+15550003333', 'ownerless@hq.test',
                    'Test City', 'Test District', 'active', 'verified', true, now())
            RETURNING business_id
        `);
        const { rows: noOwnerOrders } = await adminPool.query<{ order_id: string }>(`
            INSERT INTO public.orders
                (business_id, customer_id, order_status, subtotal, total_amount, currency)
            VALUES ($1, $2, 'pending', 4, 4, 'USD') RETURNING order_id
        `, [noOwnerBusinesses[0]!.business_id, customerId]);
        const noOwnerId = await withTenant(businessContext(customerId, Number(noOwnerBusinesses[0]!.business_id)),
            (client) => enqueueNewOrderEmail(client, noOwnerOrders[0]!.order_id));
        assert.equal(noOwnerId, null);

        const { rows: historicalOwner } = await adminPool.query<{ user_id: string }>(`
            INSERT INTO public.users (email, password_hash, full_name, status, email_verified_at)
            VALUES ('email-outbox-inactive-owner@hq.test', 'test-hash', 'Historical Owner', 'active', now())
            RETURNING user_id
        `);
        const { rows: inactiveBusinesses } = await adminPool.query<{ business_id: string }>(`
            INSERT INTO public.businesses
                (business_name, business_slug, phone, email, city, district, status,
                 verification_status, is_verified, verified_at)
            VALUES ('Historical Owner Shop', 'historical-owner-shop', '+15550004444', 'history@hq.test',
                    'Test City', 'Test District', 'active', 'verified', true, now()) RETURNING business_id
        `);
        const inactiveBusinessId = Number(inactiveBusinesses[0]!.business_id);
        await adminPool.query(`
            INSERT INTO public.business_users (business_id, user_id, role_id, status)
            SELECT $1, $2, role_id, 'removed' FROM public.roles
             WHERE role_key = 'business_owner' AND scope = 'business'
        `, [inactiveBusinessId, historicalOwner[0]!.user_id]);
        const { rows: inactiveOrders } = await adminPool.query<{ order_id: string }>(`
            INSERT INTO public.orders
                (business_id, customer_id, order_status, subtotal, total_amount, currency)
            VALUES ($1, $2, 'pending', 5, 5, 'USD') RETURNING order_id
        `, [inactiveBusinessId, customerId]);
        const inactiveOwnerId = await withTenant(businessContext(customerId, inactiveBusinessId), (client) =>
            enqueueNewOrderEmail(client, inactiveOrders[0]!.order_id));
        assert.equal(inactiveOwnerId, null, 'inactive historical owner must not be used');
        const { rows: inactiveOutbox } = await adminPool.query<{ count: string }>(`
            SELECT count(*)::text AS count FROM notification_private.notification_outbox WHERE order_id = $1
        `, [inactiveOrders[0]!.order_id]);
        assert.equal(inactiveOutbox[0]!.count, '0');
    });

    it('keeps the committed outbox record when the injected SMTP transport fails', async () => {
        const { rows: orders } = await adminPool.query<{ order_id: string }>(`
            INSERT INTO public.orders (business_id, customer_id, order_status, subtotal, total_amount, currency)
            VALUES ($1, $2, 'pending', 1, 1, 'USD') RETURNING order_id
        `, [businessId, customerId]);
        const id = await withTenant(businessContext(customerId, businessId), (client) =>
            enqueueNewOrderEmail(client, orders[0]!.order_id));
        const adapter = new SmtpEmailAdapter({
            transport: { async sendMail() { throw Object.assign(new Error('offline SMTP'), { code: 'ECONNREFUSED' }); } },
        });
        await assert.rejects(adapter.send({ to: 'owner@example.test', subject: 'New order', html: '<p>New order</p>', text: 'New order' }));
        const { rows } = await adminPool.query<{ status: string }>(
            'SELECT status FROM notification_private.notification_outbox WHERE outbox_id = $1', [id],
        );
        assert.equal(rows[0]!.status, 'pending');
    });
});
