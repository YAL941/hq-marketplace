/**
 * Liveness and readiness.
 *
 * These are two different questions and answering them with one endpoint is how
 * an outage becomes a restart loop:
 *
 *   * `/healthz` — is this process able to serve HTTP at all? It checks nothing
 *     outside itself. It must not depend on the database, because a database
 *     outage is not a reason to restart every API process: doing that throws
 *     away warm connections and turns a recoverable dependency problem into a
 *     crash loop across the whole fleet.
 *
 *   * `/readyz` — can this process actually serve requests right now? It runs a
 *     trivial query on the *application* connection, so it answers for the
 *     database the API really uses rather than for the admin one. When it says
 *     no, a load balancer stops sending traffic here while the process stays up
 *     and can report why.
 *
 * Neither response contains anything from the database driver. Connection
 * failures carry host names, ports and occasionally credentials, and a probe
 * endpoint is the one place whose output is guaranteed to be collected by
 * something other than the operator — a dashboard, an aggregator, a log
 * pipeline. The failing dependency is named; the failure's contents are not.
 */
import { Router } from 'express';
import { appPool } from '../../db/pool.js';
/**
 * How long readiness waits for the database before answering `no`.
 *
 * Bounded because the caller is usually a load balancer with its own timeout,
 * and one that is longer than the caller's means the caller times out first and
 * concludes the process is dead rather than unready. The query itself is
 * `SELECT 1`, so anything slower than this is the connection, not the work.
 */
const READINESS_TIMEOUT_MS = 2_000;
/**
 * Runs `probe`, giving up after `READINESS_TIMEOUT_MS`.
 *
 * A hung query is the failure mode worth guarding: `pg` has no statement
 * timeout by default, so a connection to a host that has stopped answering
 * leaves the promise pending until the operating system gives up — which can be
 * minutes. An unbounded readiness probe is worse than no probe, because it takes
 * the caller down with it.
 */
async function withTimeout(probe, ms) {
    let timer;
    try {
        return await Promise.race([
            probe,
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('readiness probe timed out')), ms);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/**
 * Asks the application database whether it will answer.
 *
 * Uses `appPool` rather than `adminPool` on purpose: readiness has to reflect
 * the connection that serves real traffic, and the two are deliberately
 * different roles. A healthy admin connection proves nothing about the one that
 * carries the requests.
 */
export async function checkReadiness() {
    let databaseOk = false;
    try {
        await withTimeout(appPool.query('SELECT 1'), READINESS_TIMEOUT_MS);
        databaseOk = true;
    }
    catch {
        // Swallowed on purpose: the caller reports the check by name, and the
        // reason is not reported at all. See the note at the top of the file.
        databaseOk = false;
    }
    return { ready: databaseOk, checks: [{ name: 'database', ok: databaseOk }] };
}
export function healthRoutes() {
    const router = Router();
    /**
     * Liveness. Deliberately synchronous and dependency-free.
     *
     * If this ever answers `no`, the right response is to restart the process —
     * so the only thing it may report is whether the process itself is running.
     */
    router.get('/healthz', (_req, res) => {
        res.status(200).json({ status: 'ok', service: 'hq-marketplace' });
    });
    /**
     * Readiness. `503` rather than `500` on purpose: `503 Service Unavailable`
     * is the status a load balancer and an orchestrator both already know how to
     * act on, and it is not an error in the request.
     */
    router.get('/readyz', async (_req, res) => {
        const report = await checkReadiness();
        res.status(report.ready ? 200 : 503).json({
            status: report.ready ? 'ok' : 'unavailable',
            service: 'hq-marketplace',
            checks: report.checks,
        });
    });
    return router;
}
//# sourceMappingURL=health.routes.js.map