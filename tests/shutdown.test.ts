/**
 * Graceful shutdown.
 *
 * The behaviour worth pinning down is an *ordering*, not a socket: which of the
 * server's connection-closing methods is called when, whether a request that is
 * already being written is allowed to finish, and what the process reports
 * afterwards. That ordering is what a plain `server.close()` gets wrong — it
 * waits for every idle keep-alive as well as every real request, so a rolling
 * deploy outlasts the orchestrator and the process is `SIGKILL`ed with responses
 * half-written and pools never closed.
 *
 * So the handler is driven against a recording stand-in for the server, not
 * against real sockets. That is not a shortcut around testing the interesting
 * part; it is what makes the interesting part observable. Whether
 * `closeIdleConnections()` actually releases a keep-alive is Node's contract and
 * is not this project's to re-verify — but *whether this code calls it before it
 * waits* is exactly its own bug, and only a recording stand-in shows that.
 *
 * `exit` is injected too, so the process running this file is never the one that
 * gets killed.
 */

import assertModule from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { before, describe, it } from 'node:test';

const assert: typeof assertModule = assertModule;

type InstallShutdownHandlers = typeof import('../src/shutdown.js').installShutdownHandlers;
type ShutdownOptions = Parameters<InstallShutdownHandlers>[0];

let installShutdownHandlers: InstallShutdownHandlers;

/**
 * A server that records the calls made against it, and whose "connections
 * close" event the test triggers when it chooses.
 *
 * `finishClosing()` is the stand-in for the last in-flight request completing:
 * until it is called, `close()` has not fired, which is exactly the state a real
 * shutdown waits in.
 */
interface RecordingServer {
    server: ShutdownOptions['server'];
    /** Ordered names of the methods called so far. */
    calls: string[];
    /** Releases the pending `close()` callback, as a finished request would. */
    finishClosing: () => void;
    /** Whether the close callback has fired yet. */
    hasClosed: () => boolean;
    /** Drops `closeIdleConnections`/`closeAllConnections`, as a pre-Node-18 server would. */
    withoutConnectionMethods: () => RecordingServer;
}

function createRecordingServer(): RecordingServer {
    const calls: string[] = [];
    let releaseClose: (() => void) | undefined;
    let closed = false;

    const server: ShutdownOptions['server'] = {
        close(callback: () => void) {
            calls.push('close');
            releaseClose = () => {
                if (closed) return;
                closed = true;
                callback();
            };
        },
        closeIdleConnections() {
            calls.push('closeIdleConnections');
        },
        closeAllConnections() {
            calls.push('closeAllConnections');
        },
    };

    return {
        server,
        calls,
        finishClosing: () => releaseClose?.(),
        hasClosed: () => closed,
        withoutConnectionMethods: () => {
            const bare: ShutdownOptions['server'] = {
                close(callback: () => void) {
                    calls.push('close');
                    releaseClose = () => {
                        if (closed) return;
                        closed = true;
                        callback();
                    };
                },
            };
            const replacement: RecordingServer = {
                server: bare,
                calls,
                finishClosing: () => releaseClose?.(),
                hasClosed: () => closed,
                withoutConnectionMethods: () => replacement,
            };
            return replacement;
        },
    };
}

/** Everything one installed handler did, captured rather than performed. */
interface Harness {
    remove: () => void;
    /** The emitter the handlers were registered on. */
    signals: EventEmitter;
    exits: number[];
    logs: string[];
    warnings: string[];
    poolsClosed: () => boolean;
    /** Resolves on the first call to `exit`. */
    exited: Promise<void>;
}

/**
 * Installs the handlers with every side effect captured.
 *
 * The signal target is a private emitter rather than the real `process`: emitting
 * `unhandledRejection` on `process` makes the test runner report a genuine
 * failure, and every test that leaked a handler would add a listener to
 * `process` for the whole file. Both are avoided by owning the emitter here.
 */
async function install(
    recording: RecordingServer,
    overrides: Partial<ShutdownOptions> = {},
): Promise<Harness> {
    const exits: number[] = [];
    const logs: string[] = [];
    const warnings: string[] = [];
    const signals = new EventEmitter();
    let poolsWereClosed = false;
    let resolveExited: () => void = () => {};

    const exited = new Promise<void>((resolve) => { resolveExited = resolve; });

    const remove = installShutdownHandlers({
        server: recording.server,
        closePools: async () => { poolsWereClosed = true; },
        log: (message) => logs.push(message),
        warn: (message) => warnings.push(message),
        exit: (code) => {
            exits.push(code);
            resolveExited();
        },
        target: signals,
        ...overrides,
    });

    return {
        remove,
        signals,
        exits,
        logs,
        warnings,
        poolsClosed: () => poolsWereClosed,
        exited,
    };
}

/** Lets the handler's synchronous part run and any pending microtasks drain. */
function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 10));
}

before(async () => {
    installShutdownHandlers = (await import('../src/shutdown.js')).installShutdownHandlers;
});

describe('shutdown, in the normal case', () => {
    it('stops listening before it waits, rather than only waiting', async () => {
        // `close()` first, or the orchestrator keeps sending new requests to a
        // process that is on its way out.
        const recording = createRecordingServer();
        const harness = await install(recording);

        harness.signals.emit('SIGTERM');
        await tick();

        assert.equal(recording.calls[0], 'close', 'the listener must be closed first');
        harness.remove();
    });

    it('releases idle connections before waiting for in-flight ones', async () => {
        // The step `server.close()` alone omits, and the one that makes the wait
        // finite: an idle keep-alive socket stays open until the server closes
        // it, so a shutdown that only waits would sit there until the
        // orchestrator gave up.
        const recording = createRecordingServer();
        const harness = await install(recording);

        harness.signals.emit('SIGTERM');
        await tick();

        // Exactly this order: stop the listener, then release the connections
        // that are between requests, then wait.
        assert.deepEqual(recording.calls, ['close', 'closeIdleConnections']);

        harness.remove();
    });

    it('does not cut off a request that is still being written', async () => {
        // This is the whole point of waiting. A shutdown that called
        // `closeAllConnections()` straight away would truncate every response
        // in flight, which is the failure this module exists to avoid.
        const recording = createRecordingServer();
        const harness = await install(recording);

        harness.signals.emit('SIGTERM');
        await tick();

        assert.ok(
            !recording.calls.includes('closeAllConnections'),
            'in-flight connections were cut while a request was still open',
        );
        assert.deepEqual(harness.exits, [], 'the process exited while a request was still open');

        harness.remove();
    });

    it('closes the pools before exiting, and reports a clean stop', async () => {
        // Order matters: the pools are released before the process goes, so
        // PostgreSQL gets its connections back instead of waiting out its own
        // TCP timeout for processes that no longer exist.
        const recording = createRecordingServer();
        const harness = await install(recording);

        harness.signals.emit('SIGTERM');
        await tick();
        assert.equal(harness.poolsClosed(), false, 'the pools were released before close() completed');

        recording.finishClosing();
        await harness.exited;

        assert.equal(harness.poolsClosed(), true, 'the pools were not released before exiting');
        assert.deepEqual(harness.exits, [0], 'a shutdown that finished on its own is a clean one');
        assert.ok(harness.logs.some((line) => line.includes('shutdown complete')));

        harness.remove();
    });

    it('says what it is shutting down for', async () => {
        const recording = createRecordingServer();
        const harness = await install(recording);

        harness.signals.emit('SIGTERM');
        await tick();

        assert.ok(
            harness.logs.some((line) => line.includes('SIGTERM')),
            `the signal was not named in the log: ${JSON.stringify(harness.logs)}`,
        );

        harness.remove();
    });

    it('runs only once for repeated signals before completing', async () => {
        // Two signals in quick succession should not start two shutdowns; the
        // first is in progress and the second is only meaningful if it arrives
        // while something is actually being waited on.
        const recording = createRecordingServer();
        const harness = await install(recording);

        harness.signals.emit('SIGTERM');
        await tick();
        assert.deepEqual(harness.exits, []);

        // The second signal while a request is still open is treated as an
        // explicit override, which is asserted in its own case below.
        assert.equal(recording.calls.filter((call) => call === 'close').length, 1);

        recording.finishClosing();
        await harness.exited;
        assert.deepEqual(harness.exits, [0]);

        harness.remove();
    });
});

describe('shutdown, when it cannot finish', () => {
    it('gives up after the timeout and exits non-zero', async () => {
        // A process that had to be forced out must not report a clean stop: the
        // exit code is how a supervisor learns the deploy did not go as planned.
        const recording = createRecordingServer();
        const harness = await install(recording, { timeoutMs: 60 });

        harness.signals.emit('SIGTERM');
        await harness.exited;

        assert.deepEqual(harness.exits, [1]);
        assert.ok(
            recording.calls.includes('closeAllConnections'),
            'the remaining connections were never cut',
        );
        assert.ok(
            harness.warnings.some((warning) => warning.includes('did not finish within 60ms')),
            `the timeout was not reported: ${JSON.stringify(harness.warnings)}`,
        );

        harness.remove();
    });

    it('does not release the pools it never got to', async () => {
        // Reporting this matters as much as the exit code: the connections are
        // still open server-side, and an operator reading only the log would
        // otherwise assume they were not.
        const recording = createRecordingServer();
        const harness = await install(recording, { timeoutMs: 60 });

        harness.signals.emit('SIGTERM');
        await harness.exited;

        assert.equal(harness.poolsClosed(), false);

        harness.remove();
    });

    it('does not wait longer than the timeout for a server that never closes', async () => {
        const recording = createRecordingServer();
        const harness = await install(recording, { timeoutMs: 60 });

        const startedAt = Date.now();
        harness.signals.emit('SIGTERM');
        await harness.exited;

        assert.ok(
            Date.now() - startedAt < 2_000,
            'the timeout did not bound the wait for a server that never closes',
        );

        harness.remove();
    });

    it('stops waiting when a second signal arrives', async () => {
        // The escape hatch. An operator who signals twice means "now", and
        // without this the only way out is `kill -9`.
        const recording = createRecordingServer();
        const harness = await install(recording, { timeoutMs: 30_000 });

        harness.signals.emit('SIGTERM');
        await tick();
        assert.deepEqual(harness.exits, [], 'the first signal should still be waiting');

        harness.signals.emit('SIGTERM');
        await harness.exited;

        assert.deepEqual(harness.exits, [1], 'a forced stop must not report a clean exit');
        assert.ok(
            recording.calls.includes('closeAllConnections'),
            'the second signal should cut the remaining connections',
        );
        assert.ok(
            harness.warnings.some((warning) => warning.includes('again')),
            `the override was not reported: ${JSON.stringify(harness.warnings)}`,
        );

        harness.remove();
    });
});

describe('shutdown, when the pools misbehave', () => {
    it('exits non-zero and names the failure', async () => {
        const recording = createRecordingServer();
        const harness = await install(recording, {
            closePools: async () => { throw new Error('pool refused to close'); },
        });

        harness.signals.emit('SIGTERM');
        await tick();
        recording.finishClosing();
        await harness.exited;

        assert.deepEqual(harness.exits, [1], 'a failed pool close is not a clean stop');
        assert.ok(
            harness.warnings.some((warning) => warning.includes('pool refused to close')),
            `the reason was not reported: ${JSON.stringify(harness.warnings)}`,
        );

        harness.remove();
    });
});

describe('shutdown, on an unhandled error', () => {
    it('shuts down rather than dying mid-request', async () => {
        // Node terminates on an unhandled rejection anyway; routing it through
        // the shutdown means the pools are released and the reason is recorded.
        const recording = createRecordingServer();
        const harness = await install(recording);

        harness.signals.emit('unhandledRejection', new Error('something nobody caught'));
        await tick();
        recording.finishClosing();
        await harness.exited;

        assert.deepEqual(harness.exits, [0]);
        assert.equal(harness.poolsClosed(), true, 'the pools were not released');
        assert.ok(
            harness.warnings.some((warning) => warning.includes('something nobody caught')),
            `the reason was not recorded: ${JSON.stringify(harness.warnings)}`,
        );

        harness.remove();
    });

    it('works on a server without the connection-closing methods', async () => {
        // Those methods are relatively recent. A deployment on an older runtime
        // should still shut down cleanly rather than throwing inside the
        // signal handler, which would leave the process in an unknown state.
        const recording = createRecordingServer().withoutConnectionMethods();
        const harness = await install(recording);

        harness.signals.emit('SIGTERM');
        await tick();
        recording.finishClosing();
        await harness.exited;

        assert.deepEqual(harness.exits, [0]);
        assert.equal(harness.poolsClosed(), true);

        harness.remove();
    });
});

describe('the installed handlers', () => {
    it('registers one per signal and unregisters on removal', async () => {
        // Counted on the injected target, not on `process`: what matters is that
        // the disposer takes back everything it added, and using the real
        // `process` here would make a leak a problem for the whole file.
        const recording = createRecordingServer();
        const harness = await install(recording);
        const target = harness.signals;

        assert.equal(target.listenerCount('SIGINT'), 1);
        assert.equal(target.listenerCount('SIGTERM'), 1);
        assert.equal(target.listenerCount('uncaughtException'), 1);
        assert.equal(target.listenerCount('unhandledRejection'), 1);

        harness.remove();

        assert.equal(target.listenerCount('SIGINT'), 0, 'SIGINT was left registered');
        assert.equal(target.listenerCount('SIGTERM'), 0, 'SIGTERM was left registered');
        assert.equal(target.listenerCount('uncaughtException'), 0);
        assert.equal(target.listenerCount('unhandledRejection'), 0);
    });

    it('defaults to registering on the real process', async () => {
        // The injection above is a test affordance; production must still get
        // the real thing, or the whole module would be inert in a deployment.
        const beforeTerm = process.listenerCount('SIGTERM');
        const beforeUncaught = process.listenerCount('uncaughtException');

        const remove = installShutdownHandlers({
            server: createRecordingServer().server,
            closePools: async () => {},
            exit: () => {},
        });

        assert.equal(process.listenerCount('SIGTERM'), beforeTerm + 1);
        assert.equal(process.listenerCount('uncaughtException'), beforeUncaught + 1);

        remove();

        assert.equal(process.listenerCount('SIGTERM'), beforeTerm);
        assert.equal(process.listenerCount('uncaughtException'), beforeUncaught);
    });

    it('stops acting once removed', async () => {
        const recording = createRecordingServer();
        const harness = await install(recording);
        harness.remove();

        harness.signals.emit('SIGTERM');
        await tick();

        assert.deepEqual(recording.calls, [], 'a removed handler still shut the server down');
        assert.deepEqual(harness.exits, []);
    });
});