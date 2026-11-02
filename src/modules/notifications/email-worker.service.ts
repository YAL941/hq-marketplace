import { EmailDeliveryError, type SmtpEmailAdapter } from './email-adapter.js';
import { EMAIL_LOCALES, EMAIL_TEMPLATE_KEYS, renderMarketplaceEmail, type EmailLocale, type EmailTemplateKey } from './email-templates.js';
import type { ClaimedEmail, PgEmailWorkerStore, ResolvedEmailRecipient } from './email-worker.store.js';

export interface EmailWorkerStore {
    claim(limit: number, leaseSeconds: number): Promise<ClaimedEmail[]>;
    resolve(id: string, token: string): Promise<ResolvedEmailRecipient | null>;
    acknowledge(id: string, token: string): Promise<boolean>;
    fail(id: string, token: string, retryable: boolean, code: string): Promise<boolean>;
}

export interface EmailWorkerOptions {
    batchSize: number;
    concurrency?: number;
    pollIntervalMs: number;
    leaseSeconds: number;
    adapter: Pick<SmtpEmailAdapter, 'isConfigured' | 'send'>;
    store: EmailWorkerStore | Pick<PgEmailWorkerStore, 'claim' | 'resolve' | 'acknowledge' | 'fail'>;
    logger?: Pick<Console, 'info' | 'error'>;
    heartbeat?: () => void | Promise<void>;
    smtpOutcome?: (outcome: { success: true } | { success: false; code: string }) => void;
}

export class EmailNotificationWorker {
    private stopping = false;
    private loopPromise: Promise<void> | undefined;
    private activeCycle: Promise<number> | undefined;
    private wake: (() => void) | undefined;

    constructor(private readonly options: EmailWorkerOptions) {}

    start(): Promise<void> {
        if (this.loopPromise) return this.loopPromise;
        this.stopping = false;
        this.loopPromise = this.runLoop().finally(() => { this.loopPromise = undefined; });
        return this.loopPromise;
    }

    async stop(): Promise<void> {
        this.stopping = true;
        this.wake?.();
        await this.activeCycle?.catch(() => undefined);
        await this.loopPromise?.catch(() => undefined);
    }

    /** Concurrent callers share the same cycle so this worker never overlaps batches. */
    runOnce(): Promise<number> {
        if (this.activeCycle) return this.activeCycle;
        const cycle = this.processCycle().finally(() => {
            if (this.activeCycle === cycle) this.activeCycle = undefined;
        });
        this.activeCycle = cycle;
        return cycle;
    }

    private async runLoop(): Promise<void> {
        while (!this.stopping) {
            try {
                await this.runOnce();
                await this.options.heartbeat?.();
            } catch (error) {
                this.options.logger?.error('[email-worker] cycle_failed', safeFailureCode(error));
            }
            if (!this.stopping) await this.delay(this.options.pollIntervalMs);
        }
    }

    private async processCycle(): Promise<number> {
        // Leave pending work untouched when SMTP is not configured. The DB retry
        // policy is for delivery attempts, not deployment configuration errors.
        if (!this.options.adapter.isConfigured()) return 0;
        const jobs = await this.options.store.claim(this.options.batchSize, this.options.leaseSeconds);
        let next = 0;
        const concurrency = Math.min(jobs.length, this.options.concurrency ?? 5);
        const runnerResults = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
            while (next < jobs.length) {
                const index = next++;
                await this.processOne(jobs[index]!);
            }
        }));
        for (const result of runnerResults) {
            if (result.status === 'rejected') {
                // Drain every runner before allowing the active cycle to clear.
                // The reason is never logged because database errors may contain
                // addresses, SQL fragments, or provider response details.
                this.options.logger?.error('[email-worker] runner_failed', safeFailureCode(result.reason));
            }
        }
        return jobs.length;
    }

    private async processOne(job: ClaimedEmail): Promise<void> {
        try {
            if (!isTemplateKey(job.template_key) || !isTemplateKey(job.event_type)
                || job.template_key !== job.event_type || !isLocale(job.locale)) {
                await this.recordFailure(job, false, 'invalid_template');
                return;
            }

            let recipient: ResolvedEmailRecipient | null;
            try {
                recipient = await this.options.store.resolve(job.outbox_id, job.lease_token);
            } catch {
                // Keep the current lease. A database outage must not consume the
                // delivery retry budget or turn a valid notification into dead.
                this.options.logger?.error('[email-worker] recipient_resolution_storage_failed', { outboxId: job.outbox_id });
                return;
            }
            if (!recipient || !recipient.email) {
                await this.recordFailure(job, false, 'recipient_unavailable');
                return;
            }
            if (recipient.template_key !== job.template_key || recipient.locale !== job.locale) {
                await this.recordFailure(job, false, 'invalid_template');
                return;
            }

            let rendered: ReturnType<typeof renderMarketplaceEmail>;
            try {
                rendered = renderMarketplaceEmail(job.template_key, job.locale, templateData(job));
            } catch {
                await this.recordFailure(job, false, 'invalid_template');
                return;
            }

            try {
                await this.options.adapter.send({ to: recipient.email, ...rendered });
            } catch (error) {
                if (!(error instanceof EmailDeliveryError)) {
                    this.options.logger?.error('[email-worker] smtp_adapter_failed', { outboxId: job.outbox_id });
                    await this.recordFailure(job, true, 'smtp_send_failed');
                    return;
                }
                if (error.code.startsWith('smtp_') && error.code !== 'smtp_not_configured') {
                    this.options.smtpOutcome?.({ success: false, code: error.code });
                }
                await this.recordFailure(job, error.retryable, error.code);
                return;
            }

            // SMTP accepted the message. If PostgreSQL cannot persist the ack,
            // leave the lease to expire; recovery is at-least-once and may send
            // a duplicate, but must never mislabel the accepted mail as rejected.
            this.options.smtpOutcome?.({ success: true });
            try {
                const acknowledged = await this.options.store.acknowledge(job.outbox_id, job.lease_token);
                if (!acknowledged) this.options.logger?.info('[email-worker] stale_ack_ignored', { outboxId: job.outbox_id });
            } catch {
                this.options.logger?.error('[email-worker] acknowledgement_storage_failed_after_smtp_acceptance', {
                    outboxId: job.outbox_id,
                });
            }
        } finally {
            await this.options.heartbeat?.();
        }
    }

    private async recordFailure(job: ClaimedEmail, retryable: boolean, code: string): Promise<void> {
        try {
            const updated = await this.options.store.fail(job.outbox_id, job.lease_token, retryable, code);
            if (!updated) this.options.logger?.info('[email-worker] stale_failure_ignored', { outboxId: job.outbox_id });
        } catch {
            // A failed failure-record write is recoverable through lease expiry.
            // Never let storage errors be classified as template or SMTP errors.
            this.options.logger?.error('[email-worker] failure_record_storage_failed', { outboxId: job.outbox_id });
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => {
            let timer: ReturnType<typeof setTimeout>;
            const finish = () => {
                clearTimeout(timer);
                if (this.wake === finish) this.wake = undefined;
                resolve();
            };
            timer = setTimeout(finish, ms);
            timer.unref?.();
            this.wake = finish;
        });
    }
}

function isTemplateKey(value: string): value is EmailTemplateKey {
    return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}
function isLocale(value: string): value is EmailLocale {
    return (EMAIL_LOCALES as readonly string[]).includes(value);
}
function templateData(job: ClaimedEmail) {
    if (typeof job.payload !== 'object' || job.payload === null || Array.isArray(job.payload)) {
        throw new Error('Invalid payload');
    }
    const payload = job.payload as Record<string, unknown>;
    const orderNumber = typeof payload['order_number'] === 'string' ? payload['order_number'] : '';
    if (!orderNumber || orderNumber.length > 80) throw new Error('Invalid order number');
    const businessName = typeof payload['business_name'] === 'string' ? payload['business_name'] : undefined;
    const status = typeof payload['status'] === 'string' ? payload['status'] : undefined;
    if (businessName && businessName.length > 160) throw new Error('Invalid business name');
    if (job.template_key === 'order.status_changed'
        && !['pending', 'confirmed', 'in_progress', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'rejected', 'refunded'].includes(status ?? '')) {
        throw new Error('Invalid order status');
    }
    if (job.template_key === 'delivery.status_changed' && payload['delivery_status'] !== 'on_the_way') {
        throw new Error('Invalid delivery status');
    }
    return { orderNumber, businessName, status };
}
function safeFailureCode(error: unknown): string {
    return error instanceof EmailDeliveryError ? error.code : 'worker_cycle_failed';
}
