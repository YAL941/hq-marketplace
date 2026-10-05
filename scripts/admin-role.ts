/**
 * Grant or revoke the platform-admin role for one user.
 *
 * One script for both directions, because they are the same operation read in
 * two directions, and two scripts would be two places for the safety rules below
 * to drift apart.
 *
 * WHY THIS IS A SCRIPT AND NOT A SEED
 * ----------------------------------
 * `npm run db:seed` creates its own admin with a password everyone knows, and
 * it refuses to run against production. That is correct for a fixture and useless
 * for a real deployment: there is exactly one first administrator, and their
 * account has to come from a real registration so that the password is one the
 * user chose. So this script takes an existing user by email and changes nothing
 * about them. It never creates an account, and it never sets a password.
 *
 * There is deliberately no `--password`, no `--email-from-stdin`, and no way to
 * supply credentials of any kind. A tool that can set a password is a tool that
 * will eventually set one in a shell history, and this project already has a
 * registration endpoint for the legitimate case.
 *
 * THE RULES
 * ---------
 *   * the user must already exist. An unknown email is an error, not a creation;
 *   * `--yes` is required. Without it the script prints what it would do and
 *     changes nothing, so running it to see the help cannot promote anyone;
 *   * it is idempotent in both directions, so a retry after a half-finished
 *     deploy is safe and a second promotion does not error;
 *   * unlike the seed, it is allowed in production — that is the only place it
 *     is ever needed.
 *
 * The connection is the OWNER pool, not the application pool. This is a
 * platform-level operation, and doing it as `hq_app` would be subject to the very
 * row level security policies this role sits outside of.
 */

import { adminPool, closePools } from '../src/db/pool.js';

/** The role this script grants. Fixed: the point is not to parameterise it. */
const ROLE_KEY = 'platform_admin';

export type Direction = 'promote' | 'revoke';

export interface ParsedArgs {
    direction: Direction;
    /** Guaranteed present: `parseArgs` returns the error variant otherwise. */
    email: string;
    confirmed: boolean;
}

/** What the script will do, resolved against the database. */
export interface Plan {
    direction: Direction;
    email: string;
    /** False when no account has this address. */
    userExists: boolean;
    fullName: string | undefined;
    userId: number | undefined;
    /** Whether the user currently holds the role. */
    currentlyAdmin: boolean;
    /** Whether this run would change anything. */
    wouldChange: boolean;
}

/** The result of actually doing it. */
export interface Outcome extends Plan {
    /** True when a row was written. False when the state was already correct. */
    changed: boolean;
}

/**
 * Reads the arguments.
 *
 * Parsed by hand rather than with a library because the accepted set is three
 * things and the failure mode matters: an unknown flag has to be an error, not
 * something quietly ignored, or `--yesy` would read as a confirmation.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
    const directionFlag = argv[0];

    if (directionFlag !== 'promote' && directionFlag !== 'revoke') {
        return { error: `first argument must be "promote" or "revoke", got ${directionFlag ?? 'nothing'}` };
    }

    const direction: Direction = directionFlag;
    const rest = argv.slice(1);
    const emailArgs: string[] = [];
    let confirmed = false;

    for (const arg of rest) {
        if (arg === '--yes' || arg === '-y') {
            confirmed = true;
            continue;
        }
        if (arg.startsWith('-')) {
            return { error: `unknown option: ${arg}` };
        }
        emailArgs.push(arg);
    }

    if (emailArgs.length === 0) {
        return { error: 'an email address is required' };
    }
    if (emailArgs.length > 1) {
        return { error: `expected one email address, got ${emailArgs.length}` };
    }

    // Rejected here rather than left to the database so the message can say why.
    // `users_email_format` is the authoritative check; this is a copy of it, and
    // the database still gets the final say.
    const email = emailArgs[0]!;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { error: `"${email}" is not a usable email address` };
    }

    return { direction, email, confirmed };
}

/** Looks up the role id. A missing role means the database is not migrated. */
async function roleId(client: import('pg').PoolClient): Promise<number> {
    const { rows } = await client.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_key = $1 AND scope = 'platform'`,
        [ROLE_KEY],
    );
    if (!rows[0]) {
        throw new Error(`role ${ROLE_KEY} is missing — run \`npm run db:migrate\` first`);
    }
    return Number(rows[0].role_id);
}

/**
 * Resolves what the script would do, without doing it.
 *
 * Separate from the write so that a dry run and a real run cannot disagree: both
 * call this, and the only difference between them is whether the caller goes on
 * to issue the statement.
 *
 * `email` is compared case-insensitively here, matching the `CITEXT` column. The
 * column would do it anyway, but doing it in the query means the dry run reports
 * the same user a real run would act on, rather than reporting "unknown email"
 * for an address that exists with different capitalisation.
 */
async function resolvePlan(client: import('pg').PoolClient, direction: Direction, email: string): Promise<Plan> {
    const { rows: userRows } = await client.query<{ user_id: string; full_name: string; status: string }>(
        'SELECT user_id, full_name, status FROM users WHERE email = $1',
        [email],
    );

    const user = userRows[0];
    if (!user) {
        return {
            direction,
            email,
            userExists: false,
            fullName: undefined,
            userId: undefined,
            currentlyAdmin: false,
            wouldChange: false,
        };
    }

    const userId = Number(user.user_id);
    const id = await roleId(client);

    const { rows: roleRows } = await client.query<{ present: boolean }>(
        'SELECT TRUE AS present FROM user_platform_roles WHERE user_id = $1 AND role_id = $2',
        [userId, id],
    );

    const currentlyAdmin = roleRows.length > 0;

    return {
        direction,
        email,
        userExists: true,
        fullName: user.full_name,
        userId,
        currentlyAdmin,
        // Promoting someone who is already an admin writes nothing, and revoking
        // from someone who is not writes nothing. Both are successes, not errors:
        // the caller's intent is "make it so", and it already is.
        wouldChange: direction === 'promote' ? !currentlyAdmin : currentlyAdmin,
    };
}

/** The sentence a dry run prints, describing the change without performing it. */
function describePlan(plan: Plan): string {
    if (!plan.userExists) {
        return [
            `No account has the address ${plan.email}.`,
            'This script does not create accounts.',
            'Register through the site first, then run this again with the same address.',
        ].join('\n');
    }

    const who = `${plan.fullName} <${plan.email}>`;

    if (!plan.wouldChange) {
        return plan.direction === 'promote'
            ? `${who} already holds ${ROLE_KEY}. Nothing to do.`
            : `${who} does not hold ${ROLE_KEY}. Nothing to do.`;
    }

    return plan.direction === 'promote'
        ? `Would GRANT ${ROLE_KEY} to ${who}.`
        : `Would REVOKE ${ROLE_KEY} from ${who}.`;
}

/**
 * Writes the change.
 *
 * `ON CONFLICT DO NOTHING` on the way in and a plain `DELETE` on the way out:
 * between them they make the script safe to re-run, which matters because the
 * scenario where someone runs it twice is the scenario where they are not sure
 * whether the first run worked.
 *
 * The delete is scoped to the role id and not to "all roles", so revoking the
 * admin role cannot take `customer` with it.
 */
async function apply(
    client: import('pg').PoolClient,
    plan: Plan,
    roleIdValue: number,
): Promise<boolean> {
    if (plan.userId === undefined) return false;

    if (plan.direction === 'promote') {
        const { rowCount } = await client.query(
            `INSERT INTO user_platform_roles (user_id, role_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, role_id) DO NOTHING`,
            [plan.userId, roleIdValue],
        );
        return (rowCount ?? 0) > 0;
    }

    const { rowCount } = await client.query(
        'DELETE FROM user_platform_roles WHERE user_id = $1 AND role_id = $2',
        [plan.userId, roleIdValue],
    );
    return (rowCount ?? 0) > 0;
}

/**
 * Runs the script.
 *
 * Returns the process exit code instead of calling `process.exit`, so the tests
 * can drive every path — including the refusals — without a subprocess and
 * without ending the test runner.
 */
export async function run(argv: readonly string[], log: (line: string) => void = console.log): Promise<number> {
    const parsed = parseArgs(argv);
    if ('error' in parsed) {
        log(`[admin] ${parsed.error}`);
        log('[admin] usage: npm run db:promote-admin -- <email> --yes');
        log('[admin]        npm run db:revoke-admin -- <email> --yes');
        return 1;
    }

    const client = await adminPool.connect();
    try {
        const plan = await resolvePlan(client, parsed.direction, parsed.email);

        if (!plan.userExists) {
            // An error, not a dry run: the operator asked to change a specific
            // account and there is no such account. Exiting non-zero is what
            // makes a deployment script notice.
            log(describePlan(plan));
            return 1;
        }

        if (!parsed.confirmed) {
            log(describePlan(plan));
            log('[admin] nothing was changed. Re-run with --yes to apply it.');
            return 1;
        }

        if (!plan.wouldChange) {
            // Already in the requested state. A success, because a deploy script
            // that fails on "no change needed" gets wrapped in retries.
            log(describePlan(plan));
            log(`[admin] done, nothing to change.`);
            return 0;
        }

        const id = await roleId(client);
        const changed = await apply(client, plan, id);

        log(
            plan.direction === 'promote'
                ? `[admin] granted ${ROLE_KEY} to ${plan.fullName} <${plan.email}>.`
                : `[admin] revoked ${ROLE_KEY} from ${plan.fullName} <${plan.email}>.`,
        );
        if (!changed) {
            // The plan said there was something to do and the write did not
            // happen. Almost always a concurrent run that got there first, and
            // harmless — but it is worth saying rather than reporting a change
            // that was not made.
            log('[admin] the state was already correct; no row was written.');
        }
        return 0;
    } finally {
        client.release();
    }
}

const isDirectRun = process.argv[1] !== undefined
    && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isDirectRun) {
    run(process.argv.slice(2))
        .then((code) => closePools().then(() => { process.exitCode = code; }))
        .catch(async (error: unknown) => {
            console.error('[admin]', error instanceof Error ? error.message : error);
            await closePools();
            process.exit(1);
        });
}
