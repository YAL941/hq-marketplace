import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool, type PoolClient } from 'pg';

let adminPool: Pool;
let appPool: Pool;
let closePools: () => Promise<void>;
let ownerId: number;
let customerId: number;
let businessId: number;
let businessContext: (userId: number, businessId: number) => import('../src/db/tenant.js').TenantContext;
let withTenant: typeof import('../src/db/tenant.js').withTenant;

before(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
    const poolModule = await import('../src/db/pool.js');
    const tenantModule = await import('../src/db/tenant.js');
    businessContext = tenantModule.businessContext;
    withTenant = tenantModule.withTenant;
    adminPool = (await import('../src/db/admin-pool.js')).adminPool;
    appPool = poolModule.appPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const user = async (email: string, name: string): Promise<number> => {
        const { rows } = await adminPool.query<{ user_id: string }>(
            `INSERT INTO public.users (email, password_hash, full_name, status, email_verified_at)
             VALUES ($1, 'test-hash', $2, 'active', pg_catalog.now()) RETURNING user_id`, [email, name],
        );
        return Number(rows[0]!.user_id);
    };
    ownerId = await user(`outbox-owner-${Date.now()}@hq.test`, 'Outbox Owner');
    customerId = await user(`outbox-customer-${Date.now()}@hq.test`, 'Outbox Customer');
    const { rows: businesses } = await adminPool.query<{ business_id: string }>(
        `INSERT INTO public.businesses
            (business_name, business_slug, phone, email, city, district, status,
             verification_status, is_verified, verified_at)
         VALUES ('Outbox Test Business', $1, '+15550001111', $2, 'Test City', 'Test District',
                 'active', 'verified', true, pg_catalog.now()) RETURNING business_id`,
        [`outbox-test-${Date.now()}`, `business-${Date.now()}@hq.test`],
    );
    businessId = Number(businesses[0]!.business_id);
    await adminPool.query(
        `INSERT INTO public.business_users (business_id, user_id, role_id, status, joined_at)
         SELECT $1, $2, role_id, 'active', pg_catalog.now() FROM public.roles
          WHERE role_key = 'business_owner' AND scope = 'business'`, [businessId, ownerId],
    );
});

after(async () => { await closePools(); });

async function createOrder(): Promise<number> {
    const { rows } = await adminPool.query<{ order_id: string }>(
        `INSERT INTO public.orders (business_id, customer_id, order_status, subtotal, total_amount)
         VALUES ($1, $2, 'pending', 100, 100) RETURNING order_id`, [businessId, customerId],
    );
    const id = Number(rows[0]!.order_id);
    return id;
}

async function enqueue(orderId: number, identity = `order:${orderId}:created`, recipientId = ownerId): Promise<number> {
    return withTenant(businessContext(customerId, businessId), async (client) => {
        const { rows } = await client.query<{ outbox_id: string }>(
            `SELECT public.enqueue_notification_email(
                $1, 'order.created', 'order.created', $2, 'en', $3, $4, NULL,
                '{"order_number":"test"}'::jsonb
             ) AS outbox_id`, [identity, recipientId, businessId, orderId],
        );
        return Number(rows[0]!.outbox_id);
    });
}

async function workerQuery<T extends Record<string, unknown>>(query: (client: PoolClient) => Promise<T[]>): Promise<T[]> {
    const client = await adminPool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE hq_notification_worker');
        const result = await query(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally { client.release(); }
}

describe('notification outbox database foundation', () => {
    it('uses the next migration version and installs a private RLS-enabled table', async () => {
        const { rows } = await adminPool.query<{ current_database: string; row_security: boolean }>(`
            SELECT pg_catalog.current_database() AS current_database, c.relrowsecurity AS row_security
              FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'notification_private' AND c.relname = 'notification_outbox'
        `);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.row_security, true);
        const { rows: migration } = await adminPool.query<{ name: string }>(
            `SELECT name FROM public.schema_migrations WHERE version = '062'`,
        );
        assert.equal(migration[0]?.name, '062_notification_outbox');
    });

    it('deduplicates the same event identity, event type, and recipient', async () => {
        const orderId = await createOrder();
        const first = await enqueue(orderId);
        const second = await enqueue(orderId);
        assert.equal(second, first);
        const { rows } = await adminPool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM notification_private.notification_outbox
             WHERE order_id = $1 AND event_type = 'order.created'`, [orderId],
        );
        assert.equal(rows[0]!.count, '1');
    });

    it('rejects enqueue across the current tenant boundary', async () => {
        const orderId = await createOrder();
        await assert.rejects(withTenant(businessContext(ownerId, businessId), (client) => client.query(
            `SELECT public.enqueue_notification_email(
                $1, 'order.created', 'order.created', $2, 'en', $3, $4, NULL, '{}'::jsonb
             )`, [`order:${orderId}:forged`, ownerId, businessId, orderId],
        )), /unauthorized order notification recipient/);
    });

    it('rejects outbox payload fields outside the event-specific minimal allowlist', async () => {
        const orderId = await createOrder();
        await assert.rejects(withTenant(businessContext(customerId, businessId), (client) => client.query(
            `SELECT public.enqueue_notification_email(
                $1, 'order.created', 'order.created', $2, 'en', $3, $4, NULL,
                '{"order_number":"test","email":"private@example.test"}'::jsonb
             )`, [`order:${orderId}:created`, ownerId, businessId, orderId],
        )), /notification payload contains unsupported fields/);
    });

    it('denies direct PUBLIC and hq_app access to private storage and worker operations', async () => {
        const { rows } = await adminPool.query<{ public_usage: boolean; public_select: boolean; app_usage: boolean; app_select: boolean }>(`
            SELECT
              EXISTS (SELECT 1 FROM pg_catalog.aclexplode(n.nspacl) a WHERE a.grantee = 0 AND a.privilege_type = 'USAGE') AS public_usage,
              EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee = 0 AND a.privilege_type = 'SELECT') AS public_select,
              pg_catalog.has_schema_privilege('hq_app', n.oid, 'USAGE') AS app_usage,
              pg_catalog.has_table_privilege('hq_app', c.oid, 'SELECT') AS app_select
              FROM pg_catalog.pg_namespace n
              JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
             WHERE n.nspname = 'notification_private' AND c.relname = 'notification_outbox'
        `);
        assert.deepEqual(rows[0], { public_usage: false, public_select: false, app_usage: false, app_select: false });
        await assert.rejects(appPool.query('SELECT * FROM notification_private.notification_outbox'), /permission denied/);
        await assert.rejects(appPool.query('SELECT * FROM public.claim_notification_email_batch(1, 30)'), /permission denied/);
    });

    it('grants only the enqueue function to hq_app and worker operations to the worker group', async () => {
        const { rows } = await adminPool.query<{
            enqueue_app: boolean; claim_app: boolean; claim_worker: boolean; enqueue_worker: boolean;
            resolve_worker: boolean; ack_worker: boolean; fail_worker: boolean; worker_schema: boolean;
            worker_table: boolean; worker_super: boolean; worker_bypass: boolean; worker_login: boolean;
            public_worker_function: boolean; worker_public_schema: boolean; api_worker_schema: boolean;
        }>(`
            SELECT
              pg_catalog.has_function_privilege('hq_app', 'public.enqueue_notification_email(text,text,text,bigint,text,bigint,bigint,bigint,jsonb)', 'EXECUTE') AS enqueue_app,
              pg_catalog.has_function_privilege('hq_app', 'public.claim_notification_email_batch(integer,integer)', 'EXECUTE') AS claim_app,
              pg_catalog.has_function_privilege('hq_notification_worker', 'notification_api.claim_email_batch(integer,integer)', 'EXECUTE') AS claim_worker,
              pg_catalog.has_function_privilege('hq_notification_worker', 'public.enqueue_notification_email(text,text,text,bigint,text,bigint,bigint,bigint,jsonb)', 'EXECUTE') AS enqueue_worker,
              pg_catalog.has_function_privilege('hq_notification_worker', 'notification_api.resolve_email_recipient(bigint,uuid)', 'EXECUTE') AS resolve_worker,
              pg_catalog.has_function_privilege('hq_notification_worker', 'notification_api.acknowledge_email_sent(bigint,uuid)', 'EXECUTE') AS ack_worker,
              pg_catalog.has_function_privilege('hq_notification_worker', 'notification_api.fail_email(bigint,uuid,boolean,text)', 'EXECUTE') AS fail_worker,
              pg_catalog.has_schema_privilege('hq_notification_worker', 'notification_private', 'USAGE') AS worker_schema,
              pg_catalog.has_schema_privilege('hq_notification_worker', 'public', 'USAGE') AS worker_public_schema,
              pg_catalog.has_schema_privilege('hq_notification_worker', 'notification_api', 'USAGE') AS api_worker_schema,
              pg_catalog.has_table_privilege('hq_notification_worker', 'notification_private.notification_outbox', 'SELECT') AS worker_table,
              EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
                  COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_worker_function,
              r.rolsuper AS worker_super, r.rolbypassrls AS worker_bypass, r.rolcanlogin AS worker_login
              FROM pg_catalog.pg_roles r
              JOIN pg_catalog.pg_proc p ON p.proname = 'claim_notification_email_batch'
                 AND p.pronamespace = 'public'::pg_catalog.regnamespace
             WHERE r.rolname = 'hq_notification_worker'
        `);
        assert.deepEqual(rows[0], { enqueue_app: true, claim_app: false, claim_worker: true,
            enqueue_worker: false, resolve_worker: true, ack_worker: true, fail_worker: true,
            worker_schema: false, worker_table: false, worker_super: false, worker_bypass: false,
            worker_login: false, public_worker_function: false, worker_public_schema: false, api_worker_schema: true });
    });

    it('uses a restricted non-login owner for every notification definer function and outbox table', async () => {
        const { rows } = await adminPool.query<{
            role_login: boolean; role_super: boolean; role_bypass: boolean; table_owner: string;
            function_count: string; unsafe_owners: string; unrelated_table_access: boolean;
            api_function_count: string; unsafe_api_owners: string;
        }>(`
            SELECT r.rolcanlogin AS role_login, r.rolsuper AS role_super, r.rolbypassrls AS role_bypass,
                   table_owner.rolname AS table_owner,
                   (SELECT count(*)::text FROM pg_catalog.pg_proc p
                     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public'
                      AND p.proname IN ('enqueue_notification_email', 'enqueue_new_order_email',
                        'claim_notification_email_batch', 'resolve_notification_email_recipient',
                        'acknowledge_notification_email_sent', 'fail_notification_email')
                      AND p.prosecdef) AS function_count,
                   (SELECT count(*)::text FROM pg_catalog.pg_proc p
                     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                     JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = p.proowner
                    WHERE n.nspname = 'public'
                      AND p.proname IN ('enqueue_notification_email', 'enqueue_new_order_email',
                        'claim_notification_email_batch', 'resolve_notification_email_recipient',
                        'acknowledge_notification_email_sent', 'fail_notification_email')
                      AND (owner_role.rolname <> 'hq_notification_definer' OR owner_role.rolsuper OR owner_role.rolbypassrls)) AS unsafe_owners
                   ,(SELECT count(*)::text FROM pg_catalog.pg_proc p
                      JOIN pg_catalog.pg_namespace api ON api.oid=p.pronamespace
                     WHERE api.nspname='notification_api' AND p.prosecdef) AS api_function_count
                   ,(SELECT count(*)::text FROM pg_catalog.pg_proc p
                      JOIN pg_catalog.pg_namespace api ON api.oid=p.pronamespace
                      JOIN pg_catalog.pg_roles api_owner ON api_owner.oid=p.proowner
                     WHERE api.nspname='notification_api' AND p.prosecdef
                       AND (api_owner.rolname <> 'hq_notification_definer' OR api_owner.rolsuper OR api_owner.rolbypassrls)) AS unsafe_api_owners
                   ,pg_catalog.has_table_privilege('hq_notification_definer', 'public.products', 'SELECT') AS unrelated_table_access
              FROM pg_catalog.pg_roles r
              JOIN pg_catalog.pg_class c ON c.relname = 'notification_outbox'
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'notification_private'
              JOIN pg_catalog.pg_roles table_owner ON table_owner.oid = c.relowner
             WHERE r.rolname = 'hq_notification_definer'
        `);
        assert.deepEqual(rows[0], {
            role_login: false, role_super: false, role_bypass: false,
            table_owner: 'hq_notification_definer', function_count: '6', unsafe_owners: '0', unrelated_table_access: false,
            api_function_count: '7', unsafe_api_owners: '0',
        });
    });

    it('keeps the notification and citext privilege matrix limited to supported roles', async () => {
        const { rows } = await adminPool.query<Record<string, boolean>>(`
            SELECT
              pg_catalog.has_function_privilege('hq_app', 'public.enqueue_notification_email(text,text,text,bigint,text,bigint,bigint,bigint,jsonb)', 'EXECUTE') AS app_enqueue,
              pg_catalog.has_function_privilege('hq_app', 'public.claim_notification_email_batch(integer,integer)', 'EXECUTE') AS app_claim,
              pg_catalog.has_function_privilege('hq_notification_worker', 'notification_api.claim_email_batch(integer,integer)', 'EXECUTE') AS worker_claim_api,
              pg_catalog.has_function_privilege('hq_notification_worker', 'notification_api.delivery_health()', 'EXECUTE') AS worker_health_api,
              pg_catalog.has_function_privilege('hq_notification_worker', 'public.claim_notification_email_batch(integer,integer)', 'EXECUTE') AS worker_public_claim,
              pg_catalog.has_function_privilege('hq_notification_worker', 'public.enqueue_notification_email(text,text,text,bigint,text,bigint,bigint,bigint,jsonb)', 'EXECUTE') AS worker_enqueue,
              pg_catalog.has_function_privilege('hq_notification_definer', 'public.claim_notification_email_batch(integer,integer)', 'EXECUTE') AS owner_claim,
              pg_catalog.has_function_privilege('hq_notification_definer', 'public.app_user_id()', 'EXECUTE') AS owner_rls_helper,
              pg_catalog.has_function_privilege('hq_app', 'public.citext_eq(citext,citext)', 'EXECUTE') AS app_citext_eq,
              pg_catalog.has_function_privilege('hq_notification_worker', 'public.citext_eq(citext,citext)', 'EXECUTE') AS worker_citext_eq,
              pg_catalog.has_function_privilege('hq_notification_definer', 'public.citext_eq(citext,citext)', 'EXECUTE') AS owner_citext_eq,
            (SELECT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(cp.proacl, pg_catalog.acldefault('f',cp.proowner))) acl
                             WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')
               FROM pg_catalog.pg_proc cp WHERE cp.oid='public.citext_eq(citext,citext)'::pg_catalog.regprocedure) AS public_citext_eq,
              EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f',p.proowner))) x
                       WHERE x.grantee=0 AND x.privilege_type='EXECUTE') AS public_notification_exec
              FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='claim_notification_email_batch'
        `);
        assert.deepEqual(rows[0], {
            app_enqueue: true, app_claim: false, worker_claim_api: true, worker_health_api: true,
            worker_public_claim: false, worker_enqueue: false, owner_claim: true, owner_rls_helper: true,
            app_citext_eq: true, worker_citext_eq: false, owner_citext_eq: true,
            public_citext_eq: false,
            public_notification_exec: false,
        });
    });

    it('runs the worker store through a dedicated NOINHERIT login and only its approved functions', async () => {
        const roleName = 'hq_notification_worker_test_runtime';
        const password = randomBytes(32).toString('hex');
        const config = (await import('../src/config.js')).config;
        const { rows: oldRole } = await adminPool.query('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [roleName]);
        assert.equal(oldRole.length, 0);
        await adminPool.query(`CREATE ROLE ${roleName} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
        await adminPool.query(`GRANT hq_notification_worker TO ${roleName}`);
        const workerPool = new Pool({
            host: config.PGHOST, port: config.PGPORT, database: config.PGDATABASE,
            user: roleName, password, max: 1, application_name: 'hq-notification-worker-test',
        });
        try {
            await adminPool.query(
                `UPDATE notification_private.notification_outbox
                    SET status = 'dead', lease_until = NULL, lease_token = NULL
                  WHERE status IN ('pending', 'processing')`,
            );
            const orderId = await createOrder();
            const outboxId = await enqueue(orderId);
            const { PgEmailWorkerStore, assertNotificationWorkerIdentity } = await import('../src/modules/notifications/email-worker.store.js');
            await assertNotificationWorkerIdentity(workerPool);
            const store = new PgEmailWorkerStore(workerPool);
            const claimed = await store.claim(1, 120);
            assert.equal(String(claimed[0]?.outbox_id), String(outboxId));
            const recipient = await store.resolve(claimed[0]!.outbox_id, claimed[0]!.lease_token);
            assert.equal(recipient?.email, (await adminPool.query<{ email: string }>(
                'SELECT email FROM public.users WHERE user_id = $1', [ownerId],
            )).rows[0]!.email);
            assert.equal(await store.fail(claimed[0]!.outbox_id, claimed[0]!.lease_token, false, 'test_complete'), true);

            await adminPool.query('GRANT SELECT ON public.users TO hq_notification_worker');
            try {
                await assert.rejects(assertNotificationWorkerIdentity(workerPool), /public_application_table_privilege/);
            } finally {
                await adminPool.query('REVOKE SELECT ON public.users FROM hq_notification_worker');
            }

            const unexpectedRole = 'hq_notification_worker_extra_test';
            await adminPool.query(`CREATE ROLE ${unexpectedRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
            await adminPool.query(`GRANT ${unexpectedRole} TO hq_notification_worker`);
            try {
                await assert.rejects(assertNotificationWorkerIdentity(workerPool), /worker_role_has_members/);
            } finally {
                await adminPool.query(`REVOKE ${unexpectedRole} FROM hq_notification_worker`);
                await adminPool.query(`DROP ROLE ${unexpectedRole}`);
            }
        } finally {
            await workerPool.end();
            await adminPool.query(`REVOKE hq_notification_worker FROM ${roleName}`).catch(() => undefined);
            await adminPool.query(`DROP ROLE IF EXISTS ${roleName}`).catch(() => undefined);
        }
    });

    it('resolves only the recipient account email while it remains verified', async () => {
        const orderId = await createOrder();
        const outboxId = await enqueue(orderId);
        await adminPool.query(
            `UPDATE notification_private.notification_outbox
                SET status = 'dead', lease_until = NULL, lease_token = NULL
              WHERE outbox_id <> $1 AND status IN ('pending', 'processing')`, [outboxId],
        );
        const [lease] = await workerQuery((client) => client.query<{ outbox_id: string; lease_token: string }>(
            'SELECT outbox_id, lease_token FROM notification_api.claim_email_batch(1, 120)',
        ).then((result) => result.rows));
        assert.equal(String(lease?.outbox_id), String(outboxId));

        const { rows: expected } = await adminPool.query<{ email: string }>(
            'SELECT email::text AS email FROM public.users WHERE user_id = $1 AND email_verified_at IS NOT NULL', [ownerId],
        );
        const [resolved] = await workerQuery((client) => client.query<{ email: string }>(
            'SELECT email FROM notification_api.resolve_email_recipient($1, $2)', [outboxId, lease!.lease_token],
        ).then((result) => result.rows));
        assert.equal(resolved?.email, expected[0]!.email);

        await adminPool.query('UPDATE public.users SET email_verified_at = NULL WHERE user_id = $1', [ownerId]);
        const unresolved = await workerQuery((client) => client.query(
            'SELECT * FROM notification_api.resolve_email_recipient($1, $2)', [outboxId, lease!.lease_token],
        ).then((result) => result.rows));
        assert.equal(unresolved.length, 0);
        await adminPool.query('UPDATE public.users SET email_verified_at = pg_catalog.now() WHERE user_id = $1', [ownerId]);
    });

    it('claims concurrently with SKIP LOCKED without returning the same row', async () => {
        const firstOrder = await createOrder();
        const secondOrder = await createOrder();
        await enqueue(firstOrder);
        await enqueue(secondOrder);
        const first = await adminPool.connect();
        const second = await adminPool.connect();
        try {
            await first.query('BEGIN');
            await first.query('SET LOCAL ROLE hq_notification_worker');
            const firstClaim = await first.query<{ outbox_id: string }>('SELECT outbox_id FROM notification_api.claim_email_batch(1, 120)');
            assert.equal(firstClaim.rows.length, 1);

            await second.query('BEGIN');
            await second.query('SET LOCAL ROLE hq_notification_worker');
            const secondClaim = await second.query<{ outbox_id: string }>('SELECT outbox_id FROM notification_api.claim_email_batch(1, 120)');
            assert.equal(secondClaim.rows.length, 1);
            assert.notEqual(secondClaim.rows[0]!.outbox_id, firstClaim.rows[0]!.outbox_id);
            await second.query('COMMIT');
            await first.query('COMMIT');
        } finally {
            await first.query('ROLLBACK').catch(() => undefined);
            await second.query('ROLLBACK').catch(() => undefined);
            first.release();
            second.release();
        }
    });

    it('recovers expired leases and rejects acknowledgements using a stale token', async () => {
        const orderId = await createOrder();
        const outboxId = await enqueue(orderId);
        await adminPool.query(
            `UPDATE notification_private.notification_outbox
                SET status = 'dead', lease_until = NULL, lease_token = NULL
              WHERE outbox_id <> $1 AND status IN ('pending', 'processing')`, [outboxId],
        );
        const [oldLease] = await workerQuery((client) => client.query(
            'SELECT * FROM notification_api.claim_email_batch(1, 120)',
        ).then((result) => result.rows));
        assert.ok(oldLease);
        assert.equal(String(oldLease.outbox_id), String(outboxId));
        await adminPool.query(
            `UPDATE notification_private.notification_outbox
                SET lease_until = pg_catalog.clock_timestamp() - interval '1 second'
              WHERE outbox_id = $1`, [outboxId],
        );
        const [newLease] = await workerQuery((client) => client.query(
            'SELECT * FROM notification_api.claim_email_batch(1, 120)',
        ).then((result) => result.rows));
        assert.ok(newLease);
        assert.notEqual(String(newLease.lease_token), String(oldLease.lease_token));
        const [staleAck] = await workerQuery((client) => client.query<{ result: boolean }>(
            'SELECT notification_api.acknowledge_email_sent($1, $2) AS result', [outboxId, oldLease.lease_token],
        ).then((result) => result.rows));
        assert.equal(staleAck!.result, false);
        const [freshAck] = await workerQuery((client) => client.query<{ result: boolean }>(
            'SELECT notification_api.acknowledge_email_sent($1, $2) AS result', [outboxId, newLease.lease_token],
        ).then((result) => result.rows));
        assert.equal(freshAck!.result, true);
    });

    it('enforces the database maximum attempt count when a worker reports a retryable failure', async () => {
        const orderId = await createOrder();
        const outboxId = await enqueue(orderId);
        await adminPool.query(
            `UPDATE notification_private.notification_outbox
                SET status = 'dead', lease_until = NULL, lease_token = NULL
              WHERE outbox_id <> $1 AND status IN ('pending', 'processing')`, [outboxId],
        );
        await adminPool.query(
            `UPDATE notification_private.notification_outbox SET attempt_count = max_attempts - 1
              WHERE outbox_id = $1`, [outboxId],
        );
        const [lease] = await workerQuery((client) => client.query(
            'SELECT * FROM notification_api.claim_email_batch(1, 120)',
        ).then((result) => result.rows));
        assert.ok(lease);
        const [failed] = await workerQuery((client) => client.query<{ updated: boolean }>(
            'SELECT notification_api.fail_email($1, $2, true, $3) AS updated',
            [outboxId, lease!.lease_token, 'smtp_timeout'],
        ).then((result) => result.rows));
        assert.equal(failed!.updated, true);
        const { rows } = await adminPool.query<{ status: string; attempt_count: number; max_attempts: number }>(
            'SELECT status, attempt_count, max_attempts FROM notification_private.notification_outbox WHERE outbox_id = $1', [outboxId],
        );
        assert.equal(rows[0]!.status, 'dead');
        assert.equal(rows[0]!.attempt_count, rows[0]!.max_attempts);
    });

    it('keeps an enqueue rolled back with its enclosing tenant transaction', async () => {
        const orderId = await createOrder();
        const identity = `order:${orderId}:created`;
        await assert.rejects(withTenant(businessContext(customerId, businessId), async (client) => {
            await client.query(
                `SELECT public.enqueue_notification_email($1, 'order.created', 'order.created', $2, 'en', $3, $4, NULL, '{}'::jsonb)`,
                [identity, ownerId, businessId, orderId],
            );
            throw new Error('test transaction rollback');
        }), /test transaction rollback/);
        const { rows } = await adminPool.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM notification_private.notification_outbox WHERE event_identity = $1', [identity],
        );
        assert.equal(rows[0]!.count, '0');
    });

    it('rolls notification migrations 062-065 down and up again with the same grants and RLS protection', async () => {
        const { migrateDown, migrateUp } = await import('../src/db/migrator.js');
        const { applyGrants } = await import('../src/db/grants.js');
        const { config } = await import('../src/config.js');
        const { rows: outboxBefore } = await adminPool.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM notification_private.notification_outbox',
        );
        assert.equal(await migrateDown({ allowDataLoss: true }), '066_notification_tls_health_code');
        assert.deepEqual(await migrateUp(), ['066_notification_tls_health_code']);
        assert.equal(await migrateDown({ allowDataLoss: true }), '065_notification_operations');
        const { rows: down065 } = await adminPool.query<{ count: string; admin_schema: boolean; tombstones: boolean }>(`
            SELECT (SELECT count(*)::text FROM notification_private.notification_outbox) AS count,
                   pg_catalog.to_regnamespace('notification_admin') IS NOT NULL AS admin_schema,
                   pg_catalog.to_regclass('notification_private.notification_outbox_dedupe_tombstones') IS NOT NULL AS tombstones
        `);
        assert.equal(down065[0]!.count, outboxBefore[0]!.count);
        assert.equal(down065[0]!.admin_schema, false);
        assert.equal(down065[0]!.tombstones, false);
        assert.deepEqual(await migrateUp(), ['065_notification_operations', '066_notification_tls_health_code']);
        await applyGrants(adminPool, config.APP_DB_USER, config.APP_DB_PASSWORD);

        assert.equal(await migrateDown({ allowDataLoss: true }), '066_notification_tls_health_code');
        assert.deepEqual(await migrateUp(), ['066_notification_tls_health_code']);
        assert.equal(await migrateDown({ allowDataLoss: true }), '065_notification_operations');
        assert.equal(await migrateDown({ allowDataLoss: true }), '064_notification_owner_security');
        const { rows: down064 } = await adminPool.query<{ count: string; owner_role: boolean; api_schema: boolean }>(`
            SELECT (SELECT count(*)::text FROM notification_private.notification_outbox) AS count,
                   EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hq_notification_definer') AS owner_role,
                   pg_catalog.to_regnamespace('notification_api') IS NOT NULL AS api_schema
        `);
        assert.equal(down064[0]!.count, outboxBefore[0]!.count);
        assert.equal(down064[0]!.owner_role, false);
        assert.equal(down064[0]!.api_schema, false);
        assert.deepEqual(await migrateUp(), ['064_notification_owner_security', '065_notification_operations', '066_notification_tls_health_code']);
        await applyGrants(adminPool, config.APP_DB_USER, config.APP_DB_PASSWORD);
        const { rows: up064 } = await adminPool.query<{
            count: string; owner_login: boolean; owner_super: boolean; owner_bypass: boolean;
            table_owner: string; forced_rls: boolean; worker_claim: boolean; app_private: boolean;
        }>(`
            SELECT (SELECT count(*)::text FROM notification_private.notification_outbox) AS count,
                   owner_role.rolcanlogin AS owner_login, owner_role.rolsuper AS owner_super,
                   owner_role.rolbypassrls AS owner_bypass, table_owner.rolname AS table_owner,
                   c.relforcerowsecurity AS forced_rls,
                   pg_catalog.has_function_privilege('hq_notification_worker',
                     'notification_api.claim_email_batch(integer,integer)', 'EXECUTE') AS worker_claim,
                   pg_catalog.has_schema_privilege('hq_app', 'notification_private', 'USAGE') AS app_private
              FROM pg_catalog.pg_roles owner_role
              JOIN pg_catalog.pg_class c ON c.relname='notification_outbox'
              JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace AND n.nspname='notification_private'
              JOIN pg_catalog.pg_roles table_owner ON table_owner.oid=c.relowner
             WHERE owner_role.rolname='hq_notification_definer'
        `);
        assert.deepEqual(up064[0], {
            count: outboxBefore[0]!.count, owner_login: false, owner_super: false,
            owner_bypass: false, table_owner: 'hq_notification_definer',
            forced_rls: true, worker_claim: true, app_private: false,
        });

        assert.equal(await migrateDown({ allowDataLoss: true }), '066_notification_tls_health_code');
        assert.deepEqual(await migrateUp(), ['066_notification_tls_health_code']);
        assert.equal(await migrateDown({ allowDataLoss: true }), '065_notification_operations');
        assert.equal(await migrateDown({ allowDataLoss: true }), '064_notification_owner_security');
        assert.equal(await migrateDown({ allowDataLoss: true }), '063_enqueue_new_order_email');
        assert.equal(await migrateDown({ allowDataLoss: true }), '062_notification_outbox');
        const { rows: removed } = await adminPool.query<{ present: boolean }>(
            `SELECT pg_catalog.to_regclass('notification_private.notification_outbox') IS NOT NULL AS present`,
        );
        assert.equal(removed[0]!.present, false);

        assert.deepEqual(await migrateUp(), ['062_notification_outbox', '063_enqueue_new_order_email', '064_notification_owner_security', '065_notification_operations', '066_notification_tls_health_code']);
        await applyGrants(adminPool, config.APP_DB_USER, config.APP_DB_PASSWORD);
        const { rows: restored } = await adminPool.query<{ row_security: boolean; app_schema: boolean; app_enqueue: boolean; public_execute: boolean }>(`
            SELECT c.relrowsecurity AS row_security,
                   pg_catalog.has_schema_privilege('hq_app', n.oid, 'USAGE') AS app_schema,
                   pg_catalog.has_function_privilege('hq_app', 'public.enqueue_notification_email(text,text,text,bigint,text,bigint,bigint,bigint,jsonb)', 'EXECUTE') AS app_enqueue,
                   EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute
              FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_catalog.pg_proc p ON p.proname = 'enqueue_notification_email'
                 AND p.pronamespace = 'public'::pg_catalog.regnamespace
             WHERE n.nspname = 'notification_private' AND c.relname = 'notification_outbox'
        `);
        assert.deepEqual(restored[0], { row_security: true, app_schema: false, app_enqueue: true, public_execute: false });
    });
});
