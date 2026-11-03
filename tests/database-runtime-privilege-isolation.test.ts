import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('runtime database privilege isolation', () => {
    it('does not inject administrative credentials into the Compose API service', () => {
        const compose = read('docker-compose.yml');
        const api = compose.match(/(?:^|\n)  app:\r?\n([\s\S]*?)(?=\n  [\w-]+:\r?\n|\nvolumes:)/)?.[1];
        assert.ok(api, 'Compose app service must exist');
        assert.match(api, /PGUSER:\s*""/);
        assert.match(api, /PGPASSWORD:\s*""/);
        assert.doesNotMatch(api, /PGUSER:\s*\$\{|PGPASSWORD:\s*\$\{/);
    });

    it('configures the API pool with only the restricted runtime role', () => {
        const pool = read('src/db/pool.ts');
        assert.match(pool, /user:\s*config\.APP_DB_CONNECTION_USER\s*\?\?\s*config\.APP_DB_USER/);
        assert.match(pool, /password:\s*config\.APP_DB_PASSWORD/);
        assert.doesNotMatch(pool, /adminPool|config\.PGUSER|config\.PGPASSWORD/);
        assert.doesNotMatch(read('src/server.ts') + read('src/app.ts'), /admin-pool\.js/);
        assert.match(pool, /createPostgresTlsOptions\(config\.PG_TLS_MODE, config\.PG_SSL_CA_FILE\)/);
    });

    it('keeps privileged access in explicit trusted database tooling', () => {
        assert.match(read('src/db/admin-pool.ts'), /PROCESS_ROLE=migration or preflight/);
        assert.match(read('src/db/admin-pool.ts'), /host:\s*directHost/);
        assert.doesNotMatch(read('src/db/admin-pool.ts'), /host:\s*config\.PGHOST/);
        assert.match(read('src/db/migrator.ts'), /from '\.\/admin-pool\.js'/);
        assert.match(read('scripts/apply-grants.ts'), /admin-pool\.js/);
        const scripts = read('package.json');
        assert.match(scripts, /PROCESS_ROLE=migration tsx scripts\/migrate\.ts/);
        assert.match(scripts, /PROCESS_ROLE=preflight tsx scripts\/preflight\.ts/);
    });

    it('uses an atomic ownership migration membership lifecycle without cross-migration state', () => {
        const migrator = read('src/db/migrator.ts');
        assert.match(migrator, /executeOwnershipMigration/);
        assert.match(migrator, /executeOwnershipDownMigration/);
        assert.match(migrator, /unexpected existing hq_notification_definer membership/);
        assert.match(migrator, /^.*REVOKE hq_notification_definer.*$/m);
        assert.doesNotMatch(migrator, /definerMembershipActive|definerMembershipGrantedByMigration/);
        assert.doesNotMatch(migrator, /revokeDefinerMembershipIfPossible/);
    });

    it('keeps the email worker on its dedicated, restricted identity', () => {
        const pool = read('src/db/notification-worker-pool.ts');
        assert.match(pool, /user:\s*config\.NOTIFICATION_WORKER_DB_USER/);
        assert.match(pool, /password:\s*config\.NOTIFICATION_WORKER_DB_PASSWORD/);
        assert.match(pool, /createPostgresTlsOptions\(config\.PG_TLS_MODE, config\.PG_SSL_CA_FILE\)/);
        assert.match(read('src/modules/notifications/email-worker.store.ts'), /SET LOCAL ROLE hq_notification_worker/);
        assert.match(read('src/modules/notifications/email-worker.store.ts'), /assertNotificationWorkerIdentity/);
    });

    it('keeps PostgreSQL TLS settings shared without sharing runtime credentials', () => {
        const helper = read('src/db/postgres-tls.ts');
        assert.match(helper, /rejectUnauthorized:\s*true/);
        assert.match(read('src/db/admin-pool.ts'), /createPostgresTlsOptions\(config\.PG_TLS_MODE, config\.PG_SSL_CA_FILE\)/);
        assert.match(read('src/db/pool.ts'), /user:\s*config\.APP_DB_CONNECTION_USER\s*\?\?\s*config\.APP_DB_USER/);
        assert.match(read('src/db/notification-worker-pool.ts'), /user:\s*config\.NOTIFICATION_WORKER_DB_USER/);
    });
});
