import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminPool } from './pool.js';
const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(here, '..', '..', 'db', 'migrations');
const DOWN_DIR = join(MIGRATIONS_DIR, 'down');
export async function loadMigrations() {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const migrations = [];
    for (const file of files) {
        const name = file.replace(/\.sql$/, '');
        const version = name.slice(0, name.indexOf('_'));
        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
        let downSql = '';
        try {
            downSql = await readFile(join(DOWN_DIR, file), 'utf8');
        }
        catch {
            console.warn(`[migrate] WARNING: no rollback script for ${file}`);
        }
        migrations.push({ version, name, sql, downSql });
    }
    return migrations;
}
const checksum = (sql) => createHash('sha256').update(sql).digest('hex').slice(0, 16);
export async function ensureRegistry() {
    await adminPool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            checksum    TEXT NOT NULL,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}
export async function migrateUp() {
    await ensureRegistry();
    const migrations = await loadMigrations();
    const { rows } = await adminPool.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const executed = [];
    for (const migration of migrations) {
        const existing = applied.get(migration.version);
        if (existing !== undefined) {
            if (existing !== checksum(migration.sql)) {
                console.warn(`[migrate] ${migration.name} changed after being applied. Add a new migration instead of editing it.`);
            }
            continue;
        }
        const client = await adminPool.connect();
        try {
            await client.query('BEGIN');
            await client.query(migration.sql);
            await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
                migration.version,
                migration.name,
                checksum(migration.sql),
            ]);
            await client.query('COMMIT');
            executed.push(migration.name);
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw new Error(`migration ${migration.name} failed: ${error.message}`);
        }
        finally {
            client.release();
        }
    }
    return executed;
}
export async function migrateDown(options = {}) {
    const { rows } = await adminPool.query('SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1');
    const last = rows[0];
    if (!last)
        return null;
    const migrations = await loadMigrations();
    const migration = migrations.find((m) => m.version === last.version);
    if (!migration?.downSql) {
        throw new Error(`no rollback script available for ${last.name}`);
    }
    // A rollback is treated as destructive unless its script opts out with
    // an explicit "-- destructive: false" marker.
    const destructive = !/^--\s*destructive:\s*false/im.test(migration.downSql);
    if (destructive && !options.allowDataLoss) {
        throw new Error(`rolling back ${last.name} DROPS tables and their data. Pass allowDataLoss only if that is intended.`);
    }
    const client = await adminPool.connect();
    try {
        await client.query('BEGIN');
        await client.query(migration.downSql);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version]);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
    return last.name;
}
export async function migrationStatus() {
    await ensureRegistry();
    const migrations = await loadMigrations();
    const { rows } = await adminPool.query('SELECT version, applied_at FROM schema_migrations');
    const appliedAt = new Map(rows.map((r) => [r.version, r.applied_at]));
    return migrations.map((m) => ({
        version: m.version,
        name: m.name,
        applied: appliedAt.has(m.version),
        at: appliedAt.get(m.version),
    }));
}
//# sourceMappingURL=migrator.js.map