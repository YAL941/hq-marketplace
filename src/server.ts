import { createApp } from './app.js';
import { config } from './config.js';
import { closePools } from './db/pool.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
    console.log(`[hq] API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

async function shutdown(signal: string): Promise<void> {
    console.log(`[hq] ${signal} received, closing`);
    server.close(async () => {
        await closePools();
        process.exit(0);
    });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
