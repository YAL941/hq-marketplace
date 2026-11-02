import { Pool } from 'pg';
import { config } from '../config.js';

if (config.NODE_ENV === 'production' && !['migration', 'preflight'].includes(config.PROCESS_ROLE)) {
    throw new Error('Administrative database access requires PROCESS_ROLE=migration or preflight');
}
if (!config.PGUSER || !config.PGPASSWORD) {
    throw new Error('Administrative database credentials are required for trusted database tooling');
}
const adminUser = config.PGUSER;
const adminPassword = config.PGPASSWORD;

/** Imported only by trusted migration, grant, preflight, and operator scripts. */
export const adminPool = new Pool({
    host: config.PGHOST,
    port: config.PGPORT,
    database: config.PGDATABASE,
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
