import type { Pool, PoolClient } from 'pg';

const roleName = (name: string): string => `"${name.replace(/"/g, '""')}"`;

export async function bootstrapDatabaseRoles(
    client: Pick<Pool | PoolClient, 'query'>,
    appRole: string,
    appPassword: string,
): Promise<{ appRoleCreated: boolean; definerRoleCreated: boolean }> {
    if (!appRole || appRole.length > 63) {
        throw new Error('A valid APP_DB_USER role name is required for database bootstrap');
    }
    if (!appPassword || appPassword.length < 16) {
        throw new Error('APP_DB_PASSWORD must be at least 16 characters for database bootstrap');
    }

    const appIdent = roleName(appRole);
    const passwordLiteral = `'${appPassword.replace(/'/g, "''")}'`;

    const { rows: appRows } = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS exists',
        [appRole],
    );
    const appRoleCreated = !appRows[0]?.exists;

    await client.query(`
        DO $bootstrap_app$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${roleNameLiteral(appRole)}) THEN
                CREATE ROLE ${appIdent} LOGIN PASSWORD ${passwordLiteral}
                    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
            ELSE
                ALTER ROLE ${appIdent} LOGIN PASSWORD ${passwordLiteral}
                    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
            END IF;
        END
        $bootstrap_app$
    `);

    const definerRole = 'hq_notification_definer';
    const { rows: definerRows } = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS exists',
        [definerRole],
    );
    const definerRoleCreated = !definerRows[0]?.exists;

    await client.query(`
        DO $bootstrap_definer$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hq_notification_definer') THEN
                CREATE ROLE hq_notification_definer NOLOGIN
                    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
            ELSE
                ALTER ROLE hq_notification_definer NOLOGIN
                    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
            END IF;
        END
        $bootstrap_definer$
    `);

    return { appRoleCreated, definerRoleCreated };
}

function roleNameLiteral(name: string): string {
    return `'${name.replace(/'/g, "''")}'`;
}
