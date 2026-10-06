/**
 * Shared, cross-process safe test database setup.
 *
 * Why this exists: `node --test` runs every test file in its own process and,
 * unless `--test-concurrency=1` is passed, in parallel. All test files point at
 * the same physical database (`TEST_PGDATABASE`), and each of them used to
 * prepare that database on its own: migrate, then re-create the application
 * role and re-issue the grants. Two processes doing that at the same time both
 * update the same catalog rows:
 *
 *   - `ALTER ROLE hq_app ...` rewrites a tuple in `pg_authid`
 *     -> "tuple concurrently updated" (XX000)
 *   - `GRANT ... ON ALL TABLES IN SCHEMA public` rewrites `pg_class.relacl`
 *     -> "tuple concurrently updated" (XX000)
 *   - and `TRUNCATE` updates `pg_class` too, because it gives the relation a
 *     new relfilenode, so a TRUNCATE racing a GRANT fails the same way
 *   - two concurrent GRANTs also deadlock on the catalog lock
 *     -> "deadlock detected" (40P01)
 *
 * All failures are non-deterministic: they depend on how the scheduler
 * interleaves the sessions, so the suite can be green on one run and fail
 * on the next. The fix is to serialise the whole setup phase across processes
 * with a PostgreSQL advisory lock, which is held at the session level and
 * therefore respected by every connection in every test process.
 *
 * This lives under `tests/` on purpose: production code is untouched, and
 * `npm run db:grants` keeps behaving exactly as before.
 */

import type { Pool, PoolClient } from 'pg';

/**
 * Arbitrary but fixed key for `pg_advisory_lock`. Any 64-bit value works as
 * long as it is stable and not shared with unrelated tooling; this one is
 * derived from the project name so it cannot collide with the session-level
 * locks used by the application itself.
 */
const TEST_SETUP_LOCK_KEY = '72717374'; // "hqst" in ASCII hex

export const TEST_TABLES = [
    'user_favorites',
    'order_items',
    'orders',
    'reviews',
    'products',
    'services',
    'business_locations',
    'business_users',
    'business_statistics',
    'businesses',
    'user_platform_roles',
    'users',
] as const;

export interface TestDatabaseOptions {
    /** The tables to clear once the migrations and grants are in place. */
    truncate?: readonly string[];
}

/**
 * Runs the shared setup exactly once per caller:
 *   1. apply any pending migration
 *   2. (re)create the application role and (re)issue the grants
 *   3. clear the fixture tables
 *
 * The first two steps must happen before the third, because the grants are what
 * make `hq_app` subject to row level security, and the truncation is what makes
 * assertions about row counts deterministic.
 *
 * Steps 1 and 2 are the ones that cannot be run concurrently, so the advisory
 * lock is taken on the very connection that performs them and released only once
 * the connection is back in the pool.
 */
export async function prepareTestDatabase(
    adminPool: Pool,
    options: TestDatabaseOptions = {},
): Promise<void> {
    const { migrateUp } = await import('../../src/db/migrator.js');
    const { applyGrants } = await import('../../src/db/grants.js');
    const { config } = await import('../../src/config.js');

    await withSetupLock(adminPool, async (client) => {
        // All three steps below must be serialised, and the reason is not
        // obvious: TRUNCATE updates rows in pg_class too (it rewrites the
        // relation's relfilenode), and so does
        // `GRANT ... ON ALL TABLES IN SCHEMA public` (it rewrites relacl).
        // Running them concurrently makes PostgreSQL abort one of them with
        // "tuple concurrently updated", even though no business table is
        // involved. migrateUp() additionally writes to schema_migrations.
        await migrateUp();
        await applyGrants(client, config.APP_DB_USER, config.APP_DB_PASSWORD);

        const truncate = options.truncate ?? TEST_TABLES;
        await client.query(`
            TRUNCATE ${truncate.join(', ')}
            RESTART IDENTITY CASCADE
        `);
    });
}

/**
 * Runs `fn` while holding a session-level advisory lock, so that a second
 * test process calling this helper blocks instead of colliding.
 *
 * `pg_advisory_lock` blocks rather than failing, so the caller does not need a
 * retry loop. The lock is deliberately taken on a single dedicated client:
 * advisory locks belong to a session, so releasing the client to the pool
 * without unlocking would leak a held lock for the rest of the connection's
 * lifetime.
 */
export async function withSetupLock<T>(
    adminPool: Pool,
    fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const client = await adminPool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [TEST_SETUP_LOCK_KEY]);
        return await fn(client);
    } finally {
        // Best effort: if the unlock query itself fails the connection is
        // discarded, and PostgreSQL drops the session lock with it.
        await client.query('SELECT pg_advisory_unlock($1)', [TEST_SETUP_LOCK_KEY])
            .catch(() => undefined);
        client.release();
    }
}
