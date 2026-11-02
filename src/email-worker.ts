import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { WorkerHealthFiles } from './modules/notifications/worker-health.js';

async function loadSecret(variable: string, fileVariable: string): Promise<void> {
    const file = process.env[fileVariable];
    if (!file || process.env[variable]) return;
    try {
        process.env[variable] = (await readFile(file, 'utf8')).trim();
    } catch {
        throw new Error(`${fileVariable} could not be read`);
    }
}

async function main(): Promise<void> {
    process.env['PROCESS_ROLE'] = 'notification_worker';
    await loadSecret('NOTIFICATION_WORKER_DB_PASSWORD', 'NOTIFICATION_WORKER_DB_PASSWORD_FILE');
    await loadSecret('SMTP_USER', 'SMTP_USER_FILE');
    await loadSecret('SMTP_PASSWORD', 'SMTP_PASSWORD_FILE');

    let closePool: (() => Promise<void>) | undefined;
    try {
        const [{ config }, { notificationWorkerPool, closeNotificationWorkerPool }, { SmtpEmailAdapter },
            { PgEmailWorkerStore, assertNotificationWorkerIdentity }, { EmailNotificationWorker }] = await Promise.all([
            import('./config.js'),
            import('./db/notification-worker-pool.js'),
            import('./modules/notifications/email-adapter.js'),
            import('./modules/notifications/email-worker.store.js'),
            import('./modules/notifications/email-worker.service.js'),
        ]);
        closePool = closeNotificationWorkerPool;

        await assertNotificationWorkerIdentity(notificationWorkerPool);
        const heartbeatFile = process.env['EMAIL_WORKER_HEARTBEAT_FILE'] ?? '/tmp/hq-email-worker-heartbeat';
        const readinessFile = process.env['EMAIL_WORKER_READINESS_FILE'] ?? '/tmp/hq-email-worker-readiness';
        const healthFiles = new WorkerHealthFiles(heartbeatFile, readinessFile);
        // A container restart may preserve /tmp. Do not let a prior process's
        // recent markers make this process appear healthy before its DB probe.
        await healthFiles.clear();
        const adapter = new SmtpEmailAdapter();
        const store = new PgEmailWorkerStore(notificationWorkerPool);
        let lastHealthCheck = 0;
        let lastHealthKey = '';
        let lastSmtpStatus = '';
        let pendingSmtpOutcome: { errorCode: string | null; succeeded: boolean } = { errorCode: null, succeeded: false };
        let smtpOutcomeVersion = 0;
        const worker = new EmailNotificationWorker({
            store,
            adapter,
            batchSize: config.EMAIL_WORKER_BATCH_SIZE,
            concurrency: config.EMAIL_WORKER_CONCURRENCY,
            pollIntervalMs: config.EMAIL_WORKER_POLL_INTERVAL_MS,
            leaseSeconds: config.EMAIL_WORKER_LEASE_SECONDS,
            smtpOutcome: (outcome) => {
                pendingSmtpOutcome = outcome.success
                    ? { errorCode: null, succeeded: true }
                    : { errorCode: outcome.code, succeeded: false };
                smtpOutcomeVersion += 1;
                // Persist a send result promptly instead of waiting for the next
                // periodic backlog log interval.
                lastHealthCheck = 0;
            },
            heartbeat: async () => {
                await healthFiles.markAlive();
                if (Date.now() - lastHealthCheck < 15_000) return;
                lastHealthCheck = Date.now();
                try {
                    const submittedOutcomeVersion = smtpOutcomeVersion;
                    const health = await store.deliveryHealth(adapter.isConfigured(), pendingSmtpOutcome);
                    if (smtpOutcomeVersion === submittedOutcomeVersion) {
                        pendingSmtpOutcome = { errorCode: null, succeeded: false };
                    }
                    const counts = Object.fromEntries(health.queue.map((row) => [
                        row.last_error_code ? `${row.status}:${row.last_error_code}` : row.status,
                        Number(row.record_count),
                    ]));
                    const healthKey = JSON.stringify(counts);
                    if (healthKey !== lastHealthKey) {
                        console.info('[email-worker] delivery_backlog', counts);
                        lastHealthKey = healthKey;
                    }
                    const state = health.smtp;
                    await healthFiles.markDatabaseReady();
                    const smtpStatus = !state?.smtp_configured
                        ? 'not_configured'
                        : state.smtp_last_error_code ?? (state.smtp_last_success_at ? 'verified' : 'unverified');
                    if (smtpStatus !== lastSmtpStatus) {
                        console.info('[email-worker] smtp_delivery_status', smtpStatus);
                        lastSmtpStatus = smtpStatus;
                    }
                } catch {
                    await healthFiles.markDatabaseUnavailable();
                    if (lastSmtpStatus !== 'database_unavailable') {
                        console.error('[email-worker] database_readiness_failed');
                        lastSmtpStatus = 'database_unavailable';
                    }
                }
            },
            logger: console,
        });
        let stopping = false;
        const shutdown = async (signal: string) => {
            if (stopping) return;
            stopping = true;
            console.info('[email-worker] shutdown', signal);
            await worker.stop();
            await healthFiles.clear();
        };
        process.on('SIGTERM', () => { void shutdown('SIGTERM').then(() => { process.exitCode = 0; }); });
        process.on('SIGINT', () => { void shutdown('SIGINT').then(() => { process.exitCode = 0; }); });
        await worker.start();
    } finally {
        await closePool?.();
    }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
    main().catch((error: unknown) => {
        const code = error instanceof Error && /worker database identity/.test(error.message)
            ? 'unsafe_database_identity'
            : 'startup_failed';
        console.error('[email-worker]', code);
        process.exitCode = 1;
    });
}
