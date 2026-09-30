import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config.js';

/**
 * Two pools on purpose:
 *
 *  - `adminPool`   : the schema owner. Used ONLY by migrations, seeds and
 *                    grant scripts. It bypasses RLS, so it must never be
 *                    reachable from a request handler.
 *  - `appPool`     : the `hq_app` role. RLS applies, so a missing
 *                    `WHERE business_id = ...` returns nothing instead of
 *                    another business's rows.
 */

const common = {
    host: config.PGHOST,
    port: config.PGPORT,
    database: config.PGDATABASE,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
};

export const adminPool = new Pool({
    ...common,
    user: config.PGUSER,
    password: config.PGPASSWORD,
    application_name: 'hq-admin',
});

export const appPool = new Pool({
    ...common,
    user: config.APP_DB_USER,
    password: config.APP_DB_PASSWORD,
    application_name: 'hq-app',
});

export async function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
    return appPool.query<T>(text, params as unknown[]);
}

/** Runs `fn` inside a transaction, rolling back on any error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await appPool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

export async function closePools(): Promise<void> {
    await Promise.all([adminPool.end(), appPool.end()]);
}
