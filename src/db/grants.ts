import type { Pool, PoolClient } from 'pg';

/**
 * Grants for the application role.
 *
 * The application connects as a role that does NOT own the schema, so its
 * statements are filtered by the RLS policies. Running the API as the owner
 * would silently disable the isolation this project depends on.
 *
 * Accepts a Pool as well as a PoolClient: DDL grants must run outside a
 * transaction block, so this uses the pool directly rather than a client.
 */
export async function applyGrants(
    client: Pick<Pool | PoolClient, 'query'>,
    role: string,
    password: string,
): Promise<{ created: boolean }> {
    const passwordLiteral = `'${password.replace(/'/g, "''")}'`;
    const roleIdent = `"${role.replace(/"/g, '""')}"`;
    const roleLiteral = `'${role.replace(/'/g, "''")}'`;

    const { rows } = await client.query<{ rolname: string }>('SELECT rolname FROM pg_roles WHERE rolname = $1', [role]);
    const created = rows.length === 0;

    if (created) {
        await client.query(`CREATE ROLE ${roleIdent} LOGIN PASSWORD ${passwordLiteral}`);
    } else {
        await client.query(`ALTER ROLE ${roleIdent} LOGIN PASSWORD ${passwordLiteral}`);
    }

    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdent}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${roleIdent}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleIdent}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${roleIdent}`);
    await client.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO ${roleIdent}`);

    // future migrations keep granting automatically to the same role
    await client.query(`
        DO $do$
        BEGIN
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', ${roleLiteral});
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public
                GRANT USAGE, SELECT ON SEQUENCES TO %I', ${roleLiteral});
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public
                GRANT EXECUTE ON FUNCTIONS TO %I', ${roleLiteral});
        END $do$;
    `);

    // the migration ledger belongs to the admin role only
    await client.query('DO $do$ BEGIN REVOKE ALL ON schema_migrations FROM PUBLIC; EXCEPTION WHEN undefined_table THEN NULL; END $do$');

    return { created };
}
