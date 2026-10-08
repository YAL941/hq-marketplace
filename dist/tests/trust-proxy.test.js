/**
 * The reverse-proxy trust setting, and what it decides.
 *
 * `trust proxy` is easy to set and expensive to get wrong, so this file does not
 * test express. It tests the one thing that matters: whether the rate limiters
 * count clients or count the proxy. Behind Caddy with the setting absent, every
 * request arrives as `127.0.0.1`, all visitors share a single counter, and one
 * abusive client can exhaust the budget everyone else is spending — including
 * the ten sign-in attempts that lock the whole site out.
 *
 * How the behaviour is observed: express-rate-limit is configured with
 * `standardHeaders: 'draft-7'`, so every response carries a `RateLimit` header
 * with the budget left for the key that served it. Two requests from the same
 * client must lower it; a request from a different client must start from the
 * top again. With the header ignored, there is only one key and the count only
 * ever goes down.
 *
 * The limiter store is process-wide and outlives `createApp()`. That needs no
 * reset here: the trusted case keys on distinct forwarded addresses, so each
 * starts from its own fresh budget, and the untrusted case compares two
 * consecutive requests against a shared one, which holds whatever the count was
 * beforehand.
 *
 * `X-Forwarded-For` values come from the documentation ranges and never leave
 * the machine: these are supertest requests against the app object in memory.
 */
process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';
import assertModule from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import request from 'supertest';
const assert = assertModule;
/** The unauthenticated directory route, which is the one on the `public` limiter. */
const DIRECTORY = '/api/businesses';
let createApp;
let adminPool;
let closePools;
/**
 * The budget left for the key that served this response.
 *
 * draft-7 sends one combined header, `RateLimit: limit=…, remaining=…, reset=…`,
 * rather than the separate `RateLimit-Remaining` of the older drafts.
 */
function remaining(res) {
    const combined = res.headers['ratelimit'];
    assert.ok(typeof combined === 'string' && combined.length > 0, `no RateLimit header, so no limiter ran: ${JSON.stringify(res.headers)}`);
    const match = /remaining=(\d+)/.exec(combined);
    assert.ok(match, `RateLimit header without a remaining budget: ${combined}`);
    return Number(match[1]);
}
function get(app, forwardedFor) {
    return request(app).get(DIRECTORY).set('X-Forwarded-For', forwardedFor);
}
before(async () => {
    createApp = (await import('../src/app.js')).createApp;
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});
describe('trust proxy: what the rate limiter counts', () => {
    it('counts each forwarded client separately when the proxy is trusted', async () => {
        const app = createApp({ trustProxyHops: 1 });
        const first = await get(app, '203.0.113.10');
        assert.equal(first.status, 200, `directory read failed: ${JSON.stringify(first.body)}`);
        const same = await get(app, '203.0.113.10');
        const other = await get(app, '203.0.113.11');
        // Same forwarded address, so the same bucket, so one less left.
        assert.equal(remaining(same), remaining(first) - 1, 'two requests from one client must share one counter');
        // A different forwarded address is a different bucket, untouched by the
        // two requests above, so it has the budget a first request gets.
        assert.equal(remaining(other), remaining(first), 'a different client must not spend the previous client\'s budget');
    });
    it('ignores X-Forwarded-For when the proxy is not trusted', async () => {
        const app = createApp({ trustProxyHops: 0 });
        const first = await get(app, '203.0.113.20');
        assert.equal(first.status, 200, `directory read failed: ${JSON.stringify(first.body)}`);
        const other = await get(app, '203.0.113.21');
        // Both requests are the proxy as far as express is concerned, so there
        // is one bucket and the second lowers it whatever the header claimed.
        // This is precisely the failure the setting exists to prevent.
        assert.equal(remaining(other), remaining(first) - 1, 'an untrusted header must not buy a caller a fresh budget');
    });
    it('mounts the limiter on the public directory route', async () => {
        // The two cases above both read the header, so this is belt and braces:
        // it names the route under test, so a limiter accidentally moved off
        // `/api/businesses` shows up as a missing header rather than as a
        // passing assertion about two unrelated numbers.
        const app = createApp({ trustProxyHops: 1 });
        const res = await get(app, '203.0.113.30');
        assert.equal(res.status, 200);
        assert.ok(res.headers['ratelimit-policy'], 'the public limiter is not applied to /api/businesses');
    });
    it('defaults to trusting no proxy outside production', async () => {
        const { config } = await import('../src/config.js');
        assert.equal(config.NODE_ENV, 'test');
        assert.equal(config.trustProxyHops, 0, 'the test environment must not trust a proxy');
    });
    it('applies the resolved configuration when no override is passed', async () => {
        const app = createApp();
        assert.equal(app.get('trust proxy'), 0, 'createApp() should apply TRUST_PROXY_HOPS');
    });
});
//# sourceMappingURL=trust-proxy.test.js.map