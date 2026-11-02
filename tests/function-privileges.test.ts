import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import { HQ_APP_FUNCTION_ALLOWLIST } from '../src/db/grants.js';

let adminPool: Pool;
let appPool: Pool;
let closePools: () => Promise<void>;

before(async () => {
    process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
    const poolModule = await import('../src/db/pool.js');
    adminPool = (await import('../src/db/admin-pool.js')).adminPool;
    appPool = poolModule.appPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});

after(async () => {
    await closePools();
});

describe('least-privilege public function grants', () => {
    it('grants hq_app every approved direct function signature', async () => {
        for (const entry of HQ_APP_FUNCTION_ALLOWLIST) {
            const { rows: grantRows } = await appPool.query<{ allowed: boolean }>(`
                SELECT has_function_privilege('hq_app', $1::regprocedure, 'EXECUTE') AS allowed
            `, [entry.signature.toLowerCase()]);
            assert.equal(grantRows[0]?.allowed, true, `missing approved grant: ${entry.signature}`);
        }
    });

    it('does not grant trigger-only functions directly to hq_app or PUBLIC', async () => {
        const signatures = [
            'set_updated_at()',
            'assert_platform_role_scope()',
            'assert_business_role_scope()',
            'set_order_number()',
            'append_order_status_history()',
            'append_delivery_status_history()',
            'restock_cancelled_order()',
            'assert_inventory_product_total()',
            'reconcile_terminal_order_payment()',
        ];

        for (const signature of signatures) {
            const { rows } = await appPool.query<{ hq_app: boolean; public: boolean }>(`
                SELECT
                    has_function_privilege('hq_app', p.oid, 'EXECUTE') AS hq_app,
                    CASE WHEN p.proacl IS NULL THEN true ELSE EXISTS (
                        SELECT 1 FROM aclexplode(p.proacl) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
                    ) END AS public
                  FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'
                   AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = $1
            `, [signature]);
            assert.equal(rows[0]?.hq_app ?? false, false, `${signature} remains executable by hq_app`);
            assert.equal(rows[0]?.public ?? false, false, `${signature} remains executable by PUBLIC`);
        }
    });

    it('removes PUBLIC execute from sensitive project functions', async () => {
        const sensitive = [
            'app_is_business_member(bigint)',
            'app_has_business_permission(bigint, text)',
            'app_business_ids()',
            'app_business_is_public(bigint)',
            'app_business_has_no_members(bigint)',
            'enqueue_notification_email(text, text, text, bigint, text, bigint, bigint, bigint, jsonb)',
            'enqueue_new_order_email(bigint)',
            'app_user_for_login(text)',
            'refresh_business_statistics(bigint)',
            'increment_business_profile_views(bigint)',
            'reserve_order_product(bigint, bigint, integer, bigint)',
            'lock_order_inventory_products(bigint, bigint[])',
            'record_order_stock_sale(bigint)',
            'apply_inventory_stock_delta(bigint, bigint, integer)',
        ];

        for (const signature of sensitive) {
            const { rows } = await appPool.query<{ public_execute: boolean }>(`
                SELECT CASE WHEN p.proacl IS NULL THEN true ELSE EXISTS (
                    SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
                ) END AS public_execute
                  FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'
                   AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = $1
            `, [signature]);
            assert.equal(rows[0]?.public_execute ?? false, false, `${signature} remains PUBLIC-executable`);
        }
    });

    it('removes broad future hq_app function defaults and is idempotent', async () => {
        const { applyGrants } = await import('../src/db/grants.js');
        const { config } = await import('../src/config.js');

        await applyGrants(adminPool, config.APP_DB_USER, config.APP_DB_PASSWORD);
        await applyGrants(adminPool, config.APP_DB_USER, config.APP_DB_PASSWORD);

        const { rows } = await adminPool.query<{ acl: string | null }>(`
            SELECT d.defaclacl::text AS acl
              FROM pg_default_acl d
              JOIN pg_roles r ON r.oid = d.defaclrole
             WHERE d.defaclnamespace = 'public'::regnamespace
               AND d.defaclobjtype = 'f'
               AND r.rolname = current_user
        `);
        for (const row of rows) {
            assert.doesNotMatch(row.acl ?? '', new RegExp(`\\\\b${config.APP_DB_USER}=X`));
        }

        await adminPool.query('CREATE OR REPLACE FUNCTION hq_privilege_test_future() RETURNS VOID LANGUAGE sql AS $$ SELECT NULL::VOID $$');
        const { rows: functionRows } = await adminPool.query<{ hq_execute: boolean }>(`
            SELECT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.grantee = to_regrole('hq_app')::oid
                   AND a.privilege_type = 'EXECUTE'
            ) AS hq_execute
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'hq_privilege_test_future'
        `);
        assert.equal(functionRows[0]?.hq_execute, false);
        await adminPool.query('DROP FUNCTION hq_privilege_test_future()');

    });
});
