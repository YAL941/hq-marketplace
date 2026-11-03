import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { adminPool } from './admin-pool.js';
import { bootstrapDatabaseRoles } from './bootstrap.js';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(here, '..', '..', 'db', 'migrations');
const DOWN_DIR = join(MIGRATIONS_DIR, 'down');

export interface Migration {
    version: string;
    name: string;
    sql: string;
    downSql: string;
}

export async function loadMigrations(): Promise<Migration[]> {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const migrations: Migration[] = [];

    for (const file of files) {
        const name = file.replace(/\.sql$/, '');
        const version = name.slice(0, name.indexOf('_'));
        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
        let downSql = '';
        try {
            downSql = await readFile(join(DOWN_DIR, file), 'utf8');
        } catch {
            console.warn(`[migrate] WARNING: no rollback script for ${file}`);
        }
        migrations.push({ version, name, sql, downSql });
    }
    return migrations;
}

const checksum = (sql: string): string => createHash('sha256').update(sql).digest('hex').slice(0, 16);

export async function ensureRegistry(): Promise<void> {
    await adminPool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            checksum    TEXT NOT NULL,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

function quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

async function getMigrationRole(client: PoolClient): Promise<string> {
    const { rows } = await client.query<{ role_name: string }>('SELECT current_user::text AS role_name');
    const migrationRole = rows[0]?.role_name;
    if (!migrationRole) {
        throw new Error('migration ownership prerequisite missing: current migration role is unavailable');
    }
    return migrationRole;
}

async function assertDefinerMembershipCanBeGranted(client: PoolClient): Promise<string> {
    const { rows: roleRows } = await client.query<{ exists: boolean }>(`
        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolname = 'hq_notification_definer'
               AND NOT rolcanlogin
               AND NOT rolsuper
               AND NOT rolcreatedb
               AND NOT rolcreaterole
               AND NOT rolinherit
               AND NOT rolbypassrls
        ) AS exists
    `);
    if (!roleRows[0]?.exists) {
        throw new Error(
            'migration ownership prerequisite missing: safe NOLOGIN hq_notification_definer role must exist',
        );
    }
    const migrationRole = await getMigrationRole(client);
    const { rows: membershipRows } = await client.query<{ active: boolean }>(`
        SELECT EXISTS (
            SELECT 1
              FROM pg_catalog.pg_auth_members am
              JOIN pg_catalog.pg_roles member ON member.oid = am.member
              JOIN pg_catalog.pg_roles granted ON granted.oid = am.roleid
             WHERE member.rolname = current_user::text
               AND granted.rolname = 'hq_notification_definer'
        ) AS active
    `);
    if (membershipRows[0]?.active) {
        throw new Error(
            'unexpected existing hq_notification_definer membership: migration role already has this role; refusing to delete pre-existing membership',
        );
    }
    return migrationRole;
}

export async function executeOwnershipMigration(
    client: PoolClient,
    migration: Migration,
    migrationChecksum: string,
): Promise<void> {
    await client.query('BEGIN');
    try {
        const migrationRole = await assertDefinerMembershipCanBeGranted(client);

        await client.query(
            `GRANT hq_notification_definer TO ${quoteIdentifier(migrationRole)}`,
        );
        await client.query(migration.sql);
        await client.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [migration.version, migration.name, migrationChecksum],
        );

        await client.query(
            `REVOKE hq_notification_definer FROM ${quoteIdentifier(migrationRole)}`,
        );
        const { rows } = await client.query<{ active: boolean }>(`
            SELECT EXISTS (
                SELECT 1
                  FROM pg_catalog.pg_auth_members am
                  JOIN pg_catalog.pg_roles member ON member.oid = am.member
                  JOIN pg_catalog.pg_roles granted ON granted.oid = am.roleid
                 WHERE member.rolname = current_user::text
                   AND granted.rolname = 'hq_notification_definer'
            ) AS active
        `);
        if (rows[0]?.active) {
            throw new Error(
                'temporary hq_notification_definer membership could not be revoked before migration commit',
            );
        }

        await client.query('COMMIT');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            throw new Error(
                `${(error as Error).message}; rollback also failed: ${(rollbackError as Error).message}`,
            );
        }
        throw error;
    }
}

export async function executeOwnershipDownMigration(
    client: PoolClient,
    migration: Migration,
): Promise<void> {
    await client.query('BEGIN');
    try {
        const migrationRole = await assertDefinerMembershipCanBeGranted(client);

        if (migration.version === '064') {
            const { rows } = await client.query<{ applied: boolean }>(`
                SELECT EXISTS (
                    SELECT 1 FROM schema_migrations WHERE version = '065'
                ) AS applied
            `);
            if (rows[0]?.applied) {
                throw new Error(
                    'unsafe reverse migration ordering: migration 064 cannot be rolled back while migration 065 is applied; roll back 065 first',
                );
            }
        }

        await client.query(
            `GRANT hq_notification_definer TO ${quoteIdentifier(migrationRole)}`,
        );
        await client.query(migration.downSql);
        await client.query(
            'DELETE FROM schema_migrations WHERE version = $1',
            [migration.version],
        );
        await client.query(
            `REVOKE hq_notification_definer FROM ${quoteIdentifier(migrationRole)}`,
        );
        const { rows } = await client.query<{ active: boolean }>(`
            SELECT EXISTS (
                SELECT 1
                  FROM pg_catalog.pg_auth_members am
                  JOIN pg_catalog.pg_roles member ON member.oid = am.member
                  JOIN pg_catalog.pg_roles granted ON granted.oid = am.roleid
                 WHERE member.rolname = current_user::text
                   AND granted.rolname = 'hq_notification_definer'
            ) AS active
        `);
        if (rows[0]?.active) {
            throw new Error(
                'temporary hq_notification_definer membership could not be revoked before migration rollback commit',
            );
        }
        if (migration.version === '064') {
            await client.query('DROP ROLE hq_notification_definer');
        }

        await client.query('COMMIT');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            throw new Error(
                `${(error as Error).message}; rollback also failed: ${(rollbackError as Error).message}`,
            );
        }
        throw error;
    }
}

export async function migrateUp(): Promise<string[]> {
    await ensureRegistry();
    await bootstrapDatabaseRoles(adminPool, config.APP_DB_USER, config.APP_DB_PASSWORD);
    const migrations = await loadMigrations();
    const { rows } = await adminPool.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const executed: string[] = [];

    for (const migration of migrations) {
        const existing = applied.get(migration.version);
        if (existing !== undefined) {
            if (existing !== checksum(migration.sql)) {
                console.warn(
                    `[migrate] ${migration.name} changed after being applied. Add a new migration instead of editing it.`,
                );
            }
            continue;
        }
        if (migration.version === '061') {
            if (config.APP_DB_USER !== 'hq_app') {
                throw new Error(
                    'migration 061 prerequisite invalid: migration 061 grants privileges specifically to hq_app; APP_DB_USER must be hq_app',
                );
            }
            const { rows: roleRows } = await adminPool.query<{ exists: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS exists',
                [config.APP_DB_USER],
            );
            if (!roleRows[0]?.exists) {
                throw new Error(
                    `migration 061 prerequisite missing: role "${config.APP_DB_USER}" must exist. Run db:bootstrap before migrations`,
                );
            }
        }

        const client = await adminPool.connect();
        try {
            if (migration.version === '064' || migration.version === '065') {
                await executeOwnershipMigration(client, migration, checksum(migration.sql));
            } else {
                await client.query('BEGIN');
                await client.query(migration.sql);
                await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
                    migration.version,
                    migration.name,
                    checksum(migration.sql),
                ]);
                await client.query('COMMIT');
            }
            executed.push(migration.name);
        } catch (error) {
            if (migration.version !== '064' && migration.version !== '065') {
                try {
                    await client.query('ROLLBACK');
                } catch {
                    // Preserve the migration error when rollback itself fails.
                }
            }
            throw new Error(`migration ${migration.name} failed: ${(error as Error).message}`);
        } finally {
            client.release();
        }
    }
    return executed;
}

export async function migrateDown(options: { allowDataLoss?: boolean } = {}): Promise<string | null> {
    const { rows } = await adminPool.query<{ version: string; name: string }>(
        'SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1',
    );
    const last = rows[0];
    if (!last) return null;

    const migrations = await loadMigrations();
    const migration = migrations.find((m) => m.version === last.version);
    if (!migration?.downSql) {
        throw new Error(`no rollback script available for ${last.name}`);
    }

    // A rollback is treated as destructive unless its script opts out with
    // an explicit "-- destructive: false" marker.
    const destructive = !/^--\s*destructive:\s*false/im.test(migration.downSql);
    if (destructive && !options.allowDataLoss) {
        throw new Error(
            `rolling back ${last.name} DROPS tables and their data. Pass allowDataLoss only if that is intended.`,
        );
    }

    const client = await adminPool.connect();
    try {
        if (migration.version === '064' || migration.version === '065') {
            await executeOwnershipDownMigration(client, migration);
        } else {
            await client.query('BEGIN');
            await client.query(migration.downSql);
            await client.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version]);
            await client.query('COMMIT');
        }
    } catch (error) {
        if (migration.version !== '064' && migration.version !== '065') {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Preserve the original migration error.
            }
        }
        throw error;
    } finally {
        client.release();
    }
    return last.name;
}

export async function migrationStatus(): Promise<Array<{ version: string; name: string; applied: boolean; at?: Date }>> {
    await ensureRegistry();
    const migrations = await loadMigrations();
    const { rows } = await adminPool.query<{ version: string; applied_at: Date }>(
        'SELECT version, applied_at FROM schema_migrations',
    );
    const appliedAt = new Map(rows.map((r) => [r.version, r.applied_at]));
    return migrations.map((m) => ({
        version: m.version,
        name: m.name,
        applied: appliedAt.has(m.version),
        at: appliedAt.get(m.version),
    }));
}
