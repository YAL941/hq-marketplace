/**
 * The route index, and which health endpoint to use.
 *
 * Two separate decisions, tested together because they are the same decision
 * about the same thing: what a deployed instance tells the outside world about
 * itself.
 *
 * The index (`GET /api`) returns a complete map of every endpoint, its auth
 * level, and which header belongs to which role. That is genuinely useful in
 * development and it is an inventory for an attacker in production — so it is
 * 404 there. Not 403: pretending the route exists in order to deny it is what
 * turns a probe into a discovery, and there is no authorisation decision to make
 * because there is nothing to authorise.
 *
 * The three health endpoints are not interchangeable, and conflating them is how
 * a database outage becomes a fleet-wide restart loop. Which one to point at what
 * is asserted below, so the answer does not depend on this file being read.
 */

process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';

const assert: typeof assertModule = assertModule;

type App = import('express').Express;
type CreateApp = typeof import('../src/app.js').createApp;
type CreateAppOptions = Parameters<CreateApp>[0];

let createApp: CreateApp;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;
let config: typeof import('../src/config.js').config;

before(async () => {
    createApp = (await import('../src/app.js')).createApp;
    ({ config } = await import('../src/config.js'));

    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;

    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});

after(async () => {
    await closePools();
});

/**
 * The index is gated on `config.isProduction`, which is fixed for the process.
 * The suite runs in `NODE_ENV=test`, so a production app cannot be built here
 * without either a second process or a way to say "treat this app as production".
 *
 * The seam below is the second option, and it exists for the same reason as
 * `trustProxyHops` on `createApp`: the decision under test is "does the app serve
 * an index when it thinks it is in production", which is only observable if the
 * app can be told what to think.
 */
function buildApp(overrides: { production?: boolean } = {}): App {
    const options: CreateAppOptions = {};
    if (overrides.production) {
        // The gate reads `config.isProduction`. Rather than reload the config
        // module — which is cached per process and shared with every other test
        // file — the app is given the one fact it branches on.
        const original = config.isProduction;
        (config as { isProduction: boolean }).isProduction = true;
        try {
            return createApp(options);
        } finally {
            (config as { isProduction: boolean }).isProduction = original;
        }
    }
    return createApp(options);
}

describe('the route index, GET /api', () => {
    it('lists the endpoints in development', async () => {
        const res = await request(buildApp()).get('/api');

        assert.equal(res.status, 200);
        assert.equal(res.body.service, 'OmniHQ');
        assert.ok(Array.isArray(res.body.public), 'the index should group routes by auth level');
        assert.ok(res.body.public.length > 0);
    });

    it('is a 404 in production', async () => {
        const res = await request(buildApp({ production: true })).get('/api');

        assert.equal(res.status, 404, 'the route index must not be served in production');
    });

    it('leaks no route information when it is hidden', async () => {
        // The point of a 404 rather than a refusal: the body has to be the same
        // body as any other unknown route, so it cannot be used to confirm what
        // exists.
        const res = await request(buildApp({ production: true })).get('/api');
        const body = JSON.stringify(res.body);

        // The project's own 404 envelope, not a bespoke one for this route.
        assert.deepEqual(res.body, {
            error: { code: 'NOT_FOUND', message: 'Route not found' },
        }, `unexpected 404 body: ${body}`);

        for (const fragment of ['platformAdmin', 'businessStaff', '/api/admin', 'OmniHQ']) {
            assert.ok(!body.includes(fragment), `the hidden index leaked "${fragment}": ${body}`);
        }
    });

    it('is indistinguishable from any other unknown route', async () => {
        const production = buildApp({ production: true });
        const index = await request(production).get('/api');
        const nonsense = await request(production).get('/api/definitely-not-a-route');

        assert.equal(index.status, nonsense.status);
        assert.deepEqual(index.body, nonsense.body);
    });

    it('does not stop the real routes behind it from working', async () => {
        // The gate is on one handler, not on the mount: hiding the index must not
        // hide the API it describes.
        const res = await request(buildApp({ production: true })).get('/api/businesses');
        assert.equal(res.status, 200);
    });
});

describe('the root response', () => {
    it('advertises the index as unavailable in production', async () => {
        const res = await request(buildApp({ production: true })).get('/');

        assert.equal(res.status, 200);
        assert.equal(res.body.index, null, 'the index should be reported as absent, not omitted');
    });

    it('advertises the index in development', async () => {
        const res = await request(buildApp()).get('/');
        assert.equal(res.body.index, '/api');
    });

    it('lists the health endpoints, because that is where a client looks for one', async () => {
        const res = await request(buildApp()).get('/');

        assert.equal(res.body.health, '/health');
        assert.equal(res.body.liveness, '/healthz');
        assert.equal(res.body.readiness, '/readyz');
    });
});

describe('the health endpoints', () => {
    it('keeps /health, in every environment', async () => {
        // Unconditional on purpose. Removing an endpoint a monitor already polls
        // is how an existing uptime check starts reporting a false outage, and a
        // monitor cannot be updated in the same minute as a deploy.
        for (const app of [buildApp(), buildApp({ production: true })]) {
            const res = await request(app).get('/health');
            assert.equal(res.status, 200, '/health must exist in every environment');
            assert.equal(res.body.status, 'ok');
        }
    });

    it('keeps /healthz and /readyz alongside it', async () => {
        const app = buildApp();

        assert.equal((await request(app).get('/healthz')).status, 200);
        assert.equal((await request(app).get('/readyz')).status, 200);
    });

    it('answers all three on the same instance, so any of them can be used', async () => {
        // The practical question: if a monitoring system is pointed at whichever
        // of the three it finds first, does it get a working endpoint? Yes.
        const app = buildApp({ production: true });

        for (const path of ['/health', '/healthz', '/readyz']) {
            const res = await request(app).get(path);
            assert.equal(res.status, 200, `${path} should answer 200 on a healthy instance`);
        }
    });

    it('keeps /health free of the database, like /healthz', async () => {
        // The same property that stops a restart loop. A monitor polling /health
        // must not see a failure because the database is down.
        const poolModule = await import('../src/db/pool.js');
        const original = poolModule.appPool;
        const originalQuery = original.query.bind(original);
        original.query = (() => Promise.reject(new Error('simulated outage'))) as typeof original.query;

        try {
            const res = await request(buildApp()).get('/health');
            assert.equal(res.status, 200, '/health must not depend on the database');
        } finally {
            original.query = originalQuery;
        }
    });

    it('does not rate limit any of them', async () => {
        const app = buildApp();
        for (const path of ['/health', '/healthz', '/readyz']) {
            const res = await request(app).get(path);
            assert.equal(res.headers['ratelimit'], undefined, `${path} was counted by a limiter`);
        }
    });
});

describe('the suite is not accidentally running as production', () => {
    it('confirms the fixture assumption the 404 case rests on', async () => {
        // If this ever fails, every "in production" assertion above is vacuous.
        assert.equal(config.NODE_ENV, 'test');
        assert.equal(config.isProduction, false);
    });
});