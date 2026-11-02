import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EmailDeliveryError } from '../src/modules/notifications/email-adapter.js';
import { EmailNotificationWorker, type EmailWorkerStore } from '../src/modules/notifications/email-worker.service.js';
import type { ClaimedEmail, ResolvedEmailRecipient } from '../src/modules/notifications/email-worker.store.js';

const job: ClaimedEmail = {
    outbox_id: '41', lease_token: 'lease-a', event_type: 'order.created', template_key: 'order.created',
    recipient_user_id: '2', locale: 'en', business_id: '3', order_id: '4', payment_id: null,
    payload: { order_number: 'HQ-41', business_name: '<Merchant>' }, attempt_count: 1, max_attempts: 6,
};
const recipient: ResolvedEmailRecipient = {
    email: 'verified@example.test', full_name: 'Customer', locale: 'en', template_key: 'order.created', payload: job.payload,
};

class FakeStore implements EmailWorkerStore {
    jobs: ClaimedEmail[] = [job];
    recipient: ResolvedEmailRecipient | null = recipient;
    claims = 0;
    failures: Array<{ retryable: boolean; code: string }> = [];
    acknowledgments = 0;
    failResult = true;
    resolveError: Error | null = null;
    acknowledgeError: Error | null = null;
    async claim(): Promise<ClaimedEmail[]> { this.claims++; return this.jobs.splice(0); }
    async resolve(_id: string, _token: string): Promise<ResolvedEmailRecipient | null> {
        if (this.resolveError) throw this.resolveError;
        return this.recipient;
    }
    async acknowledge(): Promise<boolean> {
        this.acknowledgments++;
        if (this.acknowledgeError) throw this.acknowledgeError;
        return true;
    }
    async fail(_id: string, _token: string, retryable: boolean, code: string): Promise<boolean> {
        this.failures.push({ retryable, code }); return this.failResult;
    }
}
function make(
    store = new FakeStore(), send: () => Promise<void> = async () => {}, configured = true,
    smtpOutcome: (outcome: { success: true } | { success: false; code: string }) => void = () => {},
    logger?: Pick<Console, 'info' | 'error'>,
) {
    const sent: unknown[] = [];
    const worker = new EmailNotificationWorker({
        store, batchSize: 10, pollIntervalMs: 1000, leaseSeconds: 120,
        adapter: { isConfigured: () => configured, send: async (message) => { sent.push(message); await send(); } },
        smtpOutcome, logger,
    });
    return { worker, store, sent };
}
const secondJob: ClaimedEmail = { ...job, outbox_id: '42', lease_token: 'lease-b', payload: { order_number: 'HQ-42' } };

describe('email notification worker', () => {
    it('sends a rendered message and acknowledges using the claimed item', async () => {
        const outcomes: unknown[] = [];
        const { worker, store, sent } = make(undefined, async () => {}, true, (outcome) => outcomes.push(outcome));
        assert.equal(await worker.runOnce(), 1);
        assert.equal(sent.length, 1);
        assert.equal(store.acknowledgments, 1);
        assert.deepEqual(store.failures, []);
        assert.deepEqual(outcomes, [{ success: true }]);
    });
    it('schedules retry for a temporary SMTP failure', async () => {
        const outcomes: unknown[] = [];
        const { worker, store } = make(undefined,
            async () => { throw new EmailDeliveryError('smtp_timeout', true); }, true,
            (outcome) => outcomes.push(outcome));
        await worker.runOnce();
        assert.deepEqual(store.failures, [{ retryable: true, code: 'smtp_timeout' }]);
        assert.deepEqual(outcomes, [{ success: false, code: 'smtp_timeout' }]);
    });
    it('continues queue processing and verifies delivery after a retry succeeds', async () => {
        const store = new FakeStore();
        let sends = 0;
        const outcomes: unknown[] = [];
        store.fail = async (_id, _token, retryable, code) => {
            store.failures.push({ retryable, code });
            if (retryable) store.jobs.push({ ...job, attempt_count: 2, lease_token: 'lease-retry' });
            return true;
        };
        const { worker } = make(store, async () => {
            sends++;
            if (sends === 1) throw new EmailDeliveryError('smtp_timeout', true);
        }, true, (outcome) => outcomes.push(outcome));

        assert.equal(await worker.runOnce(), 1);
        assert.equal(await worker.runOnce(), 1);
        assert.equal(sends, 2);
        assert.equal(store.acknowledgments, 1);
        assert.deepEqual(outcomes, [
            { success: false, code: 'smtp_timeout' },
            { success: true },
        ]);
    });
    it('marks permanent SMTP failure terminal', async () => {
        const { worker, store } = make(undefined, async () => { throw new EmailDeliveryError('smtp_permanent_rejection', false); });
        await worker.runOnce();
        assert.deepEqual(store.failures, [{ retryable: false, code: 'smtp_permanent_rejection' }]);
    });
    it('does not claim work when SMTP configuration is missing', async () => {
        const { worker, store } = make(undefined, async () => {}, false);
        assert.equal(await worker.runOnce(), 0);
        assert.equal(store.claims, 0);
    });
    it('terminates missing and unverified recipients with a safe code', async () => {
        const store = new FakeStore(); store.recipient = null;
        const { worker } = make(store);
        await worker.runOnce();
        assert.deepEqual(store.failures, [{ retryable: false, code: 'recipient_unavailable' }]);
    });
    it('ignores a stale lease acknowledgment result', async () => {
        const store = new FakeStore(); store.acknowledge = async () => false;
        const { worker, sent } = make(store);
        await worker.runOnce();
        assert.equal(sent.length, 1);
    });
    it('leaves a claimed message leased when recipient resolution hits a temporary database failure', async () => {
        const store = new FakeStore();
        store.resolveError = Object.assign(new Error('database offline'), { code: 'ECONNRESET' });
        const logs: unknown[][] = [];
        const { worker, sent } = make(store, async () => {}, true, () => {}, {
            info: () => {},
            error: (...args: Parameters<Console['error']>) => logs.push(args),
        });
        await worker.runOnce();
        assert.equal(sent.length, 0);
        assert.deepEqual(store.failures, []);
        assert.deepEqual(logs.map((entry) => entry[0]), ['[email-worker] recipient_resolution_storage_failed']);
        store.resolveError = null;
        store.jobs = [{ ...job, lease_token: 'lease-recovered' }];
        assert.equal(await worker.runOnce(), 1);
        assert.equal(sent.length, 1);
        assert.equal(store.acknowledgments, 1);
    });
    it('does not mark an SMTP-accepted message failed when acknowledgement storage is unavailable', async () => {
        const store = new FakeStore();
        store.acknowledgeError = new Error('database acknowledgement unavailable');
        const { worker, sent } = make(store);
        await worker.runOnce();
        assert.equal(sent.length, 1);
        assert.deepEqual(store.failures, []);
        store.acknowledgeError = null;
        store.jobs = [{ ...job, lease_token: 'lease-recovered' }];
        await worker.runOnce();
        assert.equal(sent.length, 2, 'SMTP acceptance followed by lost acknowledgement is at-least-once and can duplicate');
        assert.equal(store.acknowledgments, 2);
        assert.deepEqual(store.failures, []);
    });
    it('handles an empty queue', async () => {
        const store = new FakeStore(); store.jobs = [];
        const { worker } = make(store);
        assert.equal(await worker.runOnce(), 0);
    });
    it('rejects invalid event/template records permanently', async () => {
        const store = new FakeStore(); store.jobs = [{ ...job, template_key: 'unknown' }];
        const { worker } = make(store);
        await worker.runOnce();
        assert.deepEqual(store.failures, [{ retryable: false, code: 'invalid_template' }]);
    });
    it('serializes overlapping cycles into one claim', async () => {
        const store = new FakeStore();
        let release!: () => void;
        const { worker } = make(store, () => new Promise<void>((resolve) => { release = resolve; }));
        const first = worker.runOnce();
        await new Promise((resolve) => setImmediate(resolve));
        const second = worker.runOnce();
        assert.equal(store.claims, 1);
        release();
        assert.equal(await first, await second);
    });
    it('shuts down the polling loop promptly', async () => {
        const store = new FakeStore(); store.jobs = [];
        const { worker } = make(store);
        const running = worker.start();
        await new Promise((resolve) => setImmediate(resolve));
        await worker.stop();
        await running;
        assert.equal(store.claims, 1);
    });
    it('does not settle a cycle after one runner rejects while another is active', async () => {
        const store = new FakeStore();
        store.jobs = [job, secondJob];
        store.resolve = async (id) => ({ ...recipient, email: id === job.outbox_id ? 'first@example.test' : 'second@example.test' });
        let releaseSecond!: () => void;
        store.fail = async (id, _token, _retryable, _code) => {
            if (id === job.outbox_id) throw new Error('private database diagnostic');
            return true;
        };
        const sent: unknown[] = [];
        const worker = new EmailNotificationWorker({
            store, batchSize: 2, concurrency: 2, pollIntervalMs: 1000, leaseSeconds: 120,
            adapter: { isConfigured: () => true, send: async (message) => {
                sent.push(message);
                if (message.to === 'first@example.test') throw new EmailDeliveryError('smtp_timeout', true);
                else await new Promise<void>((resolve) => { releaseSecond = resolve; });
            } },
        });
        let complete = false;
        const cycle = worker.runOnce().then(() => { complete = true; });
        while (!releaseSecond) await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(complete, false);
        releaseSecond();
        await cycle;
        assert.equal(complete, true);
        assert.equal(sent.length, 2);
    });
    it('does not begin a new cycle while any runner from the prior cycle is active', async () => {
        const store = new FakeStore();
        store.jobs = [job, secondJob];
        let release!: () => void;
        let sends = 0;
        const { worker } = make(store, async () => {
            sends++;
            if (sends === 2) await new Promise<void>((resolve) => { release = resolve; });
        });
        const cycleA = worker.runOnce();
        while (!release) await new Promise((resolve) => setImmediate(resolve));
        const cycleB = worker.runOnce();
        assert.equal(store.claims, 1);
        release();
        assert.equal(await cycleA, 2);
        assert.equal(await cycleB, 2);
    });
    it('waits for all active runners before graceful shutdown completes', async () => {
        const store = new FakeStore();
        store.jobs = [job, secondJob];
        let release!: () => void;
        let sends = 0;
        const { worker } = make(store, async () => {
            sends++;
            if (sends === 2) await new Promise<void>((resolve) => { release = resolve; });
        });
        const cycle = worker.runOnce();
        while (!release) await new Promise((resolve) => setImmediate(resolve));
        let stopped = false;
        const stopping = worker.stop().then(() => { stopped = true; });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(stopped, false);
        release();
        await Promise.all([cycle, stopping]);
        assert.equal(stopped, true);
    });
    it('logs multiple runner failures safely without unhandled rejections', async () => {
        const store = new FakeStore();
        store.jobs = [job, secondJob];
        store.fail = async () => { throw new Error('recipient@example.test secret response'); };
        const logs: unknown[][] = [];
        const worker = new EmailNotificationWorker({
            store, batchSize: 2, concurrency: 2, pollIntervalMs: 1000, leaseSeconds: 120,
            adapter: { isConfigured: () => true, send: async () => { throw new Error('unsafe SMTP diagnostics'); } },
            logger: { info: () => {}, error: (...args: unknown[]) => { logs.push(args); } },
        });
        assert.equal(await worker.runOnce(), 2);
        assert.equal(logs.length, 4);
        assert.deepEqual(logs.map((args) => args[0]).sort(), [
            '[email-worker] failure_record_storage_failed', '[email-worker] failure_record_storage_failed',
            '[email-worker] smtp_adapter_failed', '[email-worker] smtp_adapter_failed',
        ]);
        assert.equal(JSON.stringify(logs).includes('recipient@example.test'), false);
        assert.equal(JSON.stringify(logs).includes('unsafe SMTP diagnostics'), false);
    });
    it('clears the active cycle after every runner has settled', async () => {
        const store = new FakeStore();
        store.jobs = [job, secondJob];
        let release!: () => void;
        let sends = 0;
        const { worker } = make(store, async () => {
            sends++;
            if (sends === 2) await new Promise<void>((resolve) => { release = resolve; });
        });
        const first = worker.runOnce();
        while (!release) await new Promise((resolve) => setImmediate(resolve));
        release();
        await first;
        store.jobs = [];
        assert.equal(await worker.runOnce(), 0);
        assert.equal(store.claims, 2);
    });
});
