/**
 * `db:promote-admin` and `db:revoke-admin`.
 *
 * This script grants the single most powerful role in the system, so what is
 * under test is not the SQL — it is everything that stops the wrong person
 * running it on the wrong account by accident:
 *
 *   * an unknown email is refused, never created;
 *   * without `--yes` nothing is written, and the dry run says what it *would*
 *     do, so "run it to see the help" cannot promote anyone;
 *   * there is no way to supply a password, because the account must come from a
 *     real registration;
 *   * both directions are idempotent, because the scenario where someone runs it
 *     twice is the scenario where they are unsure whether the first run worked;
 *   * revoking removes the admin role and nothing else, so a user keeps their
 *     `customer` role and their business memberships.
 *
 * `run()` returns an exit code rather than calling `process.exit`, so every path
 * — including the refusals — is exercised in-process against the real database,
 * with no subprocess and no way for a test to end the test runner.
 */

process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

const assert: typeof assertModule = assertModule;

type Run = typeof import('../scripts/admin-role.js').run;
type ParseArgs = typeof import('../scripts/admin-role.js').parseArgs;

let run: Run;
let parseArgs: ParseArgs;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;

/** A test user. Created directly, so the script's "must already exist" holds. */
interface Fixture {
    email: string;
    userId: number;
}

let fixtures: Fixture[] = [];

/**
 * Creates a user the way registration would: a real password hash and an active
 * status, so nothing about the fixture is a shortcut the script depends on.
 */
async function createUser(email: string, fullName = 'Test Person'): Promise<Fixture> {
    const passwordHash = await bcrypt.hash('a-real-password-for-this-fixture', 4);
    const { rows } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING user_id`,
        [email, passwordHash, fullName],
    );
    const fixture = { email, userId: Number(rows[0]!.user_id) };
    fixtures.push(fixture);
    return fixture;
}

/** Every platform role this user currently holds. */
async function platformRoles(userId: number): Promise<string[]> {
    const { rows } = await adminPool.query<{ role_key: string }>(
        `SELECT r.role_key
           FROM user_platform_roles upr
           JOIN roles r ON r.role_id = upr.role_id
          WHERE upr.user_id = $1
          ORDER BY r.role_key`,
        [userId],
    );
    return rows.map((row) => row.role_key);
}

/** Runs the script and collects what it printed. */
async function invoke(argv: string[]): Promise<{ code: number; output: string }> {
    const lines: string[] = [];
    const code = await run(argv, (line) => lines.push(line));
    return { code, output: lines.join('\n') };
}

before(async () => {
    const module = await import('../scripts/admin-role.js');
    run = module.run;
    parseArgs = module.parseArgs;

    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;

    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});

beforeEach(async () => {
    await adminPool.query('TRUNCATE users RESTART IDENTITY CASCADE');
    fixtures = [];
});

after(async () => {
    await closePools();
});

describe('argument parsing', () => {
    it('accepts a direction, an email and --yes', () => {
        const parsed = parseArgs(['promote', 'someone@example.test', '--yes']);
        assert.ok(!('error' in parsed), `unexpected error: ${JSON.stringify(parsed)}`);
        assert.equal(parsed.direction, 'promote');
        assert.equal(parsed.email, 'someone@example.test');
        assert.equal(parsed.confirmed, true);
    });

    it('accepts -y as well as --yes', () => {
        const parsed = parseArgs(['revoke', 'someone@example.test', '-y']);
        assert.ok(!('error' in parsed));
        assert.equal(parsed.confirmed, true);
    });

    it('rejects a missing direction', () => {
        const parsed = parseArgs(['someone@example.test', '--yes']);
        assert.ok('error' in parsed, 'an argument with no direction must not be accepted');
    });

    it('rejects a direction it does not know', () => {
        // Not quietly treated as promote: the word an operator reaches for when
        // they mean the opposite is the one that must not be inferred.
        const parsed = parseArgs(['delete', 'someone@example.test', '--yes']);
        assert.ok('error' in parsed);
    });

    it('rejects a missing email', () => {
        const parsed = parseArgs(['promote', '--yes']);
        assert.ok('error' in parsed);
    });

    it('rejects an unknown option rather than ignoring it', () => {
        // If a typo were ignored, `--yesy` would read as "no confirmation" and
        // the script would dry-run instead of promoting — a silent difference
        // between an error and a refusal.
        const parsed = parseArgs(['promote', 'someone@example.test', '--yesy']);
        assert.ok('error' in parsed, 'an unknown option must not be ignored');
    });

    it('rejects an email that cannot be an email', () => {
        const parsed = parseArgs(['promote', 'not-an-email', '--yes']);
        assert.ok('error' in parsed);
    });

    it('rejects more than one email', () => {
        // Two addresses is far more likely to be a mistake than an intention,
        // and promoting the first of them is not a safe guess.
        const parsed = parseArgs(['promote', 'a@example.test', 'b@example.test', '--yes']);
        assert.ok('error' in parsed);
    });

    it('accepts the flag before the email', () => {
        const parsed = parseArgs(['promote', '--yes', 'someone@example.test']);
        assert.ok(!('error' in parsed), `unexpected error: ${JSON.stringify(parsed)}`);
        assert.equal(parsed.email, 'someone@example.test');
        assert.equal(parsed.confirmed, true);
    });
});

describe('promote, on a real account', () => {
    it('grants the role with --yes', async () => {
        const user = await createUser('new-admin@example.test');

        const { code, output } = await invoke(['promote', user.email, '--yes']);

        assert.equal(code, 0, `expected success:\n${output}`);
        assert.deepEqual(await platformRoles(user.userId), ['platform_admin']);
        assert.match(output, /granted platform_admin/i);
    });

    it('writes the role once, however many times it is run', async () => {
        // The case the idempotence exists for: an operator who ran it and did not
        // see the output, running it again to find out.
        const user = await createUser('repeat@example.test');

        const first = await invoke(['promote', user.email, '--yes']);
        const second = await invoke(['promote', user.email, '--yes']);

        assert.equal(first.code, 0, first.output);
        assert.equal(second.code, 0, 'a repeat run must be a success, not an error');

        const roles = await platformRoles(user.userId);
        assert.deepEqual(roles, ['platform_admin']);
        assert.match(second.output, /nothing to change/i);
    });

    it('finds the account whatever the capitalisation', async () => {
        // `email` is CITEXT, so the database would match anyway; matching in the
        // query is what keeps the dry run from reporting "unknown email" for an
        // account that exists.
        const user = await createUser('Mixed.Case@Example.test');

        const { code } = await invoke(['promote', 'mixed.case@example.test', '--yes']);

        assert.equal(code, 0);
        assert.deepEqual(await platformRoles(user.userId), ['platform_admin']);
    });

    it('keeps the roles the user already had', async () => {
        const user = await createUser('both-roles@example.test');
        const { rows } = await adminPool.query<{ role_id: string }>(
            "SELECT role_id FROM roles WHERE role_key = 'customer' AND scope = 'platform'",
        );
        await adminPool.query(
            'INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2)',
            [user.userId, rows[0]!.role_id],
        );

        await invoke(['promote', user.email, '--yes']);

        assert.deepEqual(
            await platformRoles(user.userId),
            ['customer', 'platform_admin'],
            'promotion must add the admin role without disturbing the others',
        );
    });

    it('leaves the account itself untouched', async () => {
        // The script grants a role, nothing more. If it also reset the password
        // or the status, an admin promotion would be a way to lock a user out.
        const user = await createUser('untouched@example.test');
        const before = await adminPool.query('SELECT password_hash, status, full_name FROM users WHERE user_id = $1', [user.userId]);

        await invoke(['promote', user.email, '--yes']);

        const after = await adminPool.query('SELECT password_hash, status, full_name FROM users WHERE user_id = $1', [user.userId]);
        assert.deepEqual(after.rows[0], before.rows[0], 'the user row was modified');
    });
});

describe('promote, without --yes', () => {
    it('changes nothing', async () => {
        const user = await createUser('dry-run@example.test');

        const { code, output } = await invoke(['promote', user.email]);

        assert.equal(code, 1, 'a dry run must not report success');
        assert.deepEqual(await platformRoles(user.userId), [], 'the role was granted without --yes');
        assert.match(output, /nothing was changed/i);
    });

    it('says what it would do, by name', async () => {
        const user = await createUser('dry-run-named@example.test', 'A Person');

        const { output } = await invoke(['promote', user.email]);

        assert.match(output, /would grant platform_admin/i);
        assert.match(output, new RegExp(user.email.replace(/[.]/g, '\\.')));
        assert.match(output, /A Person/);
    });

    it('tells the operator how to proceed', async () => {
        const user = await createUser('dry-run-hint@example.test');

        const { output } = await invoke(['promote', user.email]);

        assert.match(output, /--yes/, 'the dry run should say what flag would apply it');
    });

    it('is still refused for a user who is already an admin', async () => {
        // A dry run of a no-op is still a dry run; reporting success here would
        // make "already an admin" indistinguishable from "promoted".
        const user = await createUser('already@example.test');
        await invoke(['promote', user.email, '--yes']);

        const { code, output } = await invoke(['promote', user.email]);

        assert.equal(code, 1);
        assert.match(output, /nothing was changed/i);
    });
});

describe('an address with no account', () => {
    it('is refused, and creates nothing', async () => {
        const { code, output } = await invoke(['promote', 'nobody@example.test', '--yes']);

        assert.equal(code, 1, 'an unknown email must be an error');
        assert.match(output, /no account/i);
        assert.match(output, /does not create accounts/i);

        const { rows } = await adminPool.query('SELECT count(*)::int AS n FROM users WHERE email = $1', ['nobody@example.test']);
        assert.equal(rows[0]!.n, 0, 'the script created an account');
    });

    it('says to register first', async () => {
        // The refusal has to include the next step, or it is just a refusal.
        const { output } = await invoke(['promote', 'nobody@example.test', '--yes']);
        assert.match(output, /register/i);
    });

    it('never mentions a password', async () => {
        const { output } = await invoke(['promote', 'nobody@example.test', '--yes']);
        assert.ok(!/password/i.test(output), `the refusal mentioned a password: ${output}`);
    });
});

describe('revoke', () => {
    it('removes the role', async () => {
        const user = await createUser('ex-admin@example.test');
        await invoke(['promote', user.email, '--yes']);

        const { code, output } = await invoke(['revoke', user.email, '--yes']);

        assert.equal(code, 0, `expected success:\n${output}`);
        assert.deepEqual(await platformRoles(user.userId), []);
        assert.match(output, /revoked platform_admin/i);
    });

    it('is a no-op, and a success, when the user is not an admin', async () => {
        // Exiting non-zero here would make a "make sure nobody is an admin" sweep
        // look like it had failed.
        const user = await createUser('never-admin@example.test');

        const { code, output } = await invoke(['revoke', user.email, '--yes']);

        assert.equal(code, 0, output);
        assert.match(output, /nothing to change/i);
    });

    it('leaves the other roles alone', async () => {
        // The point of a separate table: revoking the platform role must not
        // reinterpret the user as losing their customer role or memberships.
        const user = await createUser('admin-and-customer@example.test');
        const { rows } = await adminPool.query<{ role_id: string }>(
            "SELECT role_id FROM roles WHERE role_key = 'customer' AND scope = 'platform'",
        );
        await adminPool.query(
            'INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2)',
            [user.userId, rows[0]!.role_id],
        );
        await invoke(['promote', user.email, '--yes']);

        await invoke(['revoke', user.email, '--yes']);

        assert.deepEqual(
            await platformRoles(user.userId),
            ['customer'],
            'the customer role should have survived the revocation',
        );
    });

    it('is idempotent', async () => {
        const user = await createUser('double-revoke@example.test');
        await invoke(['promote', user.email, '--yes']);

        const first = await invoke(['revoke', user.email, '--yes']);
        const second = await invoke(['revoke', user.email, '--yes']);

        assert.equal(first.code, 0, first.output);
        assert.equal(second.code, 0, second.output);
        assert.deepEqual(await platformRoles(user.userId), []);
    });

    it('changes nothing without --yes', async () => {
        const user = await createUser('revoke-dry@example.test');
        await invoke(['promote', user.email, '--yes']);

        const { code, output } = await invoke(['revoke', user.email]);

        assert.equal(code, 1);
        assert.match(output, /would revoke/i);
        assert.match(output, /nothing was changed/i);
        assert.deepEqual(
            await platformRoles(user.userId),
            ['platform_admin'],
            'the role was revoked without --yes',
        );
    });

    it('is refused for an unknown address', async () => {
        const { code, output } = await invoke(['revoke', 'nobody@example.test', '--yes']);
        assert.equal(code, 1);
        assert.match(output, /no account/i);
    });

    it('can be followed by a promotion again', async () => {
        // The round trip an operator actually performs: hand the role to
        // somebody else and take it back.
        const user = await createUser('round-trip@example.test');

        await invoke(['promote', user.email, '--yes']);
        await invoke(['revoke', user.email, '--yes']);
        const { code } = await invoke(['promote', user.email, '--yes']);

        assert.equal(code, 0);
        assert.deepEqual(await platformRoles(user.userId), ['platform_admin']);
    });
});

describe('what the script will not do', () => {
    it('has no option that takes a password', async () => {
        // Stated as a test because the guarantee is structural, not a promise in
        // a comment: any argument that looks like a flag is either `--yes` or an
        // error, so there is no accepted spelling for a credential.
        for (const flag of ['--password', '--password=x', '--pass', '-p', '--secret']) {
            const parsed = parseArgs(['promote', 'someone@example.test', flag]);
            assert.ok('error' in parsed, `${flag} was accepted`);
        }
    });

    it('treats a second email as an error rather than choosing one', async () => {
        const parsed = parseArgs(['promote', 'a@example.test', 'b@example.test', '--yes']);
        assert.ok('error' in parsed);
        assert.match(parsed.error, /one email/i);
    });
});
