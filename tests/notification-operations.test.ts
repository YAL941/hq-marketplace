process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import type { Pool, PoolClient } from 'pg';

let adminPool: Pool;
let closePools: () => Promise<void>;
let app: import('express').Express;
let adminToken: string;
let customerToken: string;
let adminId: number;
let customerId: number;
let ownerId: number;
let businessId: number;
let businessContext: typeof import('../src/db/tenant.js').businessContext;
let withTenant: typeof import('../src/db/tenant.js').withTenant;
let enqueueNewOrderEmail: typeof import('../src/modules/notifications/email-outbox.repository.js').enqueueNewOrderEmail;

before(async () => {
    const pools = await import('../src/db/pool.js');
    adminPool = (await import('../src/db/admin-pool.js')).adminPool;
    closePools = pools.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
    await adminPool.query('DELETE FROM notification_private.notification_worker_state');
    const tenant = await import('../src/db/tenant.js');
    businessContext = tenant.businessContext;
    withTenant = tenant.withTenant;
    enqueueNewOrderEmail = (await import('../src/modules/notifications/email-outbox.repository.js')).enqueueNewOrderEmail;
    const { createApp } = await import('../src/app.js');
    const { signAccessToken } = await import('../src/middleware/auth.js');
    app = createApp();

    const { rows: users } = await adminPool.query<{ user_id: string }>(`
        INSERT INTO public.users (email, password_hash, full_name, status, email_verified_at)
        VALUES ('ops-admin@hq.test', 'test-hash', 'Operations Admin', 'active', now()),
               ('ops-customer@hq.test', 'test-hash', 'Operations Customer', 'active', now()),
               ('ops-owner@hq.test', 'test-hash', 'Operations Owner', 'active', now())
        RETURNING user_id
    `);
    adminId = Number(users[0]!.user_id);
    customerId = Number(users[1]!.user_id);
    ownerId = Number(users[2]!.user_id);
    await adminPool.query(`
        INSERT INTO public.user_platform_roles (user_id, role_id)
        SELECT $1, role_id FROM public.roles WHERE role_key = 'platform_admin' AND scope = 'platform'
    `, [adminId]);
    adminToken = signAccessToken({ id: adminId, email: null, isPlatformAdmin: true, token_version: 0 });
    customerToken = signAccessToken({ id: customerId, email: null, isPlatformAdmin: false, token_version: 0 });

    const { rows: businesses } = await adminPool.query<{ business_id: string }>(`
        INSERT INTO public.businesses
            (business_name, business_slug, phone, email, city, district, status,
             verification_status, is_verified, verified_at)
        VALUES ('Notification Ops Shop', 'notification-ops-shop', '+15550005555', 'shop-ops@hq.test',
                'Test City', 'Test District', 'active', 'verified', true, now())
        RETURNING business_id
    `);
    businessId = Number(businesses[0]!.business_id);
    await adminPool.query(`
        INSERT INTO public.business_users (business_id, user_id, role_id, status, joined_at)
        SELECT $1, $2, role_id, 'active', now() FROM public.roles
         WHERE role_key = 'business_owner' AND scope = 'business'
    `, [businessId, ownerId]);
});

after(async () => {
    // Tombstones are deliberately persistent in production; clear test-only keys
    // so another file reusing reset fixture IDs sees a clean isolated database.
    await adminPool?.query('DELETE FROM notification_private.notification_outbox_dedupe_tombstones').catch(() => undefined);
    await closePools?.();
});

async function createOrder(): Promise<string> {
    const { rows } = await adminPool.query<{ order_id: string }>(`
        INSERT INTO public.orders
            (business_id, customer_id, order_status, subtotal, total_amount, currency)
        VALUES ($1, $2, 'pending', 10, 10, 'USD') RETURNING order_id
    `, [businessId, customerId]);
    return rows[0]!.order_id;
}

async function enqueue(orderId: string): Promise<string> {
    const result = await withTenant(businessContext(customerId, businessId), (client) =>
        enqueueNewOrderEmail(client, orderId));
    assert.ok(result);
    return String(result);
}

async function worker<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await adminPool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE hq_notification_worker');
        const value = await run(client);
        await client.query('COMMIT');
        return value;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally { client.release(); }
}

describe('notification operational controls', () => {
    it('restricts queue health to platform admins and reports separate readiness', async () => {
        const anonymous = await request(app).get('/api/admin/notifications/health');
        assert.equal(anonymous.status, 401);
        const customer = await request(app).get('/api/admin/notifications/health')
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(customer.status, 403);

        await worker((client) => client.query('SELECT notification_api.worker_heartbeat(true, NULL, false)'));
        const admin = await request(app).get('/api/admin/notifications/health')
            .set('Authorization', `Bearer ${adminToken}`);
        assert.equal(admin.status, 200);
        assert.equal(admin.body.database_ready, true);
        assert.equal(admin.body.worker_liveness, 'alive');
        assert.equal(admin.body.smtp_configuration, 'configured');
        assert.equal(admin.body.delivery_ready, false);
        assert.equal(admin.body.smtp_delivery_state, 'unverified');
        for (const field of ['pending_count', 'processing_count', 'sent_count', 'dead_count', 'skipped_count',
            'oldest_pending_age_seconds', 'expired_lease_count', 'failure_code_counts', 'worker_heartbeat_age_seconds',
            'smtp_last_error_code', 'smtp_last_error_age_seconds', 'smtp_last_success_age_seconds']) {
            assert.ok(field in admin.body, `missing health field ${field}`);
        }
        assert.equal('recipient_email' in admin.body, false);
        assert.equal('payload' in admin.body, false);

        await worker((client) => client.query('SELECT notification_api.worker_heartbeat(true, NULL, true)'));
        const notReady = await request(app).get('/api/admin/notifications/health')
            .set('Authorization', `Bearer ${adminToken}`);
        assert.equal(notReady.body.worker_liveness, 'alive');
        assert.equal(notReady.body.smtp_configuration, 'configured');
        assert.equal(notReady.body.smtp_delivery_state, 'ready');
        assert.equal(notReady.body.delivery_ready, true);

        await worker((client) => client.query(
            "SELECT notification_api.worker_heartbeat(true, 'smtp_connection_failed', false)",
        ));
        const smtpFailed = await request(app).get('/api/admin/notifications/health')
            .set('Authorization', `Bearer ${adminToken}`);
        assert.equal(smtpFailed.body.smtp_delivery_state, 'failed');
        assert.equal(smtpFailed.body.smtp_last_error_code, 'smtp_connection_failed');
        assert.equal(smtpFailed.body.delivery_ready, false);

        await worker((client) => client.query('SELECT notification_api.worker_heartbeat(false, NULL, false)'));
        const smtpNotConfigured = await request(app).get('/api/admin/notifications/health')
            .set('Authorization', `Bearer ${adminToken}`);
        assert.equal(smtpNotConfigured.body.smtp_configuration, 'not_configured');
        assert.equal(smtpNotConfigured.body.delivery_ready, false);

        await adminPool.query(`UPDATE notification_private.notification_worker_state
            SET last_seen_at = now() - interval '2 minutes' WHERE singleton`);
        const stopped = await request(app).get('/api/admin/notifications/health')
            .set('Authorization', `Bearer ${adminToken}`);
        assert.equal(stopped.body.worker_liveness, 'stopped');
        assert.equal(stopped.body.smtp_configuration, 'unknown');
        assert.equal(stopped.body.delivery_ready, false);
        const { rows: healthAudit } = await adminPool.query<{ count: string }>(`
            SELECT count(*)::text AS count FROM notification_private.notification_admin_audit
             WHERE actor_user_id = $1 AND action = 'health_viewed'
        `, [adminId]);
        assert.ok(Number(healthAudit[0]!.count) >= 5);
    });

    it('audits dead-letter inspection, review and same-row retry without exposing private fields', async () => {
        const orderId = await createOrder();
        const id = await enqueue(orderId);
        await adminPool.query(`
            UPDATE notification_private.notification_outbox
               SET status = 'dead', attempt_count = max_attempts,
                   last_error_code = 'smtp_authentication_failed', updated_at = now()
             WHERE outbox_id = $1
        `, [id]);

        const anonymous = await request(app).get(`/api/admin/notifications/dead-letters/${id}`);
        assert.equal(anonymous.status, 401);
        const customer = await request(app).get(`/api/admin/notifications/dead-letters/${id}`)
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(customer.status, 403);

        const detail = await request(app).get(`/api/admin/notifications/dead-letters/${id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.data.status, 'dead');
        assert.equal(detail.body.data.last_error_code, 'smtp_authentication_failed');
        assert.equal('recipient_user_id' in detail.body.data, false);
        assert.equal('payload' in detail.body.data, false);
        assert.equal('email' in detail.body.data, false);

        const retryBeforeReview = await request(app).post(`/api/admin/notifications/dead-letters/${id}/retry`)
            .set('Authorization', `Bearer ${adminToken}`).send({ reason_code: 'provider_corrected' });
        assert.equal(retryBeforeReview.status, 409);
        const reviewed = await request(app).post(`/api/admin/notifications/dead-letters/${id}/review`)
            .set('Authorization', `Bearer ${adminToken}`).send({ reason_code: 'provider_corrected' });
        assert.equal(reviewed.status, 204);
        const retried = await request(app).post(`/api/admin/notifications/dead-letters/${id}/retry`)
            .set('Authorization', `Bearer ${adminToken}`).send({ reason_code: 'provider_corrected' });
        assert.equal(retried.status, 202);

        const { rows } = await adminPool.query<{ status: string; attempt_count: number; dedupe_key: string }>(
            'SELECT status, attempt_count, dedupe_key FROM notification_private.notification_outbox WHERE outbox_id = $1', [id],
        );
        assert.equal(rows[0]!.status, 'pending');
        assert.equal(rows[0]!.attempt_count, 0);
        const deduped = await withTenant(businessContext(customerId, businessId), (client) =>
            enqueueNewOrderEmail(client, orderId));
        assert.equal(deduped, id, 'event replay must return the existing retried record');

        const { rows: audit } = await adminPool.query<{ action: string; actor_user_id: string | null; reason_code: string | null }>(`
            SELECT action, actor_user_id, reason_code FROM notification_private.notification_admin_audit
             WHERE outbox_id = $1 ORDER BY audit_id
        `, [id]);
        assert.deepEqual(audit.map((row) => row.action), ['inspected', 'reviewed', 'retried']);
        assert.equal(Number(audit[1]!.actor_user_id), adminId);
        assert.equal(audit[2]!.reason_code, 'provider_corrected');
    });

    it('blocks worker administrative calls and direct hq_app access to private data', async () => {
        const [{ appPool }, { rows: workerRows }] = await Promise.all([
            import('../src/db/pool.js'),
            adminPool.query<{ can_use_admin_schema: boolean; can_read_outbox: boolean }>(`
                SELECT pg_catalog.has_schema_privilege('hq_notification_worker', 'notification_admin', 'USAGE') AS can_use_admin_schema,
                       pg_catalog.has_table_privilege('hq_notification_worker', 'notification_private.notification_outbox', 'SELECT') AS can_read_outbox
            `),
        ]);
        assert.equal(workerRows[0]!.can_use_admin_schema, false);
        assert.equal(workerRows[0]!.can_read_outbox, false);
        await assert.rejects(appPool.query('SELECT * FROM notification_private.notification_outbox'), /permission denied/);
        await assert.rejects(worker((client) => client.query('SELECT notification_admin.health_summary()')), /permission denied/);
    });

    it('refuses retry of an actively leased record', async () => {
        const id = await enqueue(await createOrder());
        await adminPool.query(`
            UPDATE notification_private.notification_outbox
               SET status = 'processing', lease_until = now() + interval '10 minutes',
                   lease_token = gen_random_uuid(), attempt_count = 1
             WHERE outbox_id = $1
        `, [id]);
        const result = await request(app).post(`/api/admin/notifications/dead-letters/${id}/retry`)
            .set('Authorization', `Bearer ${adminToken}`).send({ reason_code: 'manual_review' });
        assert.equal(result.status, 409);
        const { rows } = await adminPool.query<{ status: string }>(
            'SELECT status FROM notification_private.notification_outbox WHERE outbox_id = $1', [id],
        );
        assert.equal(rows[0]!.status, 'processing');
    });

    it('prunes only bounded terminal rows and keeps pending, processing, and dedupe tombstones', async () => {
        const sentOrderId = await createOrder();
        const sentId = await enqueue(sentOrderId);
        const deadId = await enqueue(await createOrder());
        const skippedId = await enqueue(await createOrder());
        const pendingId = await enqueue(await createOrder());
        const processingId = await enqueue(await createOrder());
        const expiredProcessingId = await enqueue(await createOrder());
        await adminPool.query(`UPDATE notification_private.notification_outbox SET status = 'sent',
            sent_at = now() - interval '100 days', updated_at = now() - interval '100 days' WHERE outbox_id = $1`, [sentId]);
        await adminPool.query(`UPDATE notification_private.notification_outbox SET status = 'dead',
            terminal_reviewed_at = now() - interval '181 days', updated_at = now() - interval '181 days' WHERE outbox_id = $1`, [deadId]);
        await adminPool.query(`UPDATE notification_private.notification_outbox SET status = 'skipped',
            last_error_code = 'recipient_unavailable', updated_at = now() - interval '181 days' WHERE outbox_id = $1`, [skippedId]);
        await adminPool.query(`UPDATE notification_private.notification_outbox SET created_at = now() - interval '200 days'
            WHERE outbox_id = $1`, [pendingId]);
        await adminPool.query(`UPDATE notification_private.notification_outbox SET status = 'processing',
            lease_until = now() + interval '10 minutes', lease_token = gen_random_uuid(),
            attempt_count = 1, created_at = now() - interval '200 days' WHERE outbox_id = $1`, [processingId]);
        await adminPool.query(`UPDATE notification_private.notification_outbox SET status = 'processing',
            lease_until = now() - interval '1 minute', lease_token = gen_random_uuid(),
            attempt_count = 1, created_at = now() - interval '200 days' WHERE outbox_id = $1`, [expiredProcessingId]);

        const expectedCounts = await adminPool.query<{ status: string; count: string }>(`
            SELECT status, count(*)::text AS count FROM notification_private.notification_outbox GROUP BY status
        `);
        const expectedByStatus = Object.fromEntries(expectedCounts.rows.map(({ status, count }) => [status, Number(count)]));
        const expectedAge = await adminPool.query<{ seconds: number; expired: string }>(`
            SELECT floor(date_part('epoch', now() - min(created_at) FILTER (WHERE status = 'pending')))::int AS seconds,
                   count(*) FILTER (WHERE status = 'processing' AND lease_until <= now())::text AS expired
              FROM notification_private.notification_outbox
             WHERE status = 'pending' OR status = 'processing'
        `);
        const summary = await request(app).get('/api/admin/notifications/health')
            .set('Authorization', `Bearer ${adminToken}`);
        assert.equal(summary.status, 200);
        assert.equal(summary.body.pending_count, expectedByStatus['pending'] ?? 0);
        assert.equal(summary.body.processing_count, expectedByStatus['processing'] ?? 0);
        assert.equal(summary.body.sent_count, expectedByStatus['sent'] ?? 0);
        assert.equal(summary.body.dead_count, expectedByStatus['dead'] ?? 0);
        assert.equal(summary.body.skipped_count, expectedByStatus['skipped'] ?? 0);
        assert.ok(Math.abs(summary.body.oldest_pending_age_seconds - expectedAge.rows[0]!.seconds) <= 2);
        assert.equal(summary.body.expired_lease_count, Number(expectedAge.rows[0]!.expired));
        assert.ok(summary.body.failure_code_counts.recipient_unavailable >= 1);

        let deleted = 0;
        for (let i = 0; i < 3; i++) {
            const response = await request(app).post('/api/admin/notifications/retention/prune')
                .set('Authorization', `Bearer ${adminToken}`).send({ limit: 1 });
            assert.equal(response.status, 200);
            assert.ok(response.body.deleted_count <= 1);
            deleted += response.body.deleted_count;
        }
        assert.equal(deleted, 3);
        const { rows } = await adminPool.query<{ outbox_id: string; status: string }>(`
            SELECT outbox_id, status FROM notification_private.notification_outbox
             WHERE outbox_id = ANY($1::bigint[]) ORDER BY outbox_id
        `, [[pendingId, processingId, expiredProcessingId]]);
        assert.deepEqual(rows.map((row) => row.status), ['pending', 'processing', 'processing']);
        const { rows: tombstone } = await adminPool.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM notification_private.notification_outbox_dedupe_tombstones',
        );
        assert.equal(Number(tombstone[0]!.count), 3);
        const replay = await withTenant(businessContext(customerId, businessId), (client) =>
            enqueueNewOrderEmail(client, sentOrderId));
        assert.equal(replay, null, 'a deleted event remains deduplicated by its tombstone');
        const { rows: deletionAudit } = await adminPool.query<{ count: string }>(`
            SELECT count(*)::text AS count FROM notification_private.notification_admin_audit
             WHERE action = 'retention_deleted' AND affected_count = 1
        `);
        assert.equal(deletionAudit[0]!.count, '3');
    });
});
