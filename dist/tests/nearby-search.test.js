/**
 * Nearby-business search, tested against the real database.
 *
 * The scenarios this file pins down:
 *
 *   * ordering: a nearer branch outranks a farther one, and the distance
 *     in the response matches the haversine expectation closely enough
 *     to prove the right formula ran;
 *   * radius: a branch outside radiusKm is excluded even though the
 *     city matches, because the box is a prefilter, not the filter;
 *   * multi-branch: a business with several branches is listed once, at
 *     its closest branch — never averaged, never duplicated;
 *   * visibility: a pending business with a perfectly placed branch is
 *     invisible to the public query, which is the RLS promise restated
 *     for the geo path;
 *   * validation: out-of-range lat/lng, an oversized radius and an
 *     unknown parameter all answer 400, not 500.
 */
process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';
import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
const assert = assertModule;
let createApp;
let adminPool;
let closePools;
before(async () => {
    createApp = (await import('../src/app.js')).createApp;
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});
after(async () => {
    await closePools();
});
/** Creates a business with one branch, via the admin connection. */
async function seedBusiness(name, status, lat, lng) {
    const { rows } = await adminPool.query(`INSERT INTO businesses
            (business_name, business_slug, status, is_verified, verification_status, verified_at, phone)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() ELSE NULL END, '+252600000000')
         RETURNING business_id`, [
        name,
        name.toLowerCase().replace(/\s+/g, '-'),
        status,
        status === 'active',
        status === 'active' ? 'verified' : 'pending',
        status === 'active',
    ]);
    const businessId = Number(rows[0].business_id);
    await adminPool.query(`INSERT INTO business_locations (business_id, location_name, latitude, longitude, city)
         VALUES ($1, $2, $3, $4, 'Mogadishu')`, [businessId, `${name} HQ`, lat, lng]);
    return businessId;
}
async function deleteBusinesses(businessIds) {
    await adminPool.query('DELETE FROM business_locations WHERE business_id = ANY($1::bigint[])', [businessIds]);
    await adminPool.query('DELETE FROM businesses WHERE business_id = ANY($1::bigint[])', [businessIds]);
}
describe('GET /api/businesses/nearby', () => {
    it('orders businesses by distance and reports the distance in km', async () => {
        // ~0.11 km apart per 0.001 degree of latitude.
        const nearId = await seedBusiness('Near Shop', 'active', 2.04, 45.34);
        const farId = await seedBusiness('Far Shop', 'active', 2.14, 45.34);
        try {
            const res = await request(createApp()).get('/api/businesses/nearby?lat=2.04&lng=45.34&radiusKm=30');
            assert.equal(res.status, 200);
            assert.ok(Array.isArray(res.body.data));
            assert.equal(res.body.data.length, 2, 'both shops are inside the radius');
            assert.equal(Number(res.body.data[0].business_id), nearId, 'the nearer shop is first');
            assert.equal(Number(res.body.data[1].business_id), farId, 'the farther shop is second');
            // ~11.06 km between 2.04 and 2.14 latitude. Allow 2% for the
            // mean-earth-radius rounding.
            assert.ok(res.body.data[1].distance_km > 10.5 && res.body.data[1].distance_km < 11.5);
            assert.equal(res.body.meta.radiusKm, 30);
        }
        finally {
            await deleteBusinesses([nearId, farId]);
        }
    });
    it('excludes branches outside the radius even when the city matches', async () => {
        const id = await seedBusiness('Distant Tailor', 'active', 3.00, 45.34);
        try {
            const res = await request(createApp()).get('/api/businesses/nearby?lat=2.04&lng=45.34&radiusKm=5');
            assert.equal(res.status, 200);
            assert.equal(res.body.data.length, 0, 'a branch 100+ km away must not be returned');
            assert.equal(res.body.meta.total, 0);
        }
        finally {
            await deleteBusinesses([id]);
        }
    });
    it('lists a multi-branch business once, at its closest branch', async () => {
        const nearId = await seedBusiness('Franchise Bakery', 'active', 2.05, 45.35);
        await adminPool.query(`INSERT INTO business_locations (business_id, location_name, latitude, longitude, city)
             VALUES ($1, 'Far Branch', 2.20, 45.35, 'Mogadishu')`, [nearId]);
        try {
            const res = await request(createApp()).get('/api/businesses/nearby?lat=2.04&lng=45.34&radiusKm=30');
            assert.equal(res.status, 200);
            const mine = res.body.data.filter((r) => Number(r.business_id) === nearId);
            assert.equal(mine.length, 1, 'a multi-branch business appears exactly once');
            // Closest branch is ~1.6 km away (0.01 lat + 0.01 lng); the far
            // branch would be ~18 km. Anything above 5 km means the wrong
            // branch won the MIN.
            assert.ok(mine[0].distance_km < 5, `closest branch must win, got ${mine[0].distance_km} km`);
        }
        finally {
            await deleteBusinesses([nearId]);
        }
    });
    it('hides non-public businesses even with a perfectly placed branch', async () => {
        const pendingId = await seedBusiness('Unapproved Vendor', 'pending', 2.04, 45.34);
        try {
            const res = await request(createApp()).get('/api/businesses/nearby?lat=2.04&lng=45.34&radiusKm=5');
            assert.equal(res.status, 200);
            const found = res.body.data.some((r) => r.business_id === pendingId);
            assert.equal(found, false, 'a pending business must never appear in the public search');
        }
        finally {
            await deleteBusinesses([pendingId]);
        }
    });
    it('rejects bad input with 400, never 500', async () => {
        const app = createApp();
        const outOfRange = await request(app).get('/api/businesses/nearby?lat=91&lng=45.34');
        assert.equal(outOfRange.status, 400);
        const hugeRadius = await request(app).get('/api/businesses/nearby?lat=2.04&lng=45.34&radiusKm=5000');
        assert.equal(hugeRadius.status, 400);
        const unknownParam = await request(app).get('/api/businesses/nearby?lat=2.04&lng=45.34&hax=1');
        assert.equal(unknownParam.status, 400, 'a strict schema rejects unknown query parameters');
        const missingAll = await request(app).get('/api/businesses/nearby');
        assert.equal(missingAll.status, 400);
    });
});
//# sourceMappingURL=nearby-search.test.js.map