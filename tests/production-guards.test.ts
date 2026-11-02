/**
 * The production guards in `src/config.ts`.
 *
 * These guards are not ordinary validation. They exist because each of the
 * values they refuse produces a *silent* failure: a server that starts, serves
 * traffic, and quietly does the wrong thing. That is why they are tested as
 * refusal cases rather than as defaults, and why every message is asserted to
 * contain the remedy — a refusal nobody can act on just becomes an outage at
 * deploy time.
 *
 * `src/config.ts` reads `process.env` and validates at module load, so a test
 * cannot simply flip `NODE_ENV` and re-import: ES modules are cached per
 * process, and every other test file in this suite depends on the already-loaded
 * instance. Each case is therefore produced in a *child* process, given its own
 * environment, and asserted on through what it printed. That is slower than an
 * inline call but it is the only way to observe the real behaviour, and it also
 * proves the guard fires before anything else starts.
 */

import assertModule from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const assert: typeof assertModule = assertModule;
const run = promisify(execFile);

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const typescriptLoader = './tests/helpers/register-typescript-loader.mjs';
const configUrl = pathToFileURL(resolve(projectRoot, 'src/config.ts')).href;

/** Everything a production boot needs to be allowed through the existing guards. */
const VALID_PRODUCTION_ENV: Record<string, string> = {
    NODE_ENV: 'production',
    PGHOST: 'db.internal',
    PGDATABASE: 'hq_marketplace',
    APP_DB_USER: 'hq_app',
    APP_DB_PASSWORD: 'a-real-app-password-51ba9e30',
    JWT_SECRET: 'a-real-jwt-signing-secret-4d9e0c17b6a24f83',
    CORS_ORIGIN: 'https://app.example.com',
    TRUST_PROXY_HOPS: '1',
    UPLOAD_DIR: '/var/lib/hq-marketplace/uploads',
};

/**
 * Boots the config module in a child process with `overrides` applied on top of
 * a valid production environment.
 *
 * `overrides` entries with a value of `undefined` are deleted rather than set,
 * which is how "leave this out entirely" is expressed — the distinction between
 * `UPLOAD_DIR=` and no `UPLOAD_DIR` at all matters for several of these guards.
 *
 * The environment is built from scratch instead of inheriting, so a developer's
 * own `.env` cannot make a case pass or fail by accident.
 */
async function bootProductionConfig(
    overrides: Record<string, string | undefined>,
): Promise<{ ok: boolean; output: string }> {
    const env: Record<string, string> = {
        PATH: process.env['PATH'] ?? '',
        // A scratch HOME and no project `.env`, so dotenv has nothing to read.
        HOME: process.env['TEMP'] ?? process.env['TMP'] ?? '',
        DOTENV_CONFIG_PATH: resolve(projectRoot, 'no-such-file-for-this-test'),
    };
    for (const [key, value] of Object.entries({ ...VALID_PRODUCTION_ENV, ...overrides })) {
        if (value === undefined) delete env[key];
        else env[key] = value;
    }

    try {
        // The test-only loader runs this TypeScript config probe without tsx's
        // Windows temporary-directory path, which calls os.userInfo().
        const { stdout, stderr } = await run(
            process.execPath,
            [
                '--import',
                typescriptLoader,
                '--input-type=module',
                '-e',
                `import(${JSON.stringify(configUrl)}).then(({ config }) => console.log('BOOTED ORDERS_ENABLED=' + config.ORDERS_ENABLED))`,
            ],
            { cwd: projectRoot, env, encoding: 'utf8' },
        );
        return { ok: stdout.includes('BOOTED'), output: stdout + stderr };
    } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        return { ok: false, output: (failure.stdout ?? '') + (failure.stderr ?? '') };
    }
}

describe('production guards', () => {
    it('lets a fully configured production environment boot', async () => {
        // Without this, every refusal below could be passing for the wrong
        // reason: an environment that cannot boot at all makes "refuses" true
        // without proving which guard fired.
        const { ok, output } = await bootProductionConfig({});
        assert.equal(ok, true, `a valid production environment should boot, but:\n${output}`);
        assert.match(output, /ORDERS_ENABLED=true/);
    });

    it('defaults internal order creation on in every environment', async () => {
        const development = await bootProductionConfig({ NODE_ENV: 'development', ORDERS_ENABLED: undefined });
        const test = await bootProductionConfig({ NODE_ENV: 'test', ORDERS_ENABLED: undefined });
        const production = await bootProductionConfig({ ORDERS_ENABLED: undefined });

        assert.equal(development.ok, true, development.output);
        assert.equal(test.ok, true, test.output);
        assert.equal(production.ok, true, production.output);
        assert.match(development.output, /ORDERS_ENABLED=true/);
        assert.match(test.output, /ORDERS_ENABLED=true/);
        assert.match(production.output, /ORDERS_ENABLED=true/);
    });

    it('allows development startup when SMTP is intentionally disabled', async () => {
        const { ok, output } = await bootProductionConfig({
            NODE_ENV: 'development',
            SMTP_HOST: undefined,
            SMTP_TLS_MODE: undefined,
            SMTP_USER: undefined,
            SMTP_PASSWORD: undefined,
        });
        assert.equal(ok, true, output);
    });

    it('rejects configured SMTP without an explicit TLS mode without printing credentials', async () => {
        const smtpSecret = 'smtp-secret-must-not-appear-830f7ca1';
        const { ok, output } = await bootProductionConfig({
            SMTP_HOST: 'smtp.example.test',
            SMTP_TLS_MODE: undefined,
            SMTP_USER: 'test-user',
            SMTP_PASSWORD: smtpSecret,
        });
        assert.equal(ok, false);
        assert.match(output, /API SMTP requires SMTP_TLS_MODE/);
        assert.doesNotMatch(output, new RegExp(smtpSecret));
    });

    it('lets the API boot without administrative database credentials', async () => {
        const { ok, output } = await bootProductionConfig({ PGUSER: undefined, PGPASSWORD: undefined });
        assert.equal(ok, true, output);
    });

    it('refuses administrative database credentials in API mode', async () => {
        const { ok, output } = await bootProductionConfig({
            PGUSER: 'postgres', PGPASSWORD: 'a-real-admin-password-8f2c41d7',
        });
        assert.equal(ok, false);
        assert.match(output, /API must not receive administrative database credentials/);
    });

    it('refuses a placeholder migration password', async () => {
        // PGPASSWORD is the schema owner's password — the one role that
        // bypasses row level security. `change-me` is what .env.example ships.
        const { ok, output } = await bootProductionConfig({
            PROCESS_ROLE: 'migration', PGUSER: 'postgres', PGPASSWORD: 'change-me',
        });
        assert.equal(ok, false);
        assert.match(output, /Refusing to start/);
        assert.match(output, /PGPASSWORD/);
        assert.match(output, /placeholder/i);
    });

    it('refuses a short migration password', async () => {
        const { ok, output } = await bootProductionConfig({
            PROCESS_ROLE: 'migration', PGUSER: 'postgres', PGPASSWORD: 'short',
        });
        assert.equal(ok, false);
        assert.match(output, /PGPASSWORD/);
        assert.match(output, /16/);
    });

    it('refuses the runtime and migration roles sharing one database role in trusted migration mode', async () => {
        // The failure this prevents has no symptom: the API becomes the table
        // owner, policies are bypassed, and every request still returns 200.
        const { ok, output } = await bootProductionConfig({
            PROCESS_ROLE: 'migration', PGUSER: 'hq_app', PGPASSWORD: 'a-real-admin-password-8f2c41d7', APP_DB_USER: 'hq_app',
        });
        assert.equal(ok, false);
        assert.match(output, /Refusing to start/);
        assert.match(output, /APP_DB_USER/);
        assert.match(output, /row level\s+security|row level security/);
        assert.match(output, /db:grants/, 'the message should say how to fix it');
    });

    it('allows the notification worker to start with delivery disabled when SMTP is absent', async () => {
        const { ok, output } = await bootProductionConfig({
            PROCESS_ROLE: 'notification_worker',
            NOTIFICATION_WORKER_DB_USER: 'hq_notification_worker_login',
            NOTIFICATION_WORKER_DB_PASSWORD: 'worker-database-secret-830f7ca1',
            SMTP_HOST: undefined,
            SMTP_TLS_MODE: undefined,
            SMTP_USER: undefined,
            SMTP_PASSWORD: undefined,
        });
        assert.equal(ok, true, output);
    });

    it('rejects worker SMTP without an explicit TLS policy', async () => {
        const { ok, output } = await bootProductionConfig({
            PROCESS_ROLE: 'notification_worker',
            NOTIFICATION_WORKER_DB_USER: 'hq_notification_worker_login',
            NOTIFICATION_WORKER_DB_PASSWORD: 'worker-database-secret-830f7ca1',
            SMTP_HOST: 'smtp.example.test',
            SMTP_TLS_MODE: undefined,
            SMTP_USER: 'smtp-user', SMTP_PASSWORD: 'smtp-password',
        });
        assert.equal(ok, false);
        assert.match(output, /SMTP_TLS_MODE/);
        assert.ok(!output.includes('smtp-password'));
    });

    it('rejects STARTTLS transport configured as implicit TLS', async () => {
        const { ok, output } = await bootProductionConfig({
            PROCESS_ROLE: 'notification_worker',
            NOTIFICATION_WORKER_DB_USER: 'hq_notification_worker_login',
            NOTIFICATION_WORKER_DB_PASSWORD: 'worker-database-secret-830f7ca1',
            SMTP_HOST: 'smtp.example.test', SMTP_TLS_MODE: 'starttls', SMTP_SECURE: 'true',
            SMTP_USER: 'smtp-user', SMTP_PASSWORD: 'smtp-password',
        });
        assert.equal(ok, false);
        assert.match(output, /SMTP_SECURE must be true for implicit TLS and false for required STARTTLS/);
    });

    it('accepts a complete explicit implicit-TLS worker configuration', async () => {
        const { ok, output } = await bootProductionConfig({
            PROCESS_ROLE: 'notification_worker',
            NOTIFICATION_WORKER_DB_USER: 'hq_notification_worker_login',
            NOTIFICATION_WORKER_DB_PASSWORD: 'worker-database-secret-830f7ca1',
            SMTP_HOST: 'smtp.example.test', SMTP_TLS_MODE: 'implicit', SMTP_SECURE: 'true',
            SMTP_USER: 'smtp-user', SMTP_PASSWORD: 'smtp-password',
        });
        assert.equal(ok, true, output);
    });

    it('refuses a relative upload directory', async () => {
        // A relative path resolves against whatever the process's working
        // directory happens to be, so uploads land outside the mounted volume
        // and the images already stored are silently unreachable.
        const { ok, output } = await bootProductionConfig({ UPLOAD_DIR: 'uploads' });
        assert.equal(ok, false);
        assert.match(output, /Refusing to start/);
        assert.match(output, /UPLOAD_DIR/);
        assert.match(output, /absolute/i);
    });

    it('does not require a local upload directory when using S3 storage', async () => {
        const { ok, output } = await bootProductionConfig({
            STORAGE_DRIVER: 's3',
            S3_ENDPOINT: 'https://storage.example.com',
            S3_BUCKET: 'marketplace-images',
            S3_ACCESS_KEY_ID: 'test-access-key',
            S3_SECRET_ACCESS_KEY: 'test-secret-key',
            UPLOAD_DIR: undefined,
        });
        assert.equal(ok, true, output);
    });

    it('refuses an unset proxy hop count', async () => {
        // Both wrong values are silent: too low merges every visitor into one
        // rate-limit counter, too high lets a caller forge X-Forwarded-For.
        const { ok, output } = await bootProductionConfig({ TRUST_PROXY_HOPS: undefined });
        assert.equal(ok, false);
        assert.match(output, /Refusing to start/);
        assert.match(output, /TRUST_PROXY_HOPS/);
        assert.match(output, /X-Forwarded-For/, 'the message should explain what goes wrong');
    });

    it('accepts an explicit zero hop count for a directly exposed API', async () => {
        // The opposite error would be refusing a correct deployment, so the
        // guard has to accept `0` and not only `1`.
        const { ok, output } = await bootProductionConfig({ TRUST_PROXY_HOPS: '0' });
        assert.equal(ok, true, `zero hops is a legitimate deployment:\n${output}`);
    });

    it('accepts a multi-hop deployment', async () => {
        const { ok, output } = await bootProductionConfig({ TRUST_PROXY_HOPS: '2' });
        assert.equal(ok, true, `two hops is a legitimate deployment:\n${output}`);
    });

    it('reports the most consequential problem first when several are wrong', async () => {
        // The guards fail fast rather than aggregating, which is a deliberate
        // choice: each refusal carries its own tailored explanation, and five of
        // them stacked into one message is a wall nobody reads. It also means
        // the order of the checks decides what a misconfigured deploy is told
        // first, so that order is asserted here.
        //
        // JWT_SECRET leads because it is the one that decides whether a forged
        // token is possible at all. Someone fixing a deploy should not have to
        // read past a path warning to find it.
        const { ok, output } = await bootProductionConfig({
            JWT_SECRET: 'change-me',
            PGPASSWORD: 'change-me',
            APP_DB_USER: 'postgres',
            UPLOAD_DIR: 'uploads',
            TRUST_PROXY_HOPS: undefined,
        });
        assert.equal(ok, false);
        assert.match(output, /JWT_SECRET/, 'the first guard should be the one that fires');
        assert.ok(
            !output.includes('UPLOAD_DIR'),
            'the later guards should not run once one has refused, so their advice must not be mixed in',
        );
    });

    it('rejects a negative hop count before the guards run', async () => {
        // A negative value is nonsense rather than a dangerous-but-plausible
        // deployment, so it is caught by the schema, not by a prose guard.
        const { ok, output } = await bootProductionConfig({ TRUST_PROXY_HOPS: '-1' });
        assert.equal(ok, false);
        assert.match(output, /TRUST_PROXY_HOPS/);
    });

    it('does not apply production requirements in development', async () => {
        // All of these values are the ones a fresh clone should be able to run
        // with. If development refused them too, the guards would be pushing
        // everyone to configure a deployment in order to start a dev server.
        const { ok, output } = await bootProductionConfig({
            NODE_ENV: 'development',
            PGPASSWORD: 'postgres',
            APP_DB_PASSWORD: 'hq_app',
            JWT_SECRET: 'dev-only-not-a-secret',
            APP_DB_USER: 'postgres',
            UPLOAD_DIR: 'uploads',
            TRUST_PROXY_HOPS: undefined,
        });
        assert.equal(ok, true, `development must stay runnable on a fresh clone:\n${output}`);
    });
});
