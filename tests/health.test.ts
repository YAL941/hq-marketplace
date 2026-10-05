/**
 * Liveness and readiness.
 *
 * The distinction these two endpoints exist to make is the whole point of the
 * file, and it is easy to get backwards: if liveness depends on the database, a
 * database outage makes every orchestrator restart every API process at once,
 * which discards warm connections and turns a recoverable dependency problem
 * into a fleet-wide crash loop. So `/healthz` must stay true while the database
 * is down, and `/readyz` must be the one that goes false.
 *
 * The second property worth pinning down is that neither endpoint may leak the
 * database's error text. Probe output is the one thing guaranteed to be
 * collected by something other than the operator — a dashboard, an aggregator,
 * a log pipeline — and connection failures carry host names, ports and
 * occasionally credentials.
 */

process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import request from 'supertest';

const assert: typeof assertModule = assertModule;

type App = import('express').Express;
type CreateApp = typeof import('../src/app.js').createApp;
type CheckReadiness = typeof import('../src/modules/health/health.routes.js').checkReadiness;

let createApp: CreateApp;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;
let checkReadiness: CheckReadiness;
let app: App;

before(async () => {
    createApp = (await import('../src/app.js')).createApp;
    checkReadiness = (await import('../src/modules/health/health.routes.js')).checkReadiness;

    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;

    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    app = createApp();
});

describe('liveness: GET /healthz', () => {
    it('answers while the database is reachable', async () => {
        const res = await request(app).get('/healthz');

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
        assert.equal(res.body.service, 'hq-marketplace');
    });

    it('reports nothing about the database', async () => {
        // Structural, not incidental: a `checks` array here would be the first
        // step towards the dependency creep that turns liveness into readiness.
        const res = await request(app).get('/healthz');

        assert.deepEqual(Object.keys(res.body).sort(), ['service', 'status']);
    });

    it('answers without needing a working application connection', async () => {
        // This is the property that prevents the crash loop. The application
        // pool is emptied and replaced with one that cannot connect, which is
        // what a database outage looks like from inside the process.
        const poolModule = await import('../src/db/pool.js');
        const original = poolModule.appPool;

        // `appPool` is read through the module binding when the route runs, so
        // the outage is simulated by pointing the pool's own query at a dead
        // target rather than by swapping the object out from under the router.
        const originalQuery = original.query.bind(original);
        original.query = (() => Promise.reject(new Error('simulated database outage'))) as typeof original.query;

        try {
            const res = await request(app).get('/healthz');
            assert.equal(res.status, 200, 'liveness must stay true while the database is down');
            assert.equal(res.body.status, 'ok');
        } finally {
            original.query = originalQuery;
        }
    });

    it('needs no authentication', async () => {
        const res = await request(app).get('/healthz');
        assert.equal(res.status, 200);
        assert.equal(res.headers['www-authenticate'], undefined);
    });
});

describe('readiness: GET /readyz', () => {
    it('answers ready while the database is reachable', async () => {
        const res = await request(app).get('/readyz');

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
        assert.deepEqual(res.body.checks, [{ name: 'database', ok: true }]);
    });

    it('answers 503, not 500, when the database is unreachable', async () => {
        // `503 Service Unavailable` is what a load balancer and an orchestrator
        // both already know how to act on. A `500` reads as a bug in this API.
        const poolModule = await import('../src/db/pool.js');
        const original = poolModule.appPool;
        const originalQuery = original.query.bind(original);
        original.query = (() => Promise.reject(new Error('simulated database outage'))) as typeof original.query;

        try {
            const res = await request(app).get('/readyz');

            assert.equal(res.status, 503);
            assert.equal(res.body.status, 'unavailable');
            assert.deepEqual(res.body.checks, [{ name: 'database', ok: false }]);
        } finally {
            original.query = originalQuery;
        }
    });

    it('does not leak the driver error', async () => {
        const poolModule = await import('../src/db/pool.js');
        const original = poolModule.appPool;
        const originalQuery = original.query.bind(original);
        original.query = (() =>
            Promise.reject(new Error('connect ECONNREFUSED 10.0.7.31:5432 password=hunter2'))) as typeof original.query;

        try {
            const res = await request(app).get('/readyz');
            const body = JSON.stringify(res.body);

            assert.ok(!body.includes('hunter2'), `the password appeared in the response: ${body}`);
            assert.ok(!body.includes('10.0.7.31'), `the host appeared in the response: ${body}`);
            assert.ok(!body.includes('ECONNREFUSED'), `the driver error appeared in the response: ${body}`);
            assert.match(body, /database/, 'the failing dependency should still be named');
        } finally {
            original.query = originalQuery;
        }
    });

    it('is not subject to a rate limiter', async () => {
        // Probes run every few seconds from every instance. If they spent the
        // same budget as users, they would be part of the load they exist to
        // detect — and a probe that gets a `429` reads as "unhealthy" to
        // whatever is polling it.
        const responses = await Promise.all(
            Array.from({ length: 25 }, () => request(app).get('/readyz')),
        );

        for (const res of responses) {
            assert.equal(res.status, 200, 'a probe must not be rate limited');
            assert.equal(res.headers['ratelimit'], undefined, 'no limiter should have counted a probe');
        }
    });
});

describe('readiness: the timeout that keeps it useful', () => {
    it('gives up on a query that never answers', async () => {
        // `pg` has no statement timeout by default, so a connection to a host
        // that stopped responding leaves the promise pending for minutes. An
        // unbounded probe is worse than no probe: the caller's own timeout
        // fires first and it concludes the process is dead rather than unready.
        const poolModule = await import('../src/db/pool.js');
        const original = poolModule.appPool;
        const originalQuery = original.query.bind(original);

        // Never resolves, and never rejects: the case a timeout has to cover.
        original.query = (() => new Promise(() => {})) as typeof original.query;

        try {
            const startedAt = Date.now();
            const report = await checkReadiness();
            const elapsed = Date.now() - startedAt;

            assert.equal(report.ready, false);
            assert.ok(
                elapsed < 10_000,
                `readiness waited ${elapsed}ms for a query that never answers`,
            );
        } finally {
            original.query = originalQuery;
        }
    });

    it('is quick enough to sit inside a caller timeout', async () => {
        // The route budget is 2s, which has to fit inside the 5s an AWS ALB
        // health check waits before deciding the target is unhealthy.
        const poolModule = await import('../src/db/pool.js');
        const original = poolModule.appPool;
        const originalQuery = original.query.bind(original);
        original.query = (() => new Promise(() => {})) as typeof original.query;

        try {
            const startedAt = Date.now();
            await request(app).get('/readyz');
            const elapsed = Date.now() - startedAt;

            assert.ok(elapsed < 5_000, `GET /readyz took ${elapsed}ms with a hung database`);
        } finally {
            original.query = originalQuery;
        }
    });
});

describe('the previous health endpoint', () => {
    it('still answers, for the deployment already using it', async () => {
        const res = await request(app).get('/health');

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
    });

    it('is advertised alongside the new endpoints', async () => {
        const res = await request(app).get('/');

        assert.equal(res.body.liveness, '/healthz');
        assert.equal(res.body.readiness, '/readyz');
    });
});