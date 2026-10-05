/**
 * Phone-number login: registration, normalisation and lookup.
 *
 * These run against a REAL PostgreSQL database (hq_marketplace_test), because
 * the guarantees under test are the unique index on users.phone and the
 * SECURITY DEFINER lookup that resolves an identifier to a row. Neither can be
 * asserted against a mock.
 *
 * Migration 007 owns the unique index and the E.164 CHECK; 008 made the email
 * column nullable and taught the registration-read policy about phones. If any
 * of this is reverted, the tests that assert a 409 on a duplicate number and a
 * 201 on a phone-only account fail first.
 */
process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';
import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { normalisePhone, PhoneValidationError } from '../src/modules/auth/phone.js';
const assert = assertModule;
let app;
let adminPool;
let closePools;
const PASSWORD = 'Password123!';
/** Unused per test, so each one registers a fresh account. */
let seq = 0;
function nextEmail(prefix) {
    seq += 1;
    return `${prefix}-${seq}@hq.test`;
}
async function register(body) {
    return request(app).post('/api/auth/register').send(body);
}
async function login(body) {
    return request(app).post('/api/auth/login').send(body);
}
before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});
after(async () => {
    await closePools?.();
});
describe('Registration: email, phone, or both', () => {
    it('registers a customer with an email only, exactly as before', async () => {
        const email = nextEmail('email-only');
        const res = await register({ email, password: PASSWORD, fullName: 'Email Only' });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.data.user.email, email);
        assert.equal(res.body.data.user.phone, null);
        assert.ok(res.body.data.token, 'a token is issued');
        assert.equal(res.body.data.business, null, 'a customer owns no business');
    });
    it('registers a customer with a phone number only', async () => {
        const res = await register({ phone: '61 000 0000', password: PASSWORD, fullName: 'Phone Only' });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.data.user.phone, '+252610000000', 'stored in E.164');
        assert.equal(res.body.data.user.email, null);
        assert.ok(res.body.data.token);
    });
    it('registers a customer with both an email and a phone number', async () => {
        const email = nextEmail('both');
        const res = await register({
            email,
            phone: '0770000000',
            password: PASSWORD,
            fullName: 'Both Ways',
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.data.user.email, email);
        assert.equal(res.body.data.user.phone, '+252770000000');
    });
    it('stores every accepted spelling of one number as the same account', async () => {
        // The whole point of normalising: a Somali mobile typed five different
        // ways is still one identity, so a second registration with another
        // spelling is a conflict rather than a duplicate.
        const spellings = ['61 111 1111', '0611111111', '+252611111111', '(061) 111-1111', '00252611111111'];
        const created = [];
        for (const [index, spelling] of spellings.entries()) {
            const res = await register({ phone: spelling, password: PASSWORD, fullName: `Spelling ${index}` });
            if (index === 0) {
                assert.equal(res.status, 201, JSON.stringify(res.body));
                created.push(res.body.data.user.phone);
            }
            else {
                assert.equal(res.status, 409, `spelling ${spelling} should be a conflict`);
                assert.equal(res.body.error.details.field, 'phone');
            }
        }
        assert.deepEqual(created, ['+252611111111']);
    });
    it('rejects a registration with neither an email nor a phone number', async () => {
        const res = await register({ password: PASSWORD, fullName: 'No Identity' });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });
    it('registers a business owner and gives them their business', async () => {
        const res = await register({
            phone: '61 222 2222',
            password: PASSWORD,
            fullName: 'Owner Person',
            role: 'business_owner',
            businessName: 'Phone Owner Clinic',
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.ok(res.body.data.business, 'a business is created alongside the account');
        assert.equal(res.body.data.business.business_name, 'Phone Owner Clinic');
        assert.equal(res.body.data.business.status, 'pending', 'onboarding starts unapproved');
        // the owner must be a member of the business they just created, or the
        // account is created but unusable
        const { rows } = await adminPool.query(`SELECT r.role_key, bu.status
               FROM business_users bu
               JOIN roles r ON r.role_id = bu.role_id
              WHERE bu.business_id = $1`, [res.body.data.business.business_id]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].role_key, 'business_owner');
        assert.equal(rows[0].status, 'active');
    });
    it('refuses business_owner without a business name', async () => {
        const res = await register({
            phone: '61 333 3333',
            password: PASSWORD,
            fullName: 'Owner Without Business',
            role: 'business_owner',
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.details.field, 'businessName');
    });
});
describe('Registration: duplicate identity', () => {
    it('refuses a second account with the same email', async () => {
        const email = nextEmail('dupe');
        const first = await register({ email, password: PASSWORD, fullName: 'First' });
        assert.equal(first.status, 201);
        const second = await register({ email, password: PASSWORD, fullName: 'Second' });
        assert.equal(second.status, 409);
        assert.equal(second.body.error.details.field, 'email');
    });
    it('refuses a second account with the same phone number', async () => {
        const first = await register({ phone: '61 444 4444', password: PASSWORD, fullName: 'First' });
        assert.equal(first.status, 201, JSON.stringify(first.body));
        const second = await register({ phone: '+252614444444', password: PASSWORD, fullName: 'Second' });
        assert.equal(second.status, 409, JSON.stringify(second.body));
        assert.equal(second.body.error.details.field, 'phone');
        assert.match(second.body.error.message, /already registered/i);
    });
    it('refuses a phone that is already taken even when the email differs', async () => {
        await register({ phone: '61 555 5555', password: PASSWORD, fullName: 'Owner Of Number' });
        const other = await register({
            email: nextEmail('other-email'),
            phone: '0615555555',
            password: PASSWORD,
            fullName: 'Thief Of Number',
        });
        assert.equal(other.status, 409);
        assert.equal(other.body.error.details.field, 'phone');
    });
    it('allows many accounts with no phone at all', async () => {
        // The unique index is partial, so NULL is not a shared value.
        const a = await register({ email: nextEmail('no-phone-a'), password: PASSWORD, fullName: 'No Phone A' });
        const b = await register({ email: nextEmail('no-phone-b'), password: PASSWORD, fullName: 'No Phone B' });
        assert.equal(a.status, 201);
        assert.equal(b.status, 201, 'two accounts may both have no phone');
    });
});
describe('Registration: invalid phone numbers', () => {
    const invalid = [
        ['letters only', 'not a number', 400],
        ['letters mixed in', '+252 61 ABC 0000', 400],
        ['a foreign country code', '+1 202 555 0143', 400],
        ['another foreign country code', '+44 7700 900123', 400],
        ['too short', '61 000', 400],
        ['an email address', 'someone@hq.test', 400],
    ];
    for (const [label, value, expected] of invalid) {
        it(`rejects ${label} with a clear error`, async () => {
            const res = await register({ phone: value, password: PASSWORD, fullName: `Bad ${label}` });
            assert.equal(res.status, expected, `expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`);
            assert.equal(res.body.error.code, 'BAD_REQUEST');
            assert.equal(res.body.error.details.field, 'phone');
            assert.ok(typeof res.body.error.details.reason === 'string' && res.body.error.details.reason.length > 0, 'the error names the reason the number was rejected');
            assert.ok(res.body.error.message.length > 10, 'the message is meant for a human, not a stack trace');
        });
    }
    it('rejects an invalid phone with an explanation, not a generic validation error', async () => {
        const res = await register({ phone: '+1 202 555 0143', password: PASSWORD, fullName: 'Foreign' });
        assert.match(res.body.error.message, /\+252/);
    });
});
describe('Login: identifier may be an email or a phone number', () => {
    it('logs in with an email', async () => {
        const email = nextEmail('login-email');
        await register({ email, password: PASSWORD, fullName: 'Email Login' });
        const res = await login({ identifier: email, password: PASSWORD });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.user.email, email);
    });
    it('logs in with a phone number', async () => {
        await register({ phone: '61 666 6666', password: PASSWORD, fullName: 'Phone Login' });
        const res = await login({ identifier: '+252616666666', password: PASSWORD });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.user.phone === undefined || res.body.data.user.phone === null, true);
        assert.equal(res.body.data.user.email, null, 'the response does not leak the phone');
    });
    it('logs in with a phone number typed in a different format', async () => {
        await register({ phone: '61 777 7777', password: PASSWORD, fullName: 'Flexible Login' });
        for (const spelling of ['617777777', '0617777777', '61 777 7777', '00252617777777']) {
            const res = await login({ identifier: spelling, password: PASSWORD });
            assert.equal(res.status, 200, `spelling ${spelling} should log in: ${JSON.stringify(res.body)}`);
        }
    });
    it('still accepts the older `email` field name', async () => {
        const email = nextEmail('legacy-field');
        await register({ email, password: PASSWORD, fullName: 'Legacy Client' });
        const res = await login({ email, password: PASSWORD });
        assert.equal(res.status, 200, 'a client written before `identifier` still works');
    });
    it('is case insensitive for the email', async () => {
        const email = nextEmail('case-test');
        await register({ email, password: PASSWORD, fullName: 'Case Test' });
        const res = await login({ identifier: email.toUpperCase(), password: PASSWORD });
        assert.equal(res.status, 200);
    });
    it('rejects a wrong password for a phone login', async () => {
        await register({ phone: '61 888 8888', password: PASSWORD, fullName: 'Wrong Password' });
        const res = await login({ identifier: '+252618888888', password: 'not-the-password' });
        assert.equal(res.status, 401);
    });
    it('rejects an unknown phone number', async () => {
        const res = await login({ identifier: '+252619999999', password: PASSWORD });
        assert.equal(res.status, 401);
    });
    it('rejects a malformed identifier with a 400 rather than a 401', async () => {
        const res = await login({ identifier: '+1 202 555 0143', password: PASSWORD });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'BAD_REQUEST');
    });
    it('rejects a login with no identifier at all', async () => {
        const res = await login({ password: PASSWORD });
        assert.equal(res.status, 400);
    });
});
describe('Normalisation, in isolation', () => {
    const sameNumber = [
        ['61 000 0000', '+252610000000'],
        ['61-000-0000', '+252610000000'],
        ['(061) 000-0000', '+252610000000'],
        ['0610000000', '+252610000000'],
        ['+252610000000', '+252610000000'],
        ['252610000000', '+252610000000'],
        ['00252610000000', '+252610000000'],
    ];
    for (const [input, expected] of sameNumber) {
        it(`normalises ${JSON.stringify(input)} to ${expected}`, () => {
            assert.equal(normalisePhone(input), expected);
        });
    }
    it('refuses a value it cannot normalise', () => {
        assert.throws(() => normalisePhone('nonsense'), PhoneValidationError);
    });
    it('reports why a value was refused', () => {
        try {
            normalisePhone('+44 7700 900123');
            assert.fail('should have thrown');
        }
        catch (error) {
            assert.ok(error instanceof PhoneValidationError);
            assert.equal(error.reason, 'unsupported country code');
        }
    });
});
describe('The database refuses a phone that is not E.164', () => {
    it('rejects a value the API would never produce', async () => {
        // The application normalises first, so this is the last line of defence
        // against a second writer, a migration, or a psql session.
        const email = nextEmail('direct-insert');
        await assert.rejects(adminPool.query(`INSERT INTO users (email, phone, password_hash, full_name, status)
                 VALUES ($1, '0610000000', 'x', 'Direct Insert', 'active')`, [email]), /users_phone_format/);
    });
    it('rejects a duplicate number even when it is written directly in SQL', async () => {
        await register({ phone: '61 000 1234', password: PASSWORD, fullName: 'Direct Dupe Source' });
        await assert.rejects(adminPool.query(`INSERT INTO users (email, phone, password_hash, full_name, status)
                 VALUES ($1, '+252610001234', 'x', 'Direct Dupe', 'active')`, [nextEmail('direct-dupe')]), /users_phone_unique/);
    });
});
//# sourceMappingURL=phone-login.test.js.map