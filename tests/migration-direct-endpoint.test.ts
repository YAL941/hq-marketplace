import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    isKnownPooledHostname,
    resolveDirectMigrationHost,
} from '../src/db/connection-endpoints.js';
import { createPostgresTlsOptions } from '../src/db/postgres-tls.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('migration direct endpoint separation', () => {
    it('selects the explicit direct migration endpoint', () => {
        assert.equal(resolveDirectMigrationHost({
            directHost: 'db.example.direct.internal',
            managedMode: 'managed',
        }), 'db.example.direct.internal');
    });

    it('rejects missing managed direct endpoint configuration', () => {
        assert.throws(
            () => resolveDirectMigrationHost({ managedMode: 'managed' }),
            /PG_DIRECT_HOST is required/,
        );
    });

    it('never falls back to PGHOST for migration/admin connections', () => {
        const helper = read('src/db/connection-endpoints.ts');
        const adminPool = read('src/db/admin-pool.ts');
        assert.doesNotMatch(helper, /options\.runtimeHost|directHost\s*\?\?|PGHOST\s*:/i);
        assert.match(adminPool, /resolveDirectMigrationHost/);
        assert.match(adminPool, /host:\s*directHost/);
        assert.doesNotMatch(adminPool, /host:\s*config\.PGHOST/);
    });

    it('rejects known transaction-pooled hostnames', () => {
        assert.equal(isKnownPooledHostname('ep-example-pooler.eu-central-1.aws.neon.tech'), true);
        assert.equal(isKnownPooledHostname('db.example.pooler.supabase.com'), true);
        assert.throws(
            () => resolveDirectMigrationHost({
                directHost: 'ep-example-pooler.eu-central-1.aws.neon.tech',
                managedMode: 'managed',
            }),
            /known transaction-pooling hostname/,
        );
    });

    it('keeps runtime API and worker pools on PGHOST', () => {
        const apiPool = read('src/db/pool.ts');
        const workerPool = read('src/db/notification-worker-pool.ts');
        assert.match(apiPool, /host:\s*config\.PGHOST/);
        assert.match(workerPool, /host:\s*config\.PGHOST/);
        assert.doesNotMatch(apiPool, /config\.PG_DIRECT_HOST/);
        assert.doesNotMatch(workerPool, /config\.PG_DIRECT_HOST/);
    });

    it('retains verify-full TLS policy for direct migration connections', () => {
        assert.deepEqual(
            createPostgresTlsOptions('verify-full'),
            { rejectUnauthorized: true },
        );
        const adminPool = read('src/db/admin-pool.ts');
        assert.match(adminPool, /createPostgresTlsOptions\(config\.PG_TLS_MODE, config\.PG_SSL_CA_FILE\)/);
    });

    it('documents and guards worker provisioning without application role creation', () => {
        const docs = read('docs/email-notification-operations.md');
        const pool = read('src/db/notification-worker-pool.ts');
        assert.match(docs, /NOT VERIFIED on Neon/);
        assert.match(docs, /Do not place the worker password/);
        assert.match(docs, /revoke.*membership/i);
        assert.doesNotMatch(docs, /CREATE ROLE|CREATE USER/i);
        assert.match(pool, /user:\s*config\.NOTIFICATION_WORKER_DB_USER/);
    });
});
