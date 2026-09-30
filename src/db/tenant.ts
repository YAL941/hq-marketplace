import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { appPool } from './pool.js';

/**
 * The tenant context is the single mechanism through which the backend
 * tells the database "who is asking and for which business".
 *
 * It is applied with `set_config(..., true)` (transaction-local) inside an
 * explicit transaction, so the values:
 *   - cannot leak to the next request that reuses a pooled connection,
 *   - cannot be set by a client outside our code,
 *   - are visible to the RLS policies in 004_seed_and_isolation.sql.
 *
 * Application code never builds a query from a client-supplied business id
 * without also going through here.
 */
export interface TenantContext {
    /** Platform user id, or null for an anonymous visitor. */
    userId: number | null;
    /** True only for a user holding the platform_admin role. */
    isPlatformAdmin: boolean;
    /** Business the request acts on, or null for platform-wide requests. */
    businessId: number | null;
}

export const ANONYMOUS: TenantContext = {
    userId: null,
    isPlatformAdmin: false,
    businessId: null,
};

export function platformContext(userId: number): TenantContext {
    return { userId, isPlatformAdmin: true, businessId: null };
}

export function businessContext(userId: number, businessId: number, isPlatformAdmin = false): TenantContext {
    return { userId, isPlatformAdmin, businessId };
}

async function applyContext(client: PoolClient, ctx: TenantContext): Promise<void> {
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', ctx.userId === null ? '' : String(ctx.userId)]);
    await client.query('SELECT set_config($1, $2, true)', [
        'app.is_platform_admin',
        ctx.isPlatformAdmin ? 'true' : 'false',
    ]);
    await client.query('SELECT set_config($1, $2, true)', [
        'app.current_business_id',
        ctx.businessId === null ? '' : String(ctx.businessId),
    ]);
}

/**
 * Runs `fn` in a transaction with the tenant context applied.
 * Every repository call in this project goes through this function.
 */
export async function withTenant<T>(
    ctx: TenantContext,
    fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const client = await appPool.connect();
    try {
        await client.query('BEGIN');
        await applyContext(client, ctx);
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

export type TenantClient = PoolClient;

export async function tenantQuery<T extends QueryResultRow = QueryResultRow>(
    ctx: TenantContext,
    text: string,
    params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
    return withTenant(ctx, (client) => client.query<T>(text, params as unknown[]));
}

/**
 * Membership check executed by the database, not by application logic.
 * Returns true when the user is an active member of the business or a
 * platform admin.
 */
export async function isBusinessMember(
    ctx: TenantContext,
    businessId: number,
): Promise<boolean> {
    const { rows } = await tenantQuery<{ allowed: boolean }>(
        ctx,
        'SELECT (app_is_business_member($1) OR app_is_platform_admin()) AS allowed',
        [businessId],
    );
    return rows[0]?.allowed === true;
}

/** Permission check executed by the database. */
export async function hasBusinessPermission(
    ctx: TenantContext,
    businessId: number,
    permissionKey: string,
): Promise<boolean> {
    const { rows } = await tenantQuery<{ allowed: boolean }>(
        ctx,
        'SELECT (app_has_business_permission($1, $2) OR app_is_platform_admin()) AS allowed',
        [businessId, permissionKey],
    );
    return rows[0]?.allowed === true;
}
