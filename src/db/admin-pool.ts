import { Pool } from 'pg';
import { config } from '../config.js';
import { createPostgresTlsOptions } from './postgres-tls.js';
import { resolveDirectMigrationHost } from './connection-endpoints.js';

if (config.NODE_ENV === 'production' && !['migration', 'preflight'].includes(config.PROCESS_ROLE)) {
    throw new Error('Administrative database access requires PROCESS_ROLE=migration or preflight');
}
if (!config.PGUSER || !config.PGPASSWORD) {
    throw new Error('Administrative database credentials are required for trusted database tooling');
}
const adminUser = config.PGUSER;
const adminPassword = config.PGPASSWORD;
const directHost = resolveDirectMigrationHost({
    directHost: config.PG_DIRECT_HOST,
    managedMode: config.PG_MANAGED_MODE,
});

/** Imported only by trusted migration, grant, preflight, and operator scripts. */
export const adminPool = new Pool({
    host: directHost,
    port: config.PGPORT,
    database: config.PGDATABASE,
    ssl: createPostgresTlsOptions(config.PG_TLS_MODE, config.PG_SSL_CA_FILE),
    user: adminUser,
    password: adminPassword,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'hq-admin',
});

export async function closeAdminPool(): Promise<void> {
    await adminPool.end();
}
