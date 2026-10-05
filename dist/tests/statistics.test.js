/**
 * Regression tests for the business statistics layer.
 *
 * Why this file exists: refresh_business_statistics() was declared in
 * migration 003 without SECURITY DEFINER, so every call from a business
 * owner failed with
 *     new row violates row-level security policy for table "business_statistics"
 * and no test covered it. Migration 006 fixed the function; these tests
 * exist so the defect cannot come back unnoticed.
 *
 * The hardening in 006 is covered too: refreshing EVERY business must stay
 * restricted to platform admins.
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
let adminUser;
async function createUser(email, fullName) {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const { rows } = await adminPool.query(`INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active') RETURNING user_id`, [email, passwordHash, fullName]);
    return Number(rows[0].user_id);
}
async function createBusiness(name, slug, ownerId) {
    const { rows } = await adminPool.query(`INSERT INTO businesses
            (business_name, business_slug, phone, city, district, status,
             verification_status, is_verified, verified_at)
         VALUES ($1, $2, '+9630000001', 'Damascus', 'Central', 'active',
                 'verified', TRUE, now())
         RETURNING business_id`, [name, slug]);
    const businessId = Number(rows[0].business_id);
    const { rows: roleRows } = await adminPool.query(`SELECT role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business'`);
    await adminPool.query(`INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`, [businessId, ownerId, roleRows[0].role_id]);
    return businessId;
}
async function login(email) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    if (res.status !== 200)
        throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.data.token;
}
/** Runs fn inside a transaction carrying the RLS context of the given user. */
async function asUser(userId, isAdmin, fn) {
    const { appPool } = await import('../src/db/pool.js');
    const client = await appPool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(userId)]);
        await client.query(`SELECT set_config('app.is_platform_admin', $1, true)`, [String(isAdmin)]);
        const result = await fn(client);
        await client.query('ROLLBACK');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    // migrate + grants + truncate, serialised across test processes
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
    const ownerAId = await createUser('stats-owner-a@hq.test', 'Stats Owner A');
    const ownerBId = await createUser('stats-owner-b@hq.test', 'Stats Owner B');
    const adminId = await createUser('stats-admin@hq.test', 'Stats Admin');
    const { rows: adminRole } = await adminPool.query(`SELECT role_id FROM roles WHERE role_key = 'platform_admin' AND scope = 'platform'`);
    await adminPool.query(`INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2)`, [adminId, adminRole[0].role_id]);
    const businessA = await createBusiness('Stats Clinic', 'stats-clinic', ownerAId);
    const businessB = await createBusiness('Stats Grill', 'stats-grill', ownerBId);
    // give business A a real order and review so its numbers are non-zero
    const customerId = await createUser('stats-customer@hq.test', 'Stats Customer');
    await adminPool.query(`INSERT INTO products (business_id, product_name, price, status)
         VALUES ($1, 'Stats Product', 25, 'active')`, [businessA]);
    await adminPool.query(`INSERT INTO orders (business_id, customer_id, order_status, subtotal, total_amount, completed_at)
         VALUES ($1, $2, 'completed', 25, 25, now())`, [businessA, customerId]);
    await adminPool.query(`INSERT INTO reviews (business_id, user_id, rating, review_text, status)
         VALUES ($1, $2, 5, 'Great clinic', 'published')`, [businessA, customerId]);
    ownerA = { id: ownerAId, token: '', businessA };
    ownerB = { id: ownerBId, token: '', businessB };
    adminUser = { id: adminId, token: '' };
    ownerA.token = await login('stats-owner-a@hq.test');
    ownerB.token = await login('stats-owner-b@hq.test');
    adminUser.token = await login('stats-admin@hq.test');
});
after(async () => {
    await closePools?.();
});
describe('Statistics: regression for the SECURITY DEFINER defect', () => {
    it('a business owner can read the statistics of their own business', async () => {
        // This is the exact call that returned
        // "new row violates row-level security policy" before migration 006.
        const res = await request(app)
            .get(`/api/business/${ownerA.businessA}/statistics`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        const stats = res.body.data;
        assert.equal(stats.business_id, String(ownerA.businessA));
        assert.equal(stats.total_orders, 1);
        assert.equal(stats.completed_orders, 1);
        assert.equal(stats.total_reviews, 1);
        assert.equal(stats.total_customers, 1);
        assert.equal(Number(stats.average_rating), 5);
        assert.equal(Number(stats.total_revenue), 25);
    });
    it('a business owner cannot read the statistics of another business', async () => {
        const res = await request(app)
            .get(`/api/business/${ownerB.businessB}/statistics`)
            .set('Authorization', `Bearer ${ownerA.token}`);
        assert.equal(res.status, 403);
    });
    it('a business owner cannot refresh every business at once', async () => {
        // The hardening added in 006: p_business_id = NULL means "all",
        // and must require platform authority even though the function now
        // runs with elevated rights.
        await assert.rejects(asUser(ownerA.id, false, (client) => client.query('SELECT refresh_business_statistics()')), /only a platform admin may refresh all businesses/);
    });
    it('a business owner may refresh only their own business', async () => {
        const result = await asUser(ownerA.id, false, (client) => client.query('SELECT refresh_business_statistics($1)', [ownerA.businessA]));
        assert.equal(Number(result.rows[0].refresh_business_statistics), 1);
    });
    it('a business owner may not refresh a business they do not belong to', async () => {
        await assert.rejects(asUser(ownerA.id, false, (client) => client.query('SELECT refresh_business_statistics($1)', [ownerB.businessB])), /not allowed to refresh statistics of business/);
    });
    it('a platform admin can refresh every business at once', async () => {
        const result = await asUser(adminUser.id, true, (client) => client.query('SELECT refresh_business_statistics()'));
        const count = Number(result.rows[0].refresh_business_statistics);
        assert.ok(count >= 2, `expected every business to be refreshed, got ${count}`);
    });
    it('the statistics cache of business B holds only business B rows', async () => {
        await asUser(ownerB.id, false, (client) => client.query('SELECT refresh_business_statistics($1)', [ownerB.businessB]));
        await asUser(ownerB.id, false, (client) => client.query('SELECT * FROM business_statistics WHERE business_id = $1', [ownerB.businessB]));
        // same cache table, queried with no WHERE as business A's owner
        const seen = await asUser(ownerA.id, false, (client) => client.query('SELECT business_id, total_orders FROM business_statistics'));
        const ids = seen.rows.map((r) => Number(r.business_id));
        assert.ok(!ids.includes(ownerB.businessB), 'business A must not see business B statistics');
    });
});
//# sourceMappingURL=statistics.test.js.map