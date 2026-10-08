/**
 * `npm run preflight`.
 *
 * The preflight command is the deploy-time answer to the production guards: the
 * same questions, asked before a release is on the box rather than after it
 * has refused to boot. Its contract is therefore narrow and worth pinning down
 * precisely:
 *
 *   * it reports every check, so a fix does not need one deploy per problem;
 *   * it changes nothing, so running it on a live deployment is safe;
 *   * it exits non-zero when any check fails, so it works as a CI gate without
 *     anybody having to parse its output.
 *
 * It is exercised as a real subprocess rather than by importing its functions.
 * That is the whole point of a command-line tool: whether the exit code and the
 * printed report are right is the only thing that matters to whoever wires it
 * into a pipeline, and neither is observable from inside the process.
 */
process.env['NODE_ENV'] = 'test';
import assertModule from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { parse as parseDotenv } from 'dotenv';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const assert = assertModule;
const run = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = resolve(projectRoot, 'scripts/preflight.ts');
const tsxCli = resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs');
/**
 * Runs the preflight with `overrides` applied on top of a working environment,
 * so each case can describe one specific deployment.
 *
 * The base environment comes from the project's own `.env`, read here rather
 * than inherited. That matters more than it looks: the real credentials reach a
 * child process through `dotenv/config` inside the tool, not through the parent
 * `process.env`, so inheriting would hand the tool an unset password and every
 * database check would fail for the wrong reason. Nothing in this file prints
 * these values — they are read to be passed on, never to be asserted on.
 *
 * The database is then pointed at the test one, which is migrated and has the
 * safe application role, so the tool's queries are answered by a known fixture
 * rather than by whatever the developer has configured locally. The tool only
 * ever reads it.
 *
 * `undefined` deletes a variable, which is how "absent entirely" is expressed —
 * `PORT` unset and `PORT=0` are different things, and only one of them is a
 * case worth testing.
 */
async function preflight(overrides = {}) {
    const env = {
        PATH: process.env['PATH'] ?? '',
        ...readProjectEnv(),
        PGDATABASE: process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test',
        // Overridable per case; the busy-port case needs to name its own.
        PORT: String(freePort),
    };
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined)
            delete env[key];
        else
            env[key] = value;
    }
    try {
        const { stdout, stderr } = await run(process.execPath, [tsxCli, script], {
            cwd: projectRoot,
            env,
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
        });
        return { code: 0, output: stdout + stderr };
    }
    catch (error) {
        const failure = error;
        return { code: failure.code ?? 1, output: (failure.stdout ?? '') + (failure.stderr ?? '') };
    }
}
/** The project's `.env` as key/value pairs, or nothing if it is absent. */
let projectEnvCache;
function readProjectEnv() {
    if (projectEnvCache)
        return projectEnvCache;
    const envPath = resolve(projectRoot, '.env');
    projectEnvCache = existsSync(envPath)
        ? parseDotenv(readFileSync(envPath, 'utf8'))
        : {};
    return projectEnvCache;
}
/** An ephemeral upload folder, so the tool's directory checks are exercised for real. */
let scratchDir;
/**
 * A port nothing is listening on, obtained by binding port 0 and reading back
 * what the OS chose.
 *
 * The obvious shortcut — telling the tool to use port `0` — is not available:
 * `PORT` is validated as positive, and rightly so, because port 0 is never a
 * port an operator would configure. So a real free port is reserved, and there
 * is a narrow race between releasing it and the tool binding it. Nothing else
 * on a test machine is going to claim a port in that window.
 */
let freePort;
before(async () => {
    scratchDir = mkdtempSync(join(tmpdir(), 'hq-preflight-'));
    const { createServer } = await import('node:net');
    const probe = createServer();
    await new Promise((resolveListen) => probe.listen(0, '127.0.0.1', resolveListen));
    freePort = probe.address().port;
    await new Promise((resolveClose) => probe.close(() => resolveClose()));
});
after(() => {
    rmSync(scratchDir, { recursive: true, force: true });
});
describe('preflight, on a working environment', () => {
    it('passes and exits zero', async () => {
        // The guard on every other assertion below: a command that fails for an
        // unrelated reason makes all its reported failures look meaningful.
        const { code, output } = await preflight({
            UPLOAD_DIR: scratchDir
        });
        assert.equal(code, 0, `expected a clean run, got exit ${code}:\n${output}`);
        assert.match(output, /all \d+ checks passed/);
        assert.ok(!output.includes('[FAIL]'), `no check should have failed:\n${output}`);
    });
    it('reports every check it ran, in a fixed order', async () => {
        // A deploy operator reads this top to bottom, so the order is part of the
        // interface rather than an implementation detail.
        const { output } = await preflight({
            UPLOAD_DIR: scratchDir
        });
        const reported = [...output.matchAll(/\[(?: ok |warn|FAIL)\] (\S[^\r\n]*?)\s*$/gm)]
            .map((match) => match[1].trim());
        assert.deepEqual(reported, [
            'environment',
            'admin database is reachable',
            'application database is reachable',
            'application role is subject to row level security',
            'all migrations are applied',
            'upload directory is writable',
            'the API port is free',
        ]);
    });
    it('confirms the application role against the database, not against .env', async () => {
        // The point of asking the database rather than reading a variable: a role
        // can be unsafe for a reason no environment file records.
        const { output } = await preflight({
            UPLOAD_DIR: scratchDir
        });
        assert.match(output, /application role is subject to row level security/);
        assert.match(output, /row level security\s*\r?\n\[preflight\]\s+as hq_app/);
    });
    it('never prints a password, in any case', async () => {
        // The report is meant to be pasted into an issue tracker, so it has to be
        // safe to paste. Asserted against a password that is deliberately
        // recognisable, so a leak would be unmissable.
        const secret = 'preflight-canary-9d41ba07';
        const { output } = await preflight({
            UPLOAD_DIR: scratchDir,
            PGPASSWORD: secret,
            APP_DB_PASSWORD: secret,
        });
        assert.ok(!output.includes(secret), `the report leaked a password:\n${output}`);
    });
    it('changes nothing in the database', async () => {
        // It runs against a live database, so "read-only" is the property that
        // makes it safe to run against production at all. `migrationStatus()` is
        // the only query that reads the ledger, and the connection is closed
        // rather than left open.
        const first = await preflight({
            UPLOAD_DIR: scratchDir
        });
        const second = await preflight({
            UPLOAD_DIR: scratchDir
        });
        assert.equal(first.code, second.code);
        assert.equal(first.output.replace(/\s+/g, ' '), second.output.replace(/\s+/g, ' '), 'two runs against an unchanged database should report identically');
    });
});
describe('preflight, when something is wrong', () => {
    it('exits non-zero when the API cannot reach its database', async () => {
        // The case the tool exists for: the API would fail every request, and
        // the operator finds out here instead of in production.
        const { code, output } = await preflight({
            UPLOAD_DIR: scratchDir,
            PGPORT: '1',
            PGHOST: '127.0.0.1',
        });
        assert.equal(code, 1, `an unreachable database must fail the gate:\n${output}`);
        assert.match(output, /\[FAIL\] admin database is reachable/);
        assert.match(output, /\[FAIL\] application database is reachable/);
        assert.match(output, /check\(s\) failed/);
    });
    it('explains how to fix an unreachable database', async () => {
        const { output } = await preflight({
            UPLOAD_DIR: scratchDir,
            PGPORT: '1',
            PGHOST: '127.0.0.1',
        });
        assert.match(output, /db:grants/, 'the message should name the command that fixes it');
    });
    it('still reports the checks that passed when one fails', async () => {
        // Listing everything at once is the difference between one deploy to fix
        // a problem and one deploy per problem. Note which checks are asserted
        // here: the ones that do not need the database, since the database being
        // unreachable is what was arranged. Asserting the migration check would
        // be asserting the opposite of what is meant.
        const { output } = await preflight({
            UPLOAD_DIR: scratchDir,
            PGPORT: '1',
            PGHOST: '127.0.0.1',
        });
        assert.match(output, /\[ ok \] environment/);
        assert.match(output, /\[ ok \] upload directory is writable/);
        assert.match(output, /\[ ok \] the API port is free/);
        assert.match(output, /\[FAIL\] admin database is reachable/);
        assert.match(output, /check\(s\) failed/);
    });
    it('flags a port that is already taken', async () => {
        // Held by this test process itself, so the check has something real to
        // collide with rather than a simulated error.
        //
        // Bound on the wildcard address, and that detail is load-bearing: the
        // tool also binds the wildcard, but on Windows a socket held on
        // `127.0.0.1` does not stop another process binding `0.0.0.0` on the
        // same port. Binding the same interface the tool uses is what makes the
        // collision real rather than platform-dependent.
        const holder = (await import('node:net')).createServer();
        await new Promise((resolveListen) => holder.listen(0, resolveListen));
        const takenPort = holder.address().port;
        try {
            const { code, output } = await preflight({ PORT: String(takenPort), UPLOAD_DIR: scratchDir });
            assert.equal(code, 1, `a busy port must fail the gate:\n${output}`);
            assert.match(output, /\[FAIL\] the API port is free/);
            assert.match(output, /EADDRINUSE/);
        }
        finally {
            await new Promise((resolveClose) => holder.close(() => resolveClose()));
        }
    });
    it('fails when the upload folder cannot be created', async () => {
        // A path under a file, not a directory: mkdir cannot create it, which is
        // the portable version of a read-only volume.
        const blocker = join(scratchDir, 'a-file');
        const { writeFileSync } = await import('node:fs');
        writeFileSync(blocker, 'not a directory');
        assert.ok(existsSync(blocker));
        const { code, output } = await preflight({
            UPLOAD_DIR: join(blocker, 'uploads')
        });
        assert.equal(code, 1, `an unusable upload folder must fail the gate:\n${output}`);
        assert.match(output, /\[FAIL\] upload directory is writable/);
    });
    it('warns rather than fails when it creates the upload folder', async () => {
        // Creating the folder is what the storage driver would do anyway, so
        // this is not a failure — but the operator should know it happened,
        // because an `UPLOAD_DIR` that does not exist yet is how images end up
        // somewhere that is not the mounted volume.
        const fresh = join(scratchDir, 'created-by-preflight');
        assert.ok(!existsSync(fresh));
        const { code, output } = await preflight({
            UPLOAD_DIR: fresh
        });
        assert.equal(code, 0, `creating the folder is not a failure:\n${output}`);
        assert.match(output, /\[warn\] upload directory is writable/);
        assert.match(output, /created just now/);
        assert.ok(existsSync(fresh), 'the folder should have been created');
    });
});
describe('preflight, when the environment itself is refused', () => {
    it('reports the production guards rather than a stack trace', async () => {
        // `src/config.ts` throws at import, so the tool never reaches its own
        // checks. What matters is that the operator sees the refusal and its
        // remedy, and not a module-resolution stack trace.
        //
        // The secret is 24 characters on purpose: long enough to clear the
        // schema's 16-character floor, short enough to be refused by the
        // production-only 32-character rule. Anything shorter would be rejected
        // by the schema and this would be testing the wrong refusal.
        const { code, output } = await preflight({
            NODE_ENV: 'production',
            UPLOAD_DIR: scratchDir,
            JWT_SECRET: 'change-me-not-really-24ch',
        });
        assert.equal(code, 1);
        assert.match(output, /Refusing to start/);
        assert.match(output, /JWT_SECRET/);
        assert.ok(!output.includes('at Object.'), `a stack trace is not a report:\n${output}`);
    });
});
//# sourceMappingURL=preflight.test.js.map