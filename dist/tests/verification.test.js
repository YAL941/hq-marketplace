/**
 * Business registration, the staff read, and platform verification.
 *
 * Three things are being pinned down here, and they are related:
 *
 *   1. `POST /businesses/register` accepts a WhatsApp number, normalises phone
 *      and WhatsApp to E.164, and refuses an unusable one with `details.field`
 *      rather than letting it reach a CHECK constraint.
 *   2. `GET /business/:businessId` returns a business to its own staff whatever
 *      state it is in, so a pending or rejected business is inspectable by the
 *      owner — and by nobody else.
 *   3. `/api/admin/*` is reachable only by a platform admin, and its decisions
 *      are the only way a business leaves `pending`.
 *
 * The pending/approved/rejected transitions are asserted through the *public*
 * directory rather than through the admin response, because "is this business
 * listed" is the question the verification workflow exists to answer.
 */
process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';
import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
const assert = assertModule;
const PASSWORD = 'Password123!';
let app;
let adminPool;
let closePools;
let ownerA;
let ownerB;
let admin;
let anonymousOwner;
async function createUser(email, fullName) {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const { rows } = await adminPool.query(`INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active') RETURNING user_id`, [email, passwordHash, fullName]);
    return Number(rows[0].user_id);
}
async function login(email) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    if (res.status !== 200)
        throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.data.token;
}
/**
 * Registers a business the way the onboarding page does, so these tests go
 * through the real route (including its normalisation) rather than around it.
 */
async function registerBusiness(token, body) {
    return request(app).post('/api/businesses/register').set('Authorization', `Bearer ${token}`).send(body);
}
async function actor(email, fullName, isPlatformAdmin = false) {
    const id = await createUser(email, fullName);
    if (isPlatformAdmin) {
        const { rows } = await adminPool.query(`SELECT role_id FROM roles WHERE role_key = 'platform_admin' AND scope = 'platform'`);
        await adminPool.query('INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2)', [id, rows[0].role_id]);
    }
    return { id, email, token: await login(email) };
}
/** The business row as it stands, read with the admin connection. */
async function businessRow(businessId) {
    const { rows } = await adminPool.query('SELECT * FROM businesses WHERE business_id = $1', [businessId]);
    return rows[0];
}
before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
    ownerA = await actor('verify-owner-a@hq.test', 'Verify Owner A');
    ownerB = await actor('verify-owner-b@hq.test', 'Verify Owner B');
    anonymousOwner = await actor('verify-anon@hq.test', 'Verify Anon');
    admin = await actor('verify-admin@hq.test', 'Verify Admin', true);
    const a = await registerBusiness(ownerA.token, {
        businessName: 'Verify Grill House',
        description: 'Grill and tea house in the verification queue.',
        phone: '61 000 0001',
        whatsapp: '252 61 000 0002',
        city: 'Mogadishu',
        district: 'Hamar Weyne',
    });
    assert.equal(a.status, 201, `owner A registration failed: ${JSON.stringify(a.body)}`);
    ownerA.businessId = Number(a.body.data.business_id);
    const b = await registerBusiness(ownerB.token, {
        businessName: 'Verify Bookshop',
        email: 'verify-owner-b@hq.test',
        city: 'Hargeisa',
    });
    assert.equal(b.status, 201, `owner B registration failed: ${JSON.stringify(b.body)}`);
    ownerB.businessId = Number(b.body.data.business_id);
    // A second business for owner A, used to prove one owner cannot decide for
    // another one of their own, and that a no-op decision is refused.
    const second = await registerBusiness(ownerA.token, { businessName: 'Verify Pharmacy Annex' });
    assert.equal(second.status, 201, `second registration failed: ${JSON.stringify(second.body)}`);
    anonymousOwner.businessId = Number(second.body.data.business_id);
});
after(async () => {
    await closePools?.();
});
describe('POST /api/businesses/register: phone and WhatsApp', () => {
    it('stores both numbers in E.164, whatever shape they arrived in', async () => {
        const row = await businessRow(ownerA.businessId);
        assert.equal(row['phone'], '+252610000001');
        assert.equal(row['whatsapp_number'], '+252610000002');
    });
    it('returns only what it returned before, with a pending status', async () => {
        const res = await request(app)
            .post('/api/businesses/register')
            .set('Authorization', `Bearer ${anonymousOwner.token}`)
            .send({ businessName: 'Verify Shape Check' });
        assert.equal(res.status, 201);
        assert.deepEqual(Object.keys(res.body.data).sort(), ['business_id', 'business_name', 'business_slug', 'status'], 'the response must not grow fields the owner has no use for');
        assert.equal(res.body.data.status, 'pending');
    });
    it('leaves the numbers null when they are omitted or blank', async () => {
        const res = await requestBusiness('Verify No Numbers', { phone: '   ' });
        const row = await businessRow(res);
        assert.equal(row['phone'], null);
        assert.equal(row['whatsapp_number'], null);
    });
    it('rejects an unusable phone with details.field = phone', async () => {
        const res = await registerBusiness(anonymousOwner.token, {
            businessName: 'Verify Bad Phone',
            phone: 'not a number',
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.details.field, 'phone');
    });
    it('rejects an unusable WhatsApp with details.field = whatsapp', async () => {
        const res = await registerBusiness(anonymousOwner.token, {
            businessName: 'Verify Bad Whatsapp',
            whatsapp: '+44 20 7946 0000',
        });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.details.field, 'whatsapp');
    });
    it('requires authentication', async () => {
        const res = await request(app).post('/api/businesses/register').send({ businessName: 'Verify Anonymous' });
        assert.equal(res.status, 401);
    });
    it('exposes the write rate limiter, so the middleware is provably in the path', async () => {
        const res = await registerBusiness(anonymousOwner.token, { businessName: 'Verify Limited' });
        const policy = res.headers['ratelimit-policy'] ?? res.headers['x-ratelimit-policy'];
        assert.equal(res.status, 201);
        assert.equal(typeof policy, 'string', 'a rate limit policy header is present, which only happens when the limiter ran');
    });
});
describe('GET /api/business/:businessId: the staff read', () => {
    it('returns a pending business to its owner, verification state included', async () => {
        const res = await request(app)
            .get(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        const business = res.body.data;
        assert.equal(business.business_id, String(ownerA.businessId));
        assert.equal(business.status, 'pending');
        assert.equal(business.verification_status, 'pending');
        assert.equal(business.is_verified, false);
        assert.equal(business.verified_at, null);
        assert.equal(business.rejection_reason, null);
        assert.equal(business.phone, '+252610000001');
        assert.equal(business.whatsapp_number, '+252610000002');
        assert.equal(business.city, 'Mogadishu');
    });
    it('answers 404 for the public profile of a pending business, which is why this read exists', async () => {
        const res = await request(app).get(`/api/businesses/${ownerA.businessId}`);
        assert.equal(res.status, 404);
    });
    it('answers 403 to an owner asking about somebody else\'s business', async () => {
        const res = await request(app)
            .get(`/api/business/${ownerB.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(res.status, 403);
    });
    it('answers 401 without a token', async () => {
        const res = await request(app).get(`/api/business/${ownerA.businessId}`);
        assert.equal(res.status, 401);
    });
});
describe('PATCH /api/business/:businessId: WhatsApp on an existing business', () => {
    it('normalises the number it stores', async () => {
        const res = await request(app)
            .patch(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ whatsapp: '090 555 0100' });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.whatsapp_number, '+252905550100');
    });
    it('normalises the business phone the same way', async () => {
        const res = await request(app)
            .patch(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ phone: '+252 61 222 3333' });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.phone, '+252612223333');
    });
    it('clears the number when the field is sent as null', async () => {
        const res = await request(app)
            .patch(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ whatsapp: null });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.whatsapp_number, null);
    });
    it('rejects an unusable number with details.field instead of a constraint error', async () => {
        const res = await request(app)
            .patch(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ whatsapp: 'whatsapp me' });
        assert.equal(res.status, 400);
        assert.equal(res.body.error.details.field, 'whatsapp');
    });
    it('leaves the stored number alone when the patch is refused', async () => {
        await request(app)
            .patch(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ whatsapp: '090 555 0400' });
        await request(app)
            .patch(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ whatsapp: 'nonsense' });
        const row = await businessRow(ownerA.businessId);
        assert.equal(row['whatsapp_number'], '+252905550400');
    });
});
describe('/api/admin: only a platform admin gets in', () => {
    it('answers 401 without a token', async () => {
        assert.equal((await request(app).get('/api/admin/businesses')).status, 401);
        assert.equal((await request(app).patch('/api/admin/businesses/1/verification').send({ decision: 'approve' })).status, 401);
    });
    it('answers 403 to an authenticated non-admin', async () => {
        const list = await request(app)
            .get('/api/admin/businesses')
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(list.status, 403);
        const decide = await request(app)
            .patch(`/api/admin/businesses/${ownerA.businessId}/verification`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ decision: 'approve' });
        assert.equal(decide.status, 403);
    });
    it('stops an owner approving their own business', async () => {
        const res = await request(app)
            .patch(`/api/admin/businesses/${ownerA.businessId}/verification`)
            .set('Authorization', `Bearer ${ownerA.token}`)
            .send({ decision: 'approve' });
        assert.equal(res.status, 403);
        const row = await businessRow(ownerA.businessId);
        assert.equal(row['status'], 'pending', 'the business must still be pending');
        assert.equal(row['verification_status'], 'pending');
    });
});
describe('GET /api/admin/businesses: the verification queue', () => {
    it('lists pending businesses to the admin with the owner attached', async () => {
        const res = await request(app)
            .get('/api/admin/businesses?status=pending')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.ok(res.body.data.length >= 3, 'every registered business is pending');
        assert.equal(res.body.meta.page, 1);
        assert.equal(res.body.meta.limit, 20);
        const first = res.body.data[0];
        for (const field of [
            'business_id', 'business_name', 'business_slug', 'business_description',
            'category_name', 'city', 'district', 'phone', 'whatsapp_number', 'email',
            'status', 'verification_status', 'rejection_reason', 'created_at',
            'owner_full_name', 'owner_email',
        ]) {
            assert.ok(field in first, `the queue row is missing ${field}`);
        }
    });
    it('caps the page size at 50', async () => {
        const res = await request(app)
            .get('/api/admin/businesses?status=pending&limit=500')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(res.status, 400);
    });
    it('rejects a status it does not know', async () => {
        const res = await request(app)
            .get('/api/admin/businesses?status=exploded')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(res.status, 400);
    });
});
describe('admin business search and notifications', () => {
    it('searches and returns state counts in one paginated response', async () => {
        const res = await request(app)
            .get('/api/admin/businesses?status=all&search=Verify%20Grill&page=1&limit=5')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.ok(res.body.data.some((row) => row.business_name === 'Verify Grill House'));
        assert.ok(res.body.counts.all >= 1);
        assert.ok(res.body.counts.pending >= 1);
        assert.equal(res.body.meta.page, 1);
        assert.equal(res.body.meta.limit, 5);
    });
    it('returns recent registrations and marks unseen pending businesses as seen', async () => {
        const recent = await request(app)
            .get('/api/admin/businesses/notifications')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(recent.status, 200, JSON.stringify(recent.body));
        assert.ok(recent.body.data.unreadCount >= 3);
        assert.ok(recent.body.data.recent.length <= 10);
        assert.ok(recent.body.data.recent.some((row) => row.is_new));
        const marked = await request(app)
            .post('/api/admin/businesses/notifications/mark-seen')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(marked.status, 200);
        const after = await request(app)
            .get('/api/admin/businesses/notifications')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(after.body.data.unreadCount, 0);
    });
});
describe('PATCH /api/admin/businesses/:id/verification: approve', () => {
    it('makes the business public, by id and by slug', async () => {
        const slug = (await businessRow(ownerA.businessId))['business_slug'];
        const hiddenBefore = await request(app).get('/api/businesses?limit=50');
        assert.ok(!hiddenBefore.body.data.some((b) => b.business_id === String(ownerA.businessId)), 'a pending business must not be listed');
        const decided = await request(app)
            .patch(`/api/admin/businesses/${ownerA.businessId}/verification`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ decision: 'approve' });
        assert.equal(decided.status, 200, JSON.stringify(decided.body));
        assert.equal(decided.body.data.status, 'active');
        assert.equal(decided.body.data.verification_status, 'verified');
        assert.equal(decided.body.data.is_verified, true);
        assert.ok(decided.body.data.verified_at, 'verified_at must be set');
        assert.equal(decided.body.data.rejection_reason, null);
        const row = await businessRow(ownerA.businessId);
        assert.equal(String(row['verified_by']), String(admin.id), 'the admin must be recorded');
        const list = await request(app).get('/api/businesses?limit=50');
        assert.ok(list.body.data.some((b) => b.business_id === String(ownerA.businessId)), 'an approved business must be listed');
        const bySlug = await request(app).get(`/api/businesses/slug/${slug}`);
        assert.equal(bySlug.status, 200, JSON.stringify(bySlug.body));
        assert.equal(bySlug.body.data.business_id, String(ownerA.businessId));
        const publicProfile = await request(app).get(`/api/businesses/${ownerA.businessId}`);
        assert.equal(publicProfile.status, 200);
    });
    it('refuses to decide the same thing twice', async () => {
        const res = await request(app)
            .patch(`/api/admin/businesses/${ownerA.businessId}/verification`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ decision: 'approve' });
        assert.equal(res.status, 409);
        assert.equal(res.body.error.details.current_status, 'active');
    });
    it('does not let the legacy force flag bypass the pending-only transition', async () => {
        const res = await request(app)
            .patch(`/api/admin/businesses/${ownerA.businessId}/verification`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ decision: 'approve', force: true });
        assert.equal(res.status, 409, JSON.stringify(res.body));
        assert.equal(res.body.error.details.current_status, 'active');
    });
    it('answers 404 for a business that does not exist', async () => {
        const res = await request(app)
            .patch('/api/admin/businesses/99999999/verification')
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ decision: 'approve' });
        assert.equal(res.status, 404);
    });
});
describe('PATCH /api/admin/businesses/:id/verification: reject', () => {
    it('accepts a rejection without a reason on the status endpoint', async () => {
        const businessId = await requestBusiness('Verify Rejection Without Reason', {});
        const res = await request(app)
            .patch(`/api/admin/businesses/${businessId}/status`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ status: 'rejected' });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.rejection_reason, null);
        assert.equal(res.body.email.sent, false, 'SMTP is intentionally optional in tests');
        const row = await businessRow(businessId);
        assert.equal(String(row['reviewed_by']), String(admin.id));
        assert.ok(row['reviewed_at']);
    });
    it('keeps the business hidden and hands the reason to its owner', async () => {
        const decision = await request(app)
            .patch(`/api/admin/businesses/${ownerB.businessId}/verification`)
            .set('Authorization', `Bearer ${admin.token}`)
            .send({ decision: 'reject', reason: 'The description does not say what the business sells.' });
        assert.equal(decision.status, 200, JSON.stringify(decision.body));
        assert.equal(decision.body.data.status, 'rejected');
        assert.equal(decision.body.data.verification_status, 'rejected');
        assert.equal(decision.body.data.is_verified, false, 'the CHECK constraint forbids a verified flag here');
        assert.equal(decision.body.data.verified_at, null);
        const list = await request(app).get('/api/businesses?limit=50');
        assert.ok(!list.body.data.some((b) => b.business_id === String(ownerB.businessId)), 'a rejected business must not be listed');
        assert.equal((await request(app).get(`/api/businesses/${ownerB.businessId}`)).status, 404);
        const staff = await request(app)
            .get(`/api/business/${ownerB.businessId}`)
            .set('Authorization', `Bearer ${ownerB.token}`);
        assert.equal(staff.status, 200);
        assert.equal(staff.body.data.status, 'rejected');
        assert.equal(staff.body.data.rejection_reason, 'The description does not say what the business sells.', 'the owner has to be able to read why');
    });
    it('leaves the row consistent with businesses_verified_flag_consistent', async () => {
        const row = await businessRow(ownerB.businessId);
        assert.equal(row['is_verified'], false);
        assert.equal(row['verified_at'], null);
        assert.equal(row['verification_status'], 'rejected');
        assert.notEqual(row['status'], 'active');
    });
    it('drops out of the active filter and into the rejected one', async () => {
        const rejected = await request(app)
            .get('/api/admin/businesses?status=rejected')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.ok(rejected.body.data.some((b) => b.business_id === String(ownerB.businessId)));
    });
});
/** Registers a business for the anonymous actor and returns its id. */
async function requestBusiness(name, body) {
    const res = await registerBusiness(anonymousOwner.token, { businessName: name, ...body });
    assert.equal(res.status, 201, `registration of ${name} failed: ${JSON.stringify(res.body)}`);
    return Number(res.body.data.business_id);
}
describe('platform administrator revocation', () => {
    it('revokes admin access and tenant RLS context for an existing token', async () => {
        const allowed = await request(app)
            .get('/api/admin/businesses')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(allowed.status, 200);
        await adminPool.query(`DELETE FROM user_platform_roles upr
              USING roles r
              WHERE upr.role_id = r.role_id
                AND upr.user_id = $1
                AND r.role_key = 'platform_admin'
                AND r.scope = 'platform'`, [admin.id]);
        const deniedAdminRoute = await request(app)
            .get('/api/admin/businesses')
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(deniedAdminRoute.status, 403);
        const deniedTenantRoute = await request(app)
            .get(`/api/business/${ownerA.businessId}`)
            .set('Authorization', `Bearer ${admin.token}`);
        assert.equal(deniedTenantRoute.status, 403, 'revoked admin must not pass the database membership/RLS check');
    });
});
//# sourceMappingURL=verification.test.js.map