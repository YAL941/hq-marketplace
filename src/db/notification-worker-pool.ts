import { Pool } from 'pg';
import { config } from '../config.js';

/** Dedicated pool: it never reads or creates the migration/admin or API pools. */
export const notificationWorkerPool = new Pool({
    host: config.PGHOST,
    port: config.PGPORT,
    database: config.PGDATABASE,
    user: config.NOTIFICATION_WORKER_DB_USER,
    password: config.NOTIFICATION_WORKER_DB_PASSWORD,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'hq-notification-worker',
});

export async function closeNotificationWorkerPool(): Promise<void> {
    await notificationWorkerPool.end();
}
