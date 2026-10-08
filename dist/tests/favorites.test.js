process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
let app;
let adminPool;
let closePools;
let businessId;
let firstToken;
let secondToken;
before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
    const { rows: users } = await adminPool.query(`INSERT INTO users (email, password_hash, full_name, status)
         VALUES ('favorites-one@hq.test', 'unused', 'Favorites One', 'active'),
                ('favorites-two@hq.test', 'unused', 'Favorites Two', 'active')
         RETURNING user_id`);
    const [{ signAccessToken }, { rows: businesses }] = await Promise.all([
        import('../src/middleware/auth.js'),
        adminPool.query(`INSERT INTO businesses
                (business_name, business_slug, address, status, verification_status, is_verified, verified_at)
             VALUES ('Favorite Test Shop', 'favorite-test-shop', 'Test address', 'active', 'verified', TRUE, now())
             RETURNING business_id`),
    ]);
    firstToken = signAccessToken({ id: Number(users[0].user_id), email: 'favorites-one@hq.test', isPlatformAdmin: false });
    secondToken = signAccessToken({ id: Number(users[1].user_id), email: 'favorites-two@hq.test', isPlatformAdmin: false });
    businessId = businesses[0].business_id;
});
after(async () => {
    await closePools?.();
});
describe('account favorites', () => {
    it('requires authentication to list favorites', async () => {
        assert.equal((await request(app).get('/api/favorites')).status, 401);
    });
    it('saves and lists public businesses only for the signed-in account', async () => {
        const saved = await request(app)
            .put(`/api/favorites/${businessId}`)
            .set('Authorization', `Bearer ${firstToken}`);
        assert.equal(saved.status, 204);
        const own = await request(app)
            .get('/api/favorites')
            .set('Authorization', `Bearer ${firstToken}`);
        assert.equal(own.status, 200);
        assert.deepEqual(own.body.data.map((item) => item.business_id), [businessId]);
        const other = await request(app)
            .get('/api/favorites')
            .set('Authorization', `Bearer ${secondToken}`);
        assert.equal(other.status, 200);
        assert.deepEqual(other.body.data, []);
    });
    it('is idempotent and can remove a favorite', async () => {
        const headers = { Authorization: `Bearer ${firstToken}` };
        assert.equal((await request(app).put(`/api/favorites/${businessId}`).set(headers)).status, 204);
        assert.equal((await request(app).delete(`/api/favorites/${businessId}`).set(headers)).status, 204);
        const listed = await request(app).get('/api/favorites').set(headers);
        assert.deepEqual(listed.body.data, []);
    });
    it('does not save non-public or nonexistent businesses', async () => {
        const res = await request(app)
            .put('/api/favorites/99999999')
            .set('Authorization', `Bearer ${firstToken}`);
        assert.equal(res.status, 404);
    });
});
//# sourceMappingURL=favorites.test.js.map