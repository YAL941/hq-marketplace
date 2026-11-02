import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { compareComposeVersions, validateComposeEnvironment } from '../scripts/validate-compose-config.mjs';

const secretFiles: Record<string, string> = {
    'api-db': 'app-database-password-9f15a6',
    'worker-db': 'worker-database-password-08bd71',
    'smtp-user': 'staging-smtp-user',
    'smtp-password': 'staging-smtp-password-31da0a',
};
const readTestSecret = async (path: string) => {
    if (!(path in secretFiles)) throw new Error('missing test secret file');
    return secretFiles[path]!;
};
const validEnvironment = {
    PGUSER: 'postgres_migrator',
    PGPASSWORD: 'migration-password-4c18db',
    APP_DB_USER: 'hq_app',
    APP_DB_PASSWORD_SECRET_FILE: 'api-db',
    NOTIFICATION_WORKER_DB_USER: 'hq_notification_worker_login',
    NOTIFICATION_WORKER_DB_PASSWORD_SECRET_FILE: 'worker-db',
    SMTP_USER_SECRET_FILE: 'smtp-user',
    SMTP_PASSWORD_SECRET_FILE: 'smtp-password',
    SMTP_HOST: 'smtp.staging.example.test',
    SMTP_TLS_MODE: 'starttls',
    SMTP_SECURE: 'false',
};

describe('Compose security configuration', () => {
    it('rejects missing database credentials without printing supplied values', async () => {
        const errors = await validateComposeEnvironment({
            ...validEnvironment,
            PGUSER: '',
            PGPASSWORD: '',
            NOTIFICATION_WORKER_DB_PASSWORD_SECRET_FILE: 'missing-file',
        }, readTestSecret);
        assert.ok(errors.some((entry) => entry.startsWith('PGUSER is required')));
        assert.ok(errors.some((entry) => entry.startsWith('PGPASSWORD is required')));
        assert.ok(errors.some((entry) => entry.includes('readable secret file')));
        assert.ok(errors.every((entry) => !entry.includes('migration-password')));
    });

    it('rejects weak database passwords and role reuse', async () => {
        const errors = await validateComposeEnvironment({
            ...validEnvironment,
            PGUSER: 'hq_app',
            PGPASSWORD: 'change-me',
        }, readTestSecret);
        assert.ok(errors.some((entry) => entry.startsWith('PGPASSWORD must be')));
        assert.ok(errors.some((entry) => entry.includes('APP_DB_USER must differ')));
    });

    it('rejects weak mounted API and worker database secrets', async () => {
        const errors = await validateComposeEnvironment(validEnvironment, async (path) => {
            if (path === 'api-db' || path === 'worker-db') return 'postgres';
            return readTestSecret(path);
        });
        assert.ok(errors.some((entry) => entry.startsWith('APP_DB_PASSWORD must be')));
        assert.ok(errors.some((entry) => entry.startsWith('notification worker database password must be')));
    });

    it('accepts strong distinct database credentials and a complete STARTTLS setup', async () => {
        assert.deepEqual(await validateComposeEnvironment(validEnvironment, readTestSecret), []);
    });

    it('rejects incomplete or mismatched SMTP TLS settings', async () => {
        const missingMode = await validateComposeEnvironment({ ...validEnvironment, SMTP_TLS_MODE: '' }, readTestSecret);
        assert.ok(missingMode.some((entry) => entry.startsWith('SMTP_TLS_MODE must explicitly')));
        const mismatch = await validateComposeEnvironment({ ...validEnvironment, SMTP_TLS_MODE: 'implicit' }, readTestSecret);
        assert.ok(mismatch.some((entry) => entry.startsWith('SMTP_SECURE does not match')));
        const missingCredential = await validateComposeEnvironment({ ...validEnvironment, SMTP_PASSWORD_SECRET_FILE: '' }, readTestSecret);
        assert.ok(missingCredential.some((entry) => entry.startsWith('SMTP username and password secret files are required')));
    });

    it('keeps staging Compose external-database only and scopes file secrets to app and worker', async () => {
        const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
        const localCompose = await readFile(new URL('../docker-compose.local.yml', import.meta.url), 'utf8');
        const app = compose.split('  email-worker:')[0]!;
        const worker = compose.split('  email-worker:')[1]!.split('\nsecrets:')[0]!;
        assert.doesNotMatch(compose, /\$\{PGPASSWORD:-postgres\}|\$\{PGUSER:-postgres\}/);
        assert.match(app, /PGHOST: \$\{PGHOST:\?set the staging PostgreSQL host\}/);
        assert.match(app, /PGUSER: ""/);
        assert.match(app, /PGPASSWORD: ""/);
        assert.match(app, /APP_DB_PASSWORD_FILE: \/run\/secrets\/app_db_password/);
        assert.match(app, /SMTP_USER_FILE: \/run\/secrets\/smtp_user/);
        assert.doesNotMatch(app, /NOTIFICATION_WORKER_DB_PASSWORD_FILE: \/run\/secrets\/notification_worker_db_password/);
        assert.match(worker, /NOTIFICATION_WORKER_DB_PASSWORD_FILE: \/run\/secrets\/notification_worker_db_password/);
        assert.match(worker, /SMTP_TLS_MODE:/);
        assert.doesNotMatch(compose, /environment:\s*(?:PGPASSWORD|SMTP_PASSWORD)/);
        assert.match(localCompose, /127\.0\.0\.1:/);
        assert.match(localCompose, /local-postgres-data/);
    });

    it('requires the documented minimum Docker Compose version', () => {
        assert.equal(compareComposeVersions('Docker Compose version v2.32.0'), true);
        assert.equal(compareComposeVersions('v2.31.9'), false);
        assert.equal(compareComposeVersions('not-a-version'), false);
    });
});
