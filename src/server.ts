import { createApp } from './app.js';
import { config } from './config.js';
import { assertAppRoleIsSafe, closePools } from './db/pool.js';
import { installShutdownHandlers } from './shutdown.js';

/**
 * Starts the API only once the application database role has been checked.
 *
 * The check is awaited before the listener opens on purpose: a role that would
 * defeat row level security must end the process at startup, where the message
 * is still attached to whoever configured it. Opening the port first and failing
 * afterwards would leave a window in which the API answers from a database it
 * should never have queried.
 */
async function start(): Promise<void> {
    await assertAppRoleIsSafe();

    const app = createApp();
    const server = app.listen(config.PORT, () => {
        console.log(`[hq] API listening on port ${config.PORT} (${config.NODE_ENV})`);
    });

    installShutdownHandlers({ server, closePools });
}

void start().catch((error: unknown) => {
    console.error('[hq] failed to start:', error instanceof Error ? error.message : error);
    process.exit(1);
});