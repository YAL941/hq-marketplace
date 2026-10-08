/**
 * Graceful shutdown.
 *
 * `server.close()` on its own is not a shutdown. It stops the listener from
 * accepting new connections, and then waits for every existing one to end — which
 * includes every idle keep-alive socket, because Node does not close those until
 * the server does. Under a rolling deploy that wait can outlast the
 * orchestrator's patience, and the result is `SIGKILL`: in-flight requests are
 * cut off mid-write, the pools are never closed, and any request in the middle
 * of a transaction is left to PostgreSQL's own timeout to resolve.
 *
 * The sequence below is therefore ordered by what each step buys:
 *
 *   1. `close()` — no new connections from here on.
 *   2. `closeIdleConnections()` — drop the keep-alives that are not mid-request.
 *      This is the step that makes the wait finite, and it is the one that is
 *      easy to leave out.
 *   3. wait for `close` to fire, bounded by `timeoutMs` — in-flight requests get
 *      to finish writing.
 *   4. on timeout, `closeAllConnections()` and exit non-zero — the exit code
 *      matters, because a process that had to be forced out should not report a
 *      clean stop to whatever is supervising it.
 *   5. `closePools()` — connections are released before the process goes, so
 *      PostgreSQL sees them back rather than waiting for its own TCP timeout.
 *
 * Everything the handler touches is injected, including `exit`. That is not
 * ceremony: a test cannot assert on `process.exit` without either killing the
 * test runner or monkey-patching a global, and the interesting cases here are
 * exactly the ones that end in the process exiting.
 */
/**
 * Ten seconds: long enough for a request that is already writing its response,
 * short enough to finish well inside the 30s `TimeoutStopSec` that systemd and
 * the 30s `terminationGracePeriodSeconds` that Kubernetes both default to.
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
/**
 * Installs the SIGINT and SIGTERM handlers.
 *
 * Also installs `uncaughtException` and `unhandledRejection` handlers, because
 * neither of them lets a process continue safely: an unhandled rejection in
 * Node 15 and later terminates the process anyway, and doing it here means the
 * shutdown is orderly and the reason is recorded. Without this, an error thrown
 * during a request skips `closePools()` entirely.
 *
 * A second signal stops waiting. This is the escape hatch every long-running
 * server needs: an operator who sends Ctrl-C twice means "now", and being unable
 * to say so leaves them with `kill -9` and the truncated writes that come with it.
 */
export function installShutdownHandlers(options) {
    const { server, closePools, timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS, log = (message) => console.log(message), warn = (message) => console.warn(message), exit = (code) => process.exit(code), target = process, } = options;
    let shuttingDown = false;
    let forcedTimer;
    const stopForcing = () => {
        if (forcedTimer) {
            clearTimeout(forcedTimer);
            forcedTimer = undefined;
        }
    };
    const shutdown = async (reason) => {
        if (shuttingDown) {
            // A second signal is not a second shutdown; it is the operator
            // overruling the wait. Cut the remaining requests and go.
            warn(`[hq] ${reason} received again, stopping immediately`);
            stopForcing();
            server.closeAllConnections?.();
            exit(1);
            return;
        }
        shuttingDown = true;
        log(`[hq] ${reason} received, shutting down`);
        const closed = new Promise((resolveClosed) => {
            server.close(() => resolveClosed());
        });
        // Free connections only, and only once the listener is closed: a
        // connection mid-request is exactly the one we still want to keep.
        server.closeIdleConnections?.();
        forcedTimer = setTimeout(() => {
            warn(`[hq] shutdown did not finish within ${timeoutMs}ms, `
                + 'closing connections that are still open');
            server.closeAllConnections?.();
            exit(1);
        }, timeoutMs);
        forcedTimer.unref();
        await closed;
        try {
            await closePools();
            stopForcing();
            log('[hq] shutdown complete');
            exit(0);
        }
        catch (error) {
            // A pool that will not close is worth reporting, but the process is
            // going either way and the exit code should say it was not clean.
            warn(`[hq] pools did not close cleanly: ${error instanceof Error ? error.message : String(error)}`);
            stopForcing();
            exit(1);
        }
    };
    const onSignal = (signal) => () => {
        void shutdown(signal);
    };
    const onFatal = (kind) => (error) => {
        // Recorded, not swallowed: the process is about to exit, and the reason
        // it exited is the only thing anyone will want to know afterwards.
        warn(`[hq] ${kind}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        void shutdown(kind);
    };
    const signals = ['SIGINT', 'SIGTERM'];
    const fatals = ['uncaughtException', 'unhandledRejection'];
    /**
     * The exact listener references that were registered.
     *
     * Kept because `off()` matches on identity: passing it a freshly built
     * closure removes nothing, so a disposer written that way leaves every
     * handler attached. That is a leak with teeth — after a restart in-process
     * the old and new handlers would both fire, and the second shutdown would
     * follow a server that was already closed.
     */
    const registered = [];
    for (const signal of signals) {
        const handler = onSignal(signal);
        registered.push([signal, handler]);
        target.on(signal, handler);
    }
    for (const kind of fatals) {
        const handler = onFatal(kind);
        registered.push([kind, handler]);
        target.on(kind, handler);
    }
    return () => {
        stopForcing();
        for (const [event, handler] of registered)
            target.off(event, handler);
        registered.length = 0;
    };
}
//# sourceMappingURL=shutdown.js.map