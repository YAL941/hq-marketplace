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

import type { Server } from 'node:http';

/**
 * The part of an `http.Server` this module uses.
 *
 * Narrowed to the three methods the shutdown actually calls, rather than the
 * whole `Server`. It keeps the dependency honest — nothing else here can be
 * reached — and it lets the ordering be tested against a stand-in instead of
 * against real sockets, which is what makes those tests fast enough to run on
 * every change and free of handles that outlive the test file.
 */
export interface StoppableServer {
    /** Stops accepting new connections; the callback fires when the last one ends. */
    close(callback: () => void): unknown;
    /** Closes connections that are between requests. Optional: older servers lack it. */
    closeIdleConnections?(): unknown;
    /** Closes connections that are still mid-request. Optional, for the same reason. */
    closeAllConnections?(): unknown;
}

/**
 * Where the handlers are registered.
 *
 * Injected for the same reason `exit` is: a test cannot emit `SIGTERM` on the
 * real `process` without either racing the test runner's own handlers or leaving
 * listeners behind, and `unhandledRejection` cannot be provoked on the real
 * `process` at all without the runner reporting it as a real failure. Defaults to
 * `process`, which is the only value production uses.
 */
export interface ShutdownSignalTarget {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface ShutdownOptions {
    /** The listening server to stop. */
    server: StoppableServer;
    /** Released before the process exits. Rejections are logged, never thrown. */
    closePools: () => Promise<void>;
    /**
     * How long in-flight requests are given before they are cut off.
     *
     * Kept below a typical orchestrator grace period on purpose: this timeout is
     * the last chance to report "this did not stop cleanly", and it only gets to
     * do that if it fires first.
     */
    timeoutMs?: number;
    /** Where to report progress. Defaults to the console. */
    log?: (message: string) => void;
    /** Where to report a timeout. Defaults to `console.warn`. */
    warn?: (message: string) => void;
    /** How the process ends. Injected so this can be tested. */
    exit?: (code: number) => void;
    /** What the handlers are registered on. Defaults to `process`. */
    target?: ShutdownSignalTarget;
}

/**
 * Ten seconds: long enough for a request that is already writing its response,
 * short enough to finish well inside the 30s `TimeoutStopSec` that systemd and
 * the 30s `terminationGracePeriodSeconds` that Kubernetes both default to.
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/** Removes the signal handlers that were installed. */
export type RemoveShutdownHandlers = () => void;

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
export function installShutdownHandlers(options: ShutdownOptions): RemoveShutdownHandlers {
    const {
        server,
        closePools,
        timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
        log = (message: string) => console.log(message),
        warn = (message: string) => console.warn(message),
        exit = (code: number) => process.exit(code),
        target = process,
    } = options;

    let shuttingDown = false;
    let forcedTimer: NodeJS.Timeout | undefined;

    const stopForcing = (): void => {
        if (forcedTimer) {
            clearTimeout(forcedTimer);
            forcedTimer = undefined;
        }
    };

    const shutdown = async (reason: string): Promise<void> => {
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

        const closed = new Promise<void>((resolveClosed) => {
            server.close(() => resolveClosed());
        });

        // Free connections only, and only once the listener is closed: a
        // connection mid-request is exactly the one we still want to keep.
        server.closeIdleConnections?.();

        forcedTimer = setTimeout(() => {
            warn(
                `[hq] shutdown did not finish within ${timeoutMs}ms, `
                + 'closing connections that are still open',
            );
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
        } catch (error) {
            // A pool that will not close is worth reporting, but the process is
            // going either way and the exit code should say it was not clean.
            warn(`[hq] pools did not close cleanly: ${error instanceof Error ? error.message : String(error)}`);
            stopForcing();
            exit(1);
        }
    };

    const onSignal = (signal: string) => (): void => {
        void shutdown(signal);
    };

    const onFatal = (kind: 'uncaughtException' | 'unhandledRejection') => (error: unknown): void => {
        // Recorded, not swallowed: the process is about to exit, and the reason
        // it exited is the only thing anyone will want to know afterwards.
        warn(`[hq] ${kind}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        void shutdown(kind);
    };

    const signals = ['SIGINT', 'SIGTERM'] as const;
    const fatals = ['uncaughtException', 'unhandledRejection'] as const;

    /**
     * The exact listener references that were registered.
     *
     * Kept because `off()` matches on identity: passing it a freshly built
     * closure removes nothing, so a disposer written that way leaves every
     * handler attached. That is a leak with teeth — after a restart in-process
     * the old and new handlers would both fire, and the second shutdown would
     * follow a server that was already closed.
     */
    const registered: Array<[string, (...args: unknown[]) => void]> = [];

    for (const signal of signals) {
        const handler: () => void = onSignal(signal);
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
        for (const [event, handler] of registered) target.off(event, handler);
        registered.length = 0;
    };
}