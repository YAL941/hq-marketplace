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
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const assert: typeof assertModule = assertModule;
const run = promisify(execFile);

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configEntry = resolve(projectRoot, 'src/config.ts');

/** Everything a production boot needs to be allowed through the existing guards. */
const VALID_PRODUCTION_ENV: Record<string, string> = {
    NODE_ENV: 'production',
    PGHOST: 'db.internal',
    PGDATABASE: 'hq_marketplace',
    PGUSER: 'postgres',
    PGPASSWORD: 'a-real-admin-password-8f2c41d7',
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
        // `tsx` is what `npm run dev` uses, so this is the same loader the
        // operator's boot would go through.
        const { stdout, stderr } = await run(
            process.execPath,
            [
                resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs'),
                '--eval',
                "import('./src/config.ts').then(() => console.log('BOOTED'))",
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
    });

    it('refuses a placeholder admin password', async () => {
        // PGPASSWORD is the schema owner's password — the one role that
        // bypasses row level security. `change-me` is what .env.example ships.
        const { ok, output } = await bootProductionConfig({ PGPASSWORD: 'change-me' });
        assert.equal(ok, false);
        assert.match(output, /Refusing to start/);
        assert.match(output, /PGPASSWORD/);
        assert.match(output, /placeholder/i);
    });

    it('refuses a short admin password', async () => {
        const { ok, output } = await bootProductionConfig({ PGPASSWORD: 'short' });
        assert.equal(ok, false);
        assert.match(output, /PGPASSWORD/);
        assert.match(output, /16/);
    });

    it('refuses the API and the migrations sharing one database role', async () => {
        // The failure this prevents has no symptom: the API becomes the table
        // owner, policies are bypassed, and every request still returns 200.
        const { ok, output } = await bootProductionConfig({ APP_DB_USER: 'postgres' });
        assert.equal(ok, false);
        assert.match(output, /Refusing to start/);
        assert.match(output, /APP_DB_USER/);
        assert.match(output, /row level\s+security|row level security/);
        assert.match(output, /db:grants/, 'the message should say how to fix it');
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