import { Client } from 'pg';
import { config } from '../src/config.js';

const TARGETS = [config.PGDATABASE, `${config.PGDATABASE}_test`];

async function ensureDatabase(client: Client, name: string): Promise<void> {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount && rowCount > 0) {
        console.log(`[db] database ${name} already exists`);
        return;
    }
    // identifier cannot be parameterised
    await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    console.log(`[db] database ${name} created`);
}

async function main(): Promise<void> {
    const client = new Client({
        host: config.PGHOST,
        port: config.PGPORT,
        database: 'postgres',
        user: config.PGUSER,
        password: config.PGPASSWORD,
    });
    await client.connect();
    try {
        for (const name of TARGETS) {
            await ensureDatabase(client, name);
        }
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error('[db] failed to create databases:', error.message);
    process.exit(1);
});
