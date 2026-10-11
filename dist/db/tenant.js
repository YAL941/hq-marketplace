import { appPool } from './pool.js';
export const ANONYMOUS = {
    userId: null,
    isPlatformAdmin: false,
    businessId: null,
};
export function platformContext(userId) {
    return { userId, isPlatformAdmin: true, businessId: null };
}
export function businessContext(userId, businessId, isPlatformAdmin = false) {
    return { userId, isPlatformAdmin, businessId };
}
async function applyContext(client, ctx) {
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
export async function withTenant(ctx, fn) {
    const client = await appPool.connect();
    try {
        await client.query('BEGIN');
        await applyContext(client, ctx);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
export async function tenantQuery(ctx, text, params = []) {
    return withTenant(ctx, (client) => client.query(text, params));
}
/**
 * Membership check executed by the database, not by application logic.
 * Returns true when the user is an active member of the business or a
 * platform admin.
 */
export async function isBusinessMember(ctx, businessId) {
    const { rows } = await tenantQuery(ctx, 'SELECT (app_is_business_member($1) OR app_is_platform_admin()) AS allowed', [businessId]);
    return rows[0]?.allowed === true;
}
/** Permission check executed by the database. */
export async function hasBusinessPermission(ctx, businessId, permissionKey) {
    const { rows } = await tenantQuery(ctx, 'SELECT (app_has_business_permission($1, $2) OR app_is_platform_admin()) AS allowed', [businessId, permissionKey]);
    return rows[0]?.allowed === true;
}
//# sourceMappingURL=tenant.js.map