import { Pool } from 'pg';
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
export async function query(text, params = []) {
    return appPool.query(text, params);
}
/** Runs `fn` inside a transaction, rolling back on any error. */
export async function withTransaction(fn) {
    const client = await appPool.connect();
    try {
        await client.query('BEGIN');
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
export async function closePools() {
    await Promise.all([adminPool.end(), appPool.end()]);
}
/**
 * Checks that the application role is the kind of role RLS actually protects.
 *
 * The isolation this project is built on is not a property of the queries. It is
 * a property of who runs them: `hq_app` does not own the tables, so PostgreSQL
 * filters its rows through the policies. Connect the application as the schema
 * owner, as a superuser, or as any role with BYPASSRLS and every policy stops
 * being consulted — silently. Nothing fails, no query errors, and every request
 * answers `200` while returning other tenants' rows.
 *
 * That makes a misconfiguration in `APP_DB_USER` the single highest-consequence
 * mistake available in this file, and one with no symptom to notice. So it is
 * checked once, explicitly, rather than inferred from a passing test.
 *
 * The three properties checked are the only three that matter here:
 *   * `rolsuper`     — a superuser bypasses RLS unconditionally.
 *   * `rolbypassrls` — explicitly exempt, the same result by intent.
 *   * table ownership — the owner bypasses RLS too, unless the table has FORCE
 *     ROW LEVEL SECURITY, which is why ownership is only reported as unsafe
 *     when it would actually let policies be skipped.
 */
export async function inspectAppRole(check) {
    const problems = [];
    const { rows } = await check.query('SELECT rolsuper, rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user');
    const role = rows[0];
    if (!role) {
        problems.push('could not read the current role from pg_roles');
        return { unsafe: true, problems };
    }
    if (role.rolsuper)
        problems.push(`${role.current_user} is a superuser, which bypasses row level security`);
    if (role.rolbypassrls) {
        problems.push(`${role.current_user} has BYPASSRLS, which exempts it from row level security`);
    }
    // Ownership is only counted when it would actually skip the policies: a
    // table with FORCE ROW LEVEL SECURITY applies them to its owner too, and
    // reporting that as unsafe would train the warning to be ignored.
    //
    // `json_agg` rather than `array_agg`: node-postgres only hands back a
    // JavaScript array for the `json` type, and hands a `_text` column back as
    // the literal `{"a","b"}` string. Reading it as an array would either throw
    // or, worse, report a single oddly-named table.
    const { rows: owned } = await check.query(`SELECT json_agg(c.relname ORDER BY c.relname) AS tables
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p')
            AND NOT c.relrowsecurity
            AND pg_catalog.pg_get_userbyid(c.relowner) = current_user`);
    const ownedTables = (Array.isArray(owned[0]?.tables) ? owned[0].tables : [])
        .filter((name) => typeof name === 'string')
        .filter((name) => name !== 'schema_migrations');
    if (ownedTables.length > 0) {
        problems.push(`${role.current_user} owns ${ownedTables.length} table(s) without FORCE ROW LEVEL SECURITY, `
            + `so it is exempt from the policies on them (for example ${ownedTables.slice(0, 3).join(', ')})`);
    }
    return { unsafe: problems.length > 0, problems };
}
/**
 * Refuses to start when the application role would defeat isolation, and warns
 * loudly when it would but the environment is not production.
 *
 * The asymmetry is deliberate. In production an unsafe role is a silent,
 * cross-tenant data leak, so it stops the process — and it stops it at startup,
 * where the message is still attached to the person who configured it. In
 * development and test the same role is the convenient one, and refusing to run
 * would make the project unusable on a fresh clone; there it prints a warning
 * that cannot be scrolled past.
 */
export async function assertAppRoleIsSafe() {
    const finding = await inspectAppRole(appPool);
    if (finding.unsafe) {
        const detail = finding.problems.map((problem) => `  - ${problem}`).join('\n');
        if (config.isProduction) {
            throw new Error('Refusing to start: the application database role would defeat row level security.\n'
                + `${detail}\n\n`
                + 'Every request would still succeed, and would return other businesses\' rows, so this\n'
                + 'is not something a test or a smoke check would reveal. Give APP_DB_USER a role that\n'
                + 'neither owns the schema nor holds BYPASSRLS nor is a superuser — `npm run db:grants`\n'
                + 'creates exactly that role and grants it only what the API needs.');
        }
        console.warn(`[hq] WARNING: the application database role would defeat row level security.\n`
            + finding.problems.map((problem) => `[hq]   - ${problem}`).join('\n')
            + '\n[hq] This is refused outright when NODE_ENV=production. It is only tolerated here so a\n'
            + '[hq] fresh development setup runs without ceremony.');
    }
    return finding;
}
//# sourceMappingURL=pool.js.map