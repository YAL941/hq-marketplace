/**
 * The application database role check.
 *
 * Row level security in this project is not a property of the queries; it is a
 * property of who runs them. `hq_app` does not own the tables, so PostgreSQL
 * filters its rows through the policies. The same API connected as the schema
 * owner answers every request with `200` and hands back other businesses' rows
 * — the worst kind of failure there is: silent, and invisible to the test suite,
 * because no test asserts on a cross-tenant query that the database should have
 * refused to run in the first place.
 *
 * So the guard is tested two ways:
 *
 *   1. Against the real connection the application will actually use, which
 *      proves the role this deployment is configured with is a safe one.
 *   2. Against canned catalog answers, which covers the unsafe roles without
 *      creating them. That second half matters because the unsafe roles cannot
 *      be created safely from here: `rolsuper` and `BYPASSRLS` both require a
 *      superuser to grant, and taking ownership of a real table would leave the
 *      shared test database in a different state for every other test file.
 */
process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';
import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
const assert = assertModule;
let appPool;
let adminPool;
let closePools;
let inspectAppRole;
let assertAppRoleIsSafe;
let config;
/**
 * A stand-in for a pool that answers the two catalog questions with fixed
 * values, so each unsafe shape can be described exactly.
 *
 * It matches on which table the query reads rather than on the SQL text, so
 * reformatting the query in `src/db/pool.ts` cannot quietly turn this into a
 * stub that always returns the safe answer.
 */
function fakePool(role, ownership) {
    return {
        query: ((text) => {
            if (text.includes('FROM pg_roles')) {
                return Promise.resolve({ rows: [role] });
            }
            if (text.includes('FROM pg_class')) {
                return Promise.resolve({ rows: [ownership] });
            }
            return Promise.reject(new Error(`unexpected query in the role check: ${text}`));
        }),
    };
}
const safeRole = { rolsuper: false, rolbypassrls: false, current_user: 'hq_app' };
before(async () => {
    const poolModule = await import('../src/db/pool.js');
    appPool = poolModule.appPool;
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    inspectAppRole = poolModule.inspectAppRole;
    assertAppRoleIsSafe = poolModule.assertAppRoleIsSafe;
    ({ config } = await import('../src/config.js'));
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});
after(async () => {
    await closePools();
});
describe('the application database role, as configured', () => {
    it('is the role the application will actually connect as', async () => {
        // Guards the guard: if `appPool` were ever pointed at the admin pool,
        // every other assertion in this file would be about the wrong role.
        assert.equal(config.APP_DB_USER, 'hq_app');
        assert.notEqual(config.PGUSER, config.APP_DB_USER);
    });
    it('is safe, on the connection the API uses', async () => {
        const finding = await inspectAppRole(appPool);
        assert.equal(finding.unsafe, false, `the configured application role should be safe, but: ${finding.problems.join('; ')}`);
        assert.deepEqual(finding.problems, []);
    });
    it('is safe to start with outside production', async () => {
        // The suite runs as a safe role, so the refusal path cannot be reached
        // here. What is asserted is the other half of the contract: a safe role
        // is never blocked, not even with the loud warning switched on.
        assert.notEqual(config.NODE_ENV, 'production');
        const finding = await assertAppRoleIsSafe();
        assert.equal(finding.unsafe, false);
    });
    it('would be caught if the application were pointed at the migration role', async () => {
        // The migration pool runs as the schema owner, which is a superuser on
        // a stock server. If someone points APP_DB_USER at it, this is exactly
        // what the check would see — and it must not come back clean.
        const finding = await inspectAppRole(adminPool);
        assert.equal(finding.unsafe, true, 'the admin/migration role should be reported unsafe; if this fails the guard is not reading pg_roles');
    });
});
describe('the role check, on roles it must reject', () => {
    it('rejects a superuser', async () => {
        const finding = await inspectAppRole(fakePool({ ...safeRole, current_user: 'root', rolsuper: true }, { tables: null }));
        assert.equal(finding.unsafe, true);
        assert.ok(finding.problems.some((problem) => problem.includes('root') && /superuser/.test(problem)), `the problem should name the role and the reason: ${finding.problems.join('; ')}`);
    });
    it('rejects BYPASSRLS', async () => {
        const finding = await inspectAppRole(fakePool({ ...safeRole, current_user: 'hq_exempt', rolbypassrls: true }, { tables: null }));
        assert.equal(finding.unsafe, true);
        assert.ok(finding.problems.some((problem) => problem.includes('BYPASSRLS')), `the problem should name BYPASSRLS: ${finding.problems.join('; ')}`);
    });
    it('rejects a role that owns an application table', async () => {
        // The mistake this exists to catch: pointing APP_DB_USER at the schema
        // owner rather than at the role `db:grants` creates.
        const finding = await inspectAppRole(fakePool(safeRole, { tables: ['businesses', 'users'] }));
        assert.equal(finding.unsafe, true);
        assert.ok(finding.problems.some((problem) => problem.includes('businesses')), `the problem should name the owned table: ${finding.problems.join('; ')}`);
        assert.match(finding.problems.join('\n'), /FORCE ROW LEVEL SECURITY/);
    });
    it('does not count the migration ledger as an application table', async () => {
        // `schema_migrations` is the migration role's and is revoked from the
        // application. Counting it would make every safe role look like an owner
        // the moment it held the ledger.
        const finding = await inspectAppRole(fakePool(safeRole, { tables: ['schema_migrations'] }));
        assert.equal(finding.unsafe, false, finding.problems.join('; '));
    });
    it('accepts a role that owns nothing and holds only ordinary privileges', async () => {
        const finding = await inspectAppRole(fakePool(safeRole, { tables: null }));
        assert.equal(finding.unsafe, false);
        assert.deepEqual(finding.problems, []);
    });
    it('treats a NULL table list as owning nothing', async () => {
        // `json_agg` over no rows returns NULL, not an empty array, so the
        // happy path depends on handling this rather than on the array case.
        const finding = await inspectAppRole(fakePool(safeRole, { tables: null }));
        assert.equal(finding.unsafe, false);
    });
    it('survives a table list the driver did not decode', async () => {
        // A `_text` column comes back from node-postgres as the literal
        // `{"businesses","users"}` string rather than an array. If the check
        // assumed an array it would either throw — taking the whole API down at
        // startup — or invent a table with a brace in its name.
        const finding = await inspectAppRole(fakePool(safeRole, { tables: '{"businesses","users"}' }));
        assert.equal(finding.unsafe, false, 'an undecoded list must not be read as one huge table name');
    });
});
//# sourceMappingURL=app-role-guard.test.js.map