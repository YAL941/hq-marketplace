/**
 * `npm run preflight` — everything that can be checked before the API is asked
 * to start, reported in one pass.
 *
 * The production guards in `src/config.ts` stop the process at startup, which is
 * the right place for them: a misconfigured deployment must never serve traffic.
 * But it is a bad place to *discover* a misconfiguration, because the feedback
 * arrives as a refused boot — on the machine being deployed to, after the
 * release is already on it, one variable at a time.
 *
 * This command exists so the same questions get asked before a deploy, from a
 * laptop or a CI job, with everything wrong listed at once:
 *
 *   * is the environment itself valid (the guards from `src/config.ts`);
 *   * can the API's database be reached at all;
 *   * are all migrations applied, and is `schema_migrations` in a state the
 *     next release can build on;
 *   * does the application role actually get its rows filtered by the policies,
 *     as asked of the database rather than read out of the environment;
 *   * can the process write uploads where it will look for them.
 *
 * It is a *preflight*, not a health check: it runs migrations status against the
 * configured database and touches nothing. The health endpoint (`GET /healthz`)
 * is the liveness answer for a process that is already running; this is the
 * go/no-go answer for one that is not.
 *
 * Exit code is 0 when every check passes and 1 when any fails, so it can be used
 * as a deploy gate without parsing the output.
 */
import { accessSync, constants as fsConstants, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { config } from '../src/config.js';
import { inspectAppRole } from '../src/db/pool.js';
import { adminPool, appPool, closePools } from '../src/db/pool.js';
import { migrationStatus } from '../src/db/migrator.js';
const checks = [];
function pass(name, detail) {
    checks.push({ name, ok: true, detail });
}
function fail(name, detail) {
    checks.push({ name, ok: false, detail });
}
function warn(name, detail) {
    checks.push({ name, ok: true, warning: true, detail });
}
/**
 * Renders the host portion of the database target.
 *
 * A hostname on its own is a deployment detail someone needs to see, but a DSN
 * is a password, so nothing here assembles one: the user is shown only where it
 * is the thing being checked.
 */
function describeTarget() {
    return `${config.PGHOST}:${config.PGPORT}/${config.PGDATABASE}`;
}
/**
 * The environment, as `src/config.ts` resolved it.
 *
 * Reaching this line means the module imported cleanly, so every production
 * guard already passed. Reporting the resolved values is what makes the rest of
 * the output actionable: when something below fails, these are the values it
 * was judged against.
 */
function checkEnvironment() {
    pass('environment', [
        `NODE_ENV=${config.NODE_ENV}`,
        `PORT=${config.PORT}`,
        `trustProxyHops=${config.trustProxyHops}`,
        `cors=${config.corsOrigins.join(',') || 'none'}`,
        `uploads=${config.UPLOAD_DIR}`,
        `appUser=${config.APP_DB_USER}`,
    ].join(' '));
}
/**
 * The API's own database connection, i.e. the one that matters for isolation.
 *
 * This is checked separately from the admin connection on purpose. They are
 * deliberately different roles, and the preflight would not be worth running if
 * the two turned out to be the same identity — which is checked next.
 */
async function checkAppDatabaseReachable() {
    try {
        await appPool.query('SELECT 1');
        pass('application database is reachable', `as ${config.APP_DB_USER} on ${describeTarget()}`);
    }
    catch (error) {
        fail('application database is reachable', `as ${config.APP_DB_USER} on ${describeTarget()}: ${describeError(error)}\n`
            + '  The API would fail every request. Check APP_DB_USER, APP_DB_PASSWORD and that\n'
            + '  `npm run db:grants` has been run against this database.');
    }
}
/**
 * The admin connection, needed for migrations but never for serving requests.
 */
async function checkAdminDatabaseReachable() {
    try {
        await adminPool.query('SELECT 1');
        pass('admin database is reachable', `as ${config.PGUSER} on ${describeTarget()}`);
    }
    catch (error) {
        fail('admin database is reachable', `as ${config.PGUSER} on ${describeTarget()}: ${describeError(error)}\n`
            + '  `npm run db:migrate` and `npm run db:grants` cannot run against this database.');
    }
}
/**
 * Whether the role the API uses is one the policies actually apply to.
 *
 * This is the check that catches what no environment variable can: a role that
 * owns the tables, holds BYPASSRLS, or is a superuser, for whatever reason.
 * Those all produce a perfectly healthy-looking API that returns other tenants'
 * rows, so the answer is asked of the database rather than inferred from `.env`.
 */
async function checkAppRoleIsSafe() {
    try {
        const finding = await inspectAppRole(appPool);
        if (finding.unsafe) {
            fail('application role is subject to row level security', `${finding.problems.map((problem) => `  - ${problem}`).join('\n')}\n`
                + '  The API would start, serve every request successfully, and return rows it is\n'
                + '  not supposed to see. Run `npm run db:grants` and point APP_DB_USER at the\n'
                + '  role it creates.');
            return;
        }
        pass('application role is subject to row level security', `as ${config.APP_DB_USER}`);
    }
    catch (error) {
        fail('application role is subject to row level security', describeError(error));
    }
}
/**
 * Migrations, because a release that is behind the schema fails in the least
 * obvious way possible: not at boot, but on whichever request first touches a
 * column that does not exist yet.
 */
async function checkMigrations() {
    try {
        const status = await migrationStatus();
        const pending = status.filter((migration) => !migration.applied);
        const appliedCount = status.length - pending.length;
        if (pending.length > 0) {
            fail('all migrations are applied', `${appliedCount}/${status.length} applied; pending:\n`
                + pending.map((migration) => `  - ${migration.version} ${migration.name}`).join('\n')
                + '\n  Run `npm run db:migrate` before starting this version.');
            return;
        }
        pass('all migrations are applied', `${appliedCount}/${status.length}`);
    }
    catch (error) {
        fail('all migrations are applied', `${describeError(error)}\n  The database may not be migrated at all; try \`npm run db:migrate\`.`);
    }
}
/**
 * Uploads, because a read-only or missing folder is reported by the first person
 * who tries to add a logo, not by the deploy.
 *
 * The folder is created when it does not exist, since that is what the storage
 * driver would do anyway; doing it here means the problem surfaces during the
 * deploy rather than during a user's upload.
 */
function checkUploadDir() {
    const dir = resolve(config.UPLOAD_DIR);
    let stats;
    try {
        stats = statSync(dir);
    }
    catch {
        try {
            mkdirSync(dir, { recursive: true });
            warn('upload directory is writable', `${dir} (created just now)`);
        }
        catch (error) {
            fail('upload directory is writable', `${dir} does not exist and could not be created: ${describeError(error)}`);
            return;
        }
        return;
    }
    if (!stats.isDirectory()) {
        fail('upload directory is writable', `${dir} exists but is not a directory`);
        return;
    }
    try {
        accessSync(dir, fsConstants.W_OK);
        pass('upload directory is writable', dir);
    }
    catch {
        fail('upload directory is writable', `${dir} is not writable by this process\n`
            + '  Every upload would fail. In production this folder should be its own volume,\n'
            + '  owned by the user the service runs as.');
    }
}
/**
 * Whether the port is already taken.
 *
 * Worth checking because the resulting failure — `EADDRINUSE` — is the least
 * informative one the API can produce, and it is also the one case where a
 * second copy of the process is the likely cause: a previous instance that did
 * not shut down, or a health check that restarted something.
 */
function checkPortFree() {
    return new Promise((resolveCheck) => {
        const probe = createServer();
        probe.once('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                fail('the API port is free', `${config.PORT} is already in use.\n`
                    + '  Either another instance is still running, or something else on this host owns\n'
                    + '  the port. Starting now would end in EADDRINUSE.');
            }
            else {
                fail('the API port is free', `${config.PORT}: ${describeError(error)}`);
            }
            resolveCheck();
        });
        probe.once('listening', () => {
            probe.close(() => {
                pass('the API port is free', `${config.PORT}`);
                resolveCheck();
            });
        });
        probe.listen(config.PORT);
    });
}
/** Turns a thrown value into one line, without dumping a stack trace. */
function describeError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
async function main() {
    console.log(`[preflight] ${describeTarget()} as ${config.APP_DB_USER}\n`);
    checkEnvironment();
    await checkAdminDatabaseReachable();
    await checkAppDatabaseReachable();
    await checkAppRoleIsSafe();
    await checkMigrations();
    checkUploadDir();
    await checkPortFree();
    const width = Math.max(...checks.map((check) => check.name.length));
    for (const check of checks) {
        const mark = check.warning ? 'warn' : check.ok ? ' ok ' : 'FAIL';
        console.log(`[preflight] [${mark}] ${check.name.padEnd(width)}`);
        if (check.detail) {
            for (const line of check.detail.split('\n')) {
                console.log(`[preflight]       ${line}`);
            }
        }
    }
    const failures = checks.filter((check) => !check.ok);
    const warnings = checks.filter((check) => check.warning);
    console.log('');
    if (failures.length > 0) {
        console.error(`[preflight] ${failures.length} check(s) failed. This version should not be started here.`);
        process.exitCode = 1;
        return;
    }
    const summary = `[preflight] all ${checks.length - warnings.length} checks passed`;
    if (warnings.length > 0) {
        console.warn(`${summary} (${warnings.length} warning(s))`);
    }
    else {
        console.log(summary);
    }
}
main()
    .catch((error) => {
    console.error('[preflight] failed:', describeError(error));
    process.exitCode = 1;
})
    // `closePools` last, and never allowed to mask a failure above it.
    .finally(() => closePools().catch(() => undefined));
//# sourceMappingURL=preflight.js.map