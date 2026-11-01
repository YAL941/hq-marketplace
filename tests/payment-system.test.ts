process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';
process.env['PAYMENTS_MOCK_ENABLED'] = 'true';
process.env['MOCK_MOBILE_MONEY_WEBHOOK_SECRET'] = 'payment-test-webhook-secret-32-characters';

import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MockMobileMoneyProvider } from '../src/modules/payments/mock-mobile-money.provider.js';

const assert: typeof assertModule = assertModule;
const webhookSecret = process.env['MOCK_MOBILE_MONEY_WEBHOOK_SECRET']!;
const mockProvider = new MockMobileMoneyProvider(webhookSecret);

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let appPool: import('pg').Pool;
let closePools: () => Promise<void>;
let customerToken: string;
let businessId: number;
let mockSmsProvider: import('../src/modules/notifications/mock-sms.provider.js').MockSmsProvider;
let mockWhatsAppProvider: import('../src/modules/notifications/mock-whatsapp.provider.js').MockWhatsAppProvider;

async function createUser(email: string, fullName: string, phone: string): Promise<number> {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const { rows } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, phone, password_hash, full_name, status, email_verified_at)
         VALUES ($1, $2, $3, $4, 'active', now()) RETURNING user_id`,
        [email, phone, passwordHash, fullName],
    );
    return Number(rows[0]!.user_id);
}

async function login(email: string): Promise<string> {
    const response = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.data.token as string;
}

before(async () => {
    const notificationService = await import('../src/modules/notifications/notification.service.js');
    mockSmsProvider = notificationService.mockSmsProvider;
    mockWhatsAppProvider = notificationService.mockWhatsAppProvider;
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    appPool = poolModule.appPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const ownerId = await createUser('payments-owner@hq.test', 'Payments Owner', '+252610000008');
    await createUser('payments-customer@hq.test', 'Payments Customer', '+252610000017');
    customerToken = await login('payments-customer@hq.test');

    const { rows: businesses } = await adminPool.query<{ business_id: string }>(
        `INSERT INTO businesses
            (business_name, business_slug, business_description, phone, email, city, district,
             status, verification_status, is_verified, verified_at)
         VALUES ('Payments Shop', 'payments-shop', 'Payments test shop', '+252610000001',
                 'payments-shop@hq.test', 'Mogadishu', 'Hodan', 'active', 'verified', true, now())
         RETURNING business_id`,
    );
    businessId = Number(businesses[0]!.business_id);
    const { rows: roles } = await adminPool.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business'`,
    );
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [businessId, ownerId, roles[0]!.role_id],
    );
});

after(async () => {
    await closePools?.();
});

let phase4dSequence = 0;

async function createPhase4dPayment(options: {
    orderStatus?: 'pending' | 'cancelled' | 'rejected' | 'refunded';
    paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
    businessId?: number;
} = {}): Promise<{ orderId: number; paymentId: number; providerReference: string; customerId: number }> {
    phase4dSequence += 1;
    const { rows: customerRows } = await adminPool.query<{ user_id: string }>(
        `SELECT user_id FROM users WHERE email = 'payments-customer@hq.test'`,
    );
    const customerId = Number(customerRows[0]!.user_id);
    const orderStatus = options.orderStatus ?? 'pending';
    const paymentStatus = options.paymentStatus ?? 'pending';
    const orderBusinessId = options.businessId ?? businessId;
    const orderNumber = `PHASE4D-${phase4dSequence}-${Date.now()}`;
    const { rows: orderRows } = await adminPool.query<{ order_id: string }>(
        `INSERT INTO orders
            (order_number, business_id, customer_id, order_type, order_status, subtotal,
             delivery_fee, discount_amount, tax_amount, total_amount, currency,
             payment_method, payment_status, cancelled_at)
         VALUES ($1, $2, $3, 'product', $4::order_status, 10, 0, 0, 0, 10, 'USD',
                 'mock_mobile_money', $5, CASE WHEN $4::order_status = 'cancelled' THEN now() ELSE NULL END)
         RETURNING order_id`,
        [orderNumber, orderBusinessId, customerId, orderStatus, paymentStatus],
    );
    const orderId = Number(orderRows[0]!.order_id);
    const providerReference = `phase4d-ref-${phase4dSequence}-${Date.now()}`;
    const { rows: paymentRows } = await adminPool.query<{ payment_id: string }>(
        `INSERT INTO payments
            (order_id, customer_id, provider, payment_method, status, amount_minor,
             currency, provider_reference, idempotency_key)
         VALUES ($1, $2, 'mock_mobile_money', 'mock_mobile_money', 'pending',
                 1000, 'USD', $3, $4)
         RETURNING payment_id`,
        [orderId, customerId, providerReference, `phase4d-key-${phase4dSequence}`],
    );
    return {
        orderId,
        paymentId: Number(paymentRows[0]!.payment_id),
        providerReference,
        customerId,
    };
}

async function applyLateSuccess(
    providerReference: string,
    eventId: string,
    payload: Record<string, unknown> = { phase: '4d', result: 'success' },
) {
    const { rows } = await adminPool.query<{
        payment_id: string;
        order_id: string;
        payment_status: string;
        duplicate: boolean;
        reconciliation_required: boolean;
    }>(
        `SELECT * FROM apply_verified_payment_event(
            'mock_mobile_money', $1, $2, 1000, 'USD', true, 500, $3::jsonb
        )`,
        [eventId, providerReference, JSON.stringify(payload)],
    );
    return rows[0]!;
}

async function waitForPostgresLockWait(client: import('pg').PoolClient, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const processID = (client as unknown as { processID: number }).processID;
        const { rows } = await adminPool.query<{ wait_event_type: string | null }>(
            `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
            [processID],
        );
        if (rows[0]?.wait_event_type === 'Lock') return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`PostgreSQL connection ${(client as unknown as { processID: number }).processID} did not reach a lock wait state`);
}

describe('payment lifecycle', () => {
    it('limits production mock payments to the configured tester email', async () => {
        const settings = {
            enabled: true,
            isProduction: true,
            testerEmail: 'tester@example.com',
        };
        const providers = await import('../src/modules/payments/payment.providers.js');
        const config = (await import('../src/config.js')).config as {
            isProduction: boolean;
            PAYMENTS_MOCK_TESTER_EMAIL?: string;
        };
        const originalProduction = config.isProduction;
        const originalTesterEmail = config.PAYMENTS_MOCK_TESTER_EMAIL;
        config.isProduction = true;
        config.PAYMENTS_MOCK_TESTER_EMAIL = settings.testerEmail;
        try {
            assert.equal(providers.isMockMobileMoneyAllowedFor('tester@example.com', settings), true);
            assert.equal(providers.isMockMobileMoneyAllowedFor(' TESTER@example.com ', settings), true);
            assert.equal(providers.isMockMobileMoneyAllowedFor('customer@example.com', settings), false);
            assert.equal(providers.isMockMobileMoneyAllowedFor(null, settings), false);
            assert.equal(
                providers.isMockMobileMoneyAllowedFor('tester@example.com', { ...settings, enabled: false }),
                false,
            );
            assert.equal(providers.listPaymentMethods('tester@example.com')[0]?.available, true);
            assert.equal(providers.listPaymentMethods('customer@example.com')[0]?.available, false);
        } finally {
            config.isProduction = originalProduction;
            config.PAYMENTS_MOCK_TESTER_EMAIL = originalTesterEmail;
        }
    });

    it('does not offer cash on delivery as a checkout payment method', async () => {
        const response = await request(app).get('/api/payments/methods');
        assert.equal(response.status, 200);
        assert.equal(
            response.body.data.some((method: { name: string }) => method.name === 'cash_on_delivery'),
            false,
        );
    });

    it('requires a verified idempotent webhook before marking an order paid, and accounts commission once', async () => {
        mockSmsProvider.clear();
        mockWhatsAppProvider.clear();
        const ownerToken = await login('payments-owner@hq.test');
        const productResponse = await request(app)
            .post(`/api/business/${businessId}/products`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ productName: 'Payment Test Item', price: 10, currency: 'USD', stockQuantity: 10, status: 'active' });
        assert.equal(productResponse.status, 201, JSON.stringify(productResponse.body));

        const sendSms = mockSmsProvider.send.bind(mockSmsProvider);
        mockSmsProvider.send = async (message) => {
            if (message.eventType === 'new_order') throw new Error('simulated SMS outage');
            await sendSms(message);
        };
        let orderResponse;
        try {
            orderResponse = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${customerToken}`)
                .send({
                    businessId,
                    items: [{ productId: Number(productResponse.body.data.product_id), quantity: 2 }],
                    paymentMethod: 'mock_mobile_money',
                    notificationLanguage: 'ar',
                });
        } finally {
            mockSmsProvider.send = sendSms;
        }
        assert.equal(orderResponse.status, 201, JSON.stringify(orderResponse.body));
        const orderId = Number(orderResponse.body.data.order_id);
        assert.equal(mockSmsProvider.delivered.length, 0);
        assert.equal(mockWhatsAppProvider.delivered.length, 1);
        assert.equal(mockWhatsAppProvider.delivered[0]!.eventType, 'new_order');
        assert.equal(mockWhatsAppProvider.delivered[0]!.to, '+252610000001');
        assert.match(mockWhatsAppProvider.delivered[0]!.body, /طلب جديد/);

        const visibleOrder = await request(app)
            .get(`/api/orders/mine/${orderId}`)
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(visibleOrder.status, 200, JSON.stringify(visibleOrder.body));

        const started = await request(app)
            .post(`/api/orders/mine/${orderId}/payments`)
            .set('Authorization', `Bearer ${customerToken}`)
            .set('Idempotency-Key', 'payment-test-idempotency-key')
            .send({ provider: 'mock_mobile_money' });
        assert.equal(started.status, 201, JSON.stringify(started.body));
        const payment = started.body.data as {
            payment_id: string;
            provider_reference: string;
            amount_minor: string;
            currency: string;
        };

        const retry = await request(app)
            .post(`/api/orders/mine/${orderId}/payments`)
            .set('Authorization', `Bearer ${customerToken}`)
            .set('Idempotency-Key', 'payment-test-idempotency-key')
            .send({ provider: 'mock_mobile_money' });
        assert.equal(retry.status, 201, JSON.stringify(retry.body));
        assert.equal(retry.body.data.payment_id, payment.payment_id);

        const statusChanged = await request(app)
            .patch(`/api/business/${businessId}/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ orderStatus: 'confirmed' });
        assert.equal(statusChanged.status, 200, JSON.stringify(statusChanged.body));
        assert.equal(mockSmsProvider.delivered.length, 1);
        assert.equal(mockSmsProvider.delivered[0]!.eventType, 'order_status_changed');
        assert.equal(mockSmsProvider.delivered[0]!.to, '+252610000017');
        assert.match(mockSmsProvider.delivered[0]!.body, /تم التأكيد/);
        assert.equal(mockWhatsAppProvider.delivered.length, 2);

        const signed = mockProvider.createSignedSuccessEvent({
            paymentId: payment.payment_id,
            providerReference: payment.provider_reference,
            amountMinor: payment.amount_minor,
            currency: payment.currency,
        });
        assert.ok(mockProvider.verifyWebhook({
            'x-mock-timestamp': signed.timestamp,
            'x-mock-signature': signed.signature,
        }, signed.rawBody));
        const webhook = () => request(app)
            .post('/api/payments/webhooks/mock_mobile_money')
            .set('x-mock-timestamp', signed.timestamp)
            .set('x-mock-signature', signed.signature)
            .send(signed.rawBody.toString('utf8'))
            .set('Content-Type', 'application/json');

        const forged = await request(app)
            .post('/api/payments/webhooks/mock_mobile_money')
            .set('x-mock-timestamp', signed.timestamp)
            .set('x-mock-signature', '0'.repeat(64))
            .send(signed.rawBody.toString('utf8'))
            .set('Content-Type', 'application/json');
        assert.equal(forged.status, 401);

        const simulatedCompletion = await request(app)
            .post(`/api/payments/${payment.payment_id}/mock-complete`)
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(simulatedCompletion.status, 200, JSON.stringify(simulatedCompletion.body));
        assert.equal(simulatedCompletion.body.data.payment_status, 'paid');
        assert.equal(simulatedCompletion.body.data.duplicate, false);

        const accepted = await webhook();
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
        assert.equal(accepted.body.data.payment_status, 'paid');
        assert.equal(accepted.body.data.duplicate, true);

        const duplicate = await webhook();
        assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
        assert.equal(duplicate.body.data.duplicate, true);
        assert.equal(mockSmsProvider.delivered.filter((message) => message.eventType === 'payment_confirmed').length, 1);
        assert.equal(mockWhatsAppProvider.delivered.filter((message) => message.eventType === 'payment_confirmed').length, 1);

        const { rows } = await adminPool.query<{
            payment_status: string;
            order_status: string;
            status: string;
            commission_minor: string;
            merchant_amount_minor: string;
            rate_used_bps: number;
        }>(
            `SELECT o.payment_status, o.order_status, p.status, p.commission_minor,
                    p.merchant_amount_minor, p.rate_used_bps
               FROM orders o JOIN payments p ON p.order_id = o.order_id
              WHERE o.order_id = $1`,
            [orderId],
        );
        assert.deepEqual(rows[0], {
            payment_status: 'paid',
            order_status: 'confirmed',
            status: 'succeeded',
            commission_minor: '100',
            merchant_amount_minor: '1900',
            rate_used_bps: 500,
        });

        const paidOrderVisible = await request(app)
            .get(`/api/orders/mine/${orderId}`)
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(paidOrderVisible.status, 200, JSON.stringify(paidOrderVisible.body));

        const secondPayment = await request(app)
            .post(`/api/orders/mine/${orderId}/payments`)
            .set('Authorization', `Bearer ${customerToken}`)
            .set('Idempotency-Key', 'second-payment-attempt')
            .send({ provider: 'mock_mobile_money' });
        assert.equal(secondPayment.status, 409, JSON.stringify(secondPayment.body));
    });

    it('records a late success after customer cancellation without reopening the order', async () => {
        const fixture = await createPhase4dPayment();
        await adminPool.query(
            `UPDATE orders SET order_status = 'cancelled', cancelled_at = now(),
                              cancellation_reason = 'Customer cancelled'
             WHERE order_id = $1`,
            [fixture.orderId],
        );
        const result = await applyLateSuccess(fixture.providerReference, `late-customer-${phase4dSequence}`);
        assert.equal(result.duplicate, false);
        assert.equal(result.reconciliation_required, true);
        const { rows } = await adminPool.query<{ order_status: string; payment_status: string; reconciliation_status: string; payment_status_reconciliation: string; event_outcome: string }>(
            `SELECT o.order_status, o.payment_status,
                    p.reconciliation_status, o.payment_reconciliation_status AS payment_status_reconciliation,
                    e.outcome AS event_outcome
               FROM orders o
               JOIN payments p ON p.order_id = o.order_id
               JOIN payment_webhook_events e ON e.payment_id = p.payment_id
              WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(rows[0]!.order_status, 'cancelled');
        assert.notEqual(rows[0]!.payment_status, 'paid');
        assert.equal(rows[0]!.reconciliation_status, 'refund_review_required');
        assert.equal(rows[0]!.payment_status_reconciliation, 'refund_review_required');
        assert.equal(rows[0]!.event_outcome, 'succeeded_reconciliation_required');
    });

    it('records a late success after business cancellation', async () => {
        const fixture = await createPhase4dPayment();
        await adminPool.query(
            `UPDATE orders SET order_status = 'cancelled', cancelled_at = now()
             WHERE order_id = $1`,
            [fixture.orderId],
        );
        await applyLateSuccess(fixture.providerReference, `late-business-cancel-${phase4dSequence}`);
        const { rows } = await adminPool.query<{ order_status: string; status: string; reconciliation_status: string }>(
            `SELECT o.order_status, p.status, p.reconciliation_status
               FROM orders o JOIN payments p ON p.order_id = o.order_id
              WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(rows[0]!.order_status, 'cancelled');
        assert.equal(rows[0]!.status, 'succeeded');
        assert.equal(rows[0]!.reconciliation_status, 'refund_review_required');
    });

    it('records a late success after business rejection', async () => {
        const fixture = await createPhase4dPayment();
        await adminPool.query(`UPDATE orders SET order_status = 'rejected' WHERE order_id = $1`, [fixture.orderId]);
        const result = await applyLateSuccess(fixture.providerReference, `late-rejected-${phase4dSequence}`);
        const { rows } = await adminPool.query<{ order_status: string; status: string; reconciliation_status: string }>(
            `SELECT o.order_status, p.status, p.reconciliation_status
               FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(result.reconciliation_required, true);
        assert.equal(rows[0]!.order_status, 'rejected');
        assert.equal(rows[0]!.status, 'succeeded');
        assert.equal(rows[0]!.reconciliation_status, 'refund_review_required');
    });

    it('records a late success for a refunded order without reopening it', async () => {
        const fixture = await createPhase4dPayment({ orderStatus: 'refunded', paymentStatus: 'refunded' });
        const result = await applyLateSuccess(fixture.providerReference, `late-refunded-${phase4dSequence}`);
        const { rows } = await adminPool.query<{ order_status: string; payment_status: string; status: string }>(
            `SELECT o.order_status, o.payment_status, p.status
               FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(result.reconciliation_required, true);
        assert.equal(rows[0]!.order_status, 'refunded');
        assert.equal(rows[0]!.payment_status, 'refunded');
        assert.equal(rows[0]!.status, 'succeeded');
    });

    it('makes duplicate delivery of the same late-success event idempotent', async () => {
        const fixture = await createPhase4dPayment({ orderStatus: 'cancelled' });
        const eventId = `late-duplicate-${phase4dSequence}`;
        const first = await applyLateSuccess(fixture.providerReference, eventId);
        const second = await applyLateSuccess(fixture.providerReference, eventId);
        assert.equal(first.duplicate, false);
        assert.equal(second.duplicate, true);
        assert.equal(second.reconciliation_required, true);
        const { rows } = await adminPool.query<{ event_count: string; status: string }>(
            `SELECT count(*)::text AS event_count, p.status
               FROM payment_webhook_events e JOIN payments p ON p.payment_id = e.payment_id
              WHERE p.order_id = $1 GROUP BY p.status`,
            [fixture.orderId],
        );
        assert.equal(rows[0]!.event_count, '1');
        assert.equal(rows[0]!.status, 'succeeded');
    });

    it('rejects reuse of a late-success event ID with different payload', async () => {
        const fixture = await createPhase4dPayment({ orderStatus: 'rejected' });
        const eventId = `late-payload-${phase4dSequence}`;
        await applyLateSuccess(fixture.providerReference, eventId, { result: 'success', version: 1 });
        await assert.rejects(
            applyLateSuccess(fixture.providerReference, eventId, { result: 'success', version: 2 }),
            /webhook event id was reused with different content/,
        );
    });

    it('handles cancellation-first concurrency without deadlock and preserves late success', async () => {
        const fixture = await createPhase4dPayment();
        const cancellation = await adminPool.connect();
        const webhook = await adminPool.connect();
        let webhookSettled = false;
        try {
            await cancellation.query('BEGIN');
            await cancellation.query(
                `UPDATE orders SET order_status = 'cancelled', cancelled_at = now()
                 WHERE order_id = $1`,
                [fixture.orderId],
            );

            await webhook.query('BEGIN');
            const webhookPromise = webhook.query(
                `SELECT * FROM apply_verified_payment_event(
                    'mock_mobile_money', $1, $2, 1000, 'USD', true, 500,
                    '{"race":"cancellation-first"}'::jsonb
                )`,
                [`late-race-cancel-first-${phase4dSequence}`, fixture.providerReference],
            ).then((result) => { webhookSettled = true; return result; });

            await waitForPostgresLockWait(webhook);
            await cancellation.query('COMMIT');
            const webhookResult = await webhookPromise;
            await webhook.query('COMMIT');

            assert.equal(webhookResult.rows[0]!.reconciliation_required, true);
        } finally {
            await webhook.query('ROLLBACK').catch(() => undefined);
            await cancellation.query('ROLLBACK').catch(() => undefined);
            webhook.release();
            cancellation.release();
        }

        const { rows } = await adminPool.query<{ order_status: string; status: string; reconciliation_status: string }>(
            `SELECT o.order_status, p.status, p.reconciliation_status
               FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(webhookSettled, true);
        assert.equal(rows[0]!.order_status, 'cancelled');
        assert.equal(rows[0]!.status, 'succeeded');
        assert.equal(rows[0]!.reconciliation_status, 'refund_review_required');
    });

    it('handles webhook-first concurrency without deadlock or reopening the terminal order', async () => {
        const fixture = await createPhase4dPayment();
        const webhook = await adminPool.connect();
        const cancellation = await adminPool.connect();
        let cancellationSettled = false;
        try {
            await webhook.query('BEGIN');
            const webhookResult = await webhook.query(
                `SELECT * FROM apply_verified_payment_event(
                    'mock_mobile_money', $1, $2, 1000, 'USD', true, 500,
                    '{"race":"webhook-first"}'::jsonb
                )`,
                [`late-race-webhook-first-${phase4dSequence}`, fixture.providerReference],
            );
            assert.equal(webhookResult.rows[0]!.payment_status, 'paid');

            await cancellation.query('BEGIN');
            const cancellationPromise = cancellation.query(
                `UPDATE orders SET order_status = 'cancelled', cancelled_at = now()
                 WHERE order_id = $1`,
                [fixture.orderId],
            ).then((result) => { cancellationSettled = true; return result; });

            await waitForPostgresLockWait(cancellation);
            await webhook.query('COMMIT');
            await cancellationPromise;
            await cancellation.query('COMMIT');
        } finally {
            await cancellation.query('ROLLBACK').catch(() => undefined);
            await webhook.query('ROLLBACK').catch(() => undefined);
            cancellation.release();
            webhook.release();
        }

        const { rows } = await adminPool.query<{
            order_status: string;
            payment_status: string;
            status: string;
            reconciliation_status: string;
        }>(
            `SELECT o.order_status, o.payment_status, p.status, p.reconciliation_status
               FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(cancellationSettled, true);
        assert.equal(rows[0]!.order_status, 'cancelled');
        assert.equal(rows[0]!.payment_status, 'paid');
        assert.equal(rows[0]!.status, 'succeeded');
        assert.equal(rows[0]!.reconciliation_status, 'refund_review_required');
    });

    it('leaves normal successful payment behavior unchanged for an active order', async () => {
        const fixture = await createPhase4dPayment();
        const result = await applyLateSuccess(fixture.providerReference, `normal-success-${phase4dSequence}`);
        assert.equal(result.payment_status, 'paid');
        assert.equal(result.duplicate, false);
        assert.equal(result.reconciliation_required, false);
        const { rows } = await adminPool.query<{ order_status: string; payment_status: string; status: string }>(
            `SELECT o.order_status, o.payment_status, p.status
               FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(rows[0]!.order_status, 'pending');
        assert.equal(rows[0]!.payment_status, 'paid');
        assert.equal(rows[0]!.status, 'succeeded');
    });

    it('leaves failed webhook behavior unchanged', async () => {
        const fixture = await createPhase4dPayment();
        const { rows } = await adminPool.query<{
            payment_status: string;
            duplicate: boolean;
        }>(
            `SELECT * FROM apply_verified_payment_event(
                'mock_mobile_money', $1, $2, 1000, 'USD', false, 500, '{"result":"failed"}'::jsonb
            )`,
            [`failed-${phase4dSequence}`, fixture.providerReference],
        );
        assert.equal(rows[0]!.payment_status, 'failed');
        assert.equal(rows[0]!.duplicate, false);
        const { rows: state } = await adminPool.query<{ payment_status: string; status: string }>(
            `SELECT o.payment_status, p.status
               FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(state[0]!.payment_status, 'failed');
        assert.equal(state[0]!.status, 'failed');
    });

    it('identifies and idempotently backfills existing terminal successful records', async () => {
        const fixture = await createPhase4dPayment({ orderStatus: 'refunded' });
        await adminPool.query(
            `UPDATE payments
                SET status = 'succeeded',
                    provider_event_id = 'historical-success-event',
                    commission_minor = 50,
                    merchant_amount_minor = 950,
                    rate_used_bps = 500,
                    reconciliation_status = 'none',
                    reconciliation_reason = NULL,
                    reconciliation_at = NULL,
                    paid_at = now()
              WHERE payment_id = $1`,
            [fixture.paymentId],
        );
        await adminPool.query(
            `UPDATE orders
                SET payment_status = 'paid',
                    payment_reconciliation_status = 'none',
                    payment_reconciliation_reason = NULL,
                    payment_reconciliation_at = NULL
              WHERE order_id = $1`,
            [fixture.orderId],
        );

        const { rows: candidates } = await adminPool.query<{ order_id: string }>(
            `SELECT order_id::text FROM payment_late_reconciliation_candidates WHERE order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(candidates.length, 1);

        const backfill = async () => adminPool.query(`
            UPDATE payments p
               SET reconciliation_status = 'refund_review_required',
                   reconciliation_reason = format('Existing terminal/succeeded backfill: %s', o.order_status),
                   reconciliation_at = now(),
                   updated_at = now()
              FROM orders o
             WHERE p.order_id = o.order_id
               AND o.order_status IN ('cancelled', 'rejected', 'refunded')
               AND p.status = 'succeeded'
               AND p.reconciliation_status <> 'refund_review_required'
        `);
        await backfill();
        await backfill();

        await adminPool.query(`
            UPDATE orders o
               SET payment_reconciliation_status = 'refund_review_required',
                   payment_reconciliation_reason = 'Existing terminal/succeeded backfill',
                   payment_reconciliation_at = now()
              FROM payments p
             WHERE p.order_id = o.order_id
               AND o.order_status IN ('cancelled', 'rejected', 'refunded')
               AND p.status = 'succeeded'
               AND o.payment_reconciliation_status <> 'refund_review_required'
        `);

        const { rows } = await adminPool.query<{
            order_status: string;
            payment_status: string;
            reconciliation_status: string;
            payment_reconciliation_status: string;
        }>(
            `SELECT o.order_status, p.status AS payment_status, p.reconciliation_status,
                    o.payment_reconciliation_status
               FROM orders o JOIN payments p ON p.order_id = o.order_id
              WHERE o.order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(rows[0]!.order_status, 'refunded');
        assert.equal(rows[0]!.payment_status, 'succeeded');
        assert.equal(rows[0]!.reconciliation_status, 'refund_review_required');
        assert.equal(rows[0]!.payment_reconciliation_status, 'refund_review_required');
        const { rows: remaining } = await adminPool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM payment_late_reconciliation_candidates WHERE order_id = $1`,
            [fixture.orderId],
        );
        assert.equal(remaining[0]!.count, '0');
    });

    it('reconciles a linked payment through hq_app with anonymous RLS context without touching another business', async () => {
        const { rows: otherBusinesses } = await adminPool.query<{ business_id: string }>(
            `INSERT INTO businesses
                (business_name, business_slug, business_description, phone, email, city, district,
                 status, verification_status, is_verified, verified_at)
             VALUES ('App RLS Shop', 'app-rls-shop', 'Application role RLS test',
                     '+252610000003', 'app-rls@hq.test', 'Mogadishu', 'Hodan',
                     'active', 'verified', true, now())
             RETURNING business_id`,
        );
        const otherBusinessId = Number(otherBusinesses[0]!.business_id);
        const linked = await createPhase4dPayment({ orderStatus: 'cancelled' });
        const unrelated = await createPhase4dPayment({ businessId: otherBusinessId, orderStatus: 'cancelled' });
        const { rows: beforeUnrelated } = await adminPool.query<{
            status: string;
            reconciliation_status: string;
            order_status: string;
        }>(
            `SELECT p.status, p.reconciliation_status, o.order_status
               FROM payments p JOIN orders o ON o.order_id = p.order_id
              WHERE p.payment_id = $1`,
            [unrelated.paymentId],
        );

        const { withTenant, ANONYMOUS } = await import('../src/db/tenant.js');
        try {
            await withTenant(ANONYMOUS, async (client) => {
                const role = await client.query<{ current_user: string }>('SELECT current_user');
                assert.equal(role.rows[0]!.current_user, 'hq_app');

                await client.query('SAVEPOINT cross_business_negative');
                await assert.rejects(
                    client.query(
                        `SELECT * FROM apply_verified_payment_event(
                            'mock_mobile_money', $1, $2, 9999, 'USD', true, 500,
                            '{"source":"cross-business-negative"}'::jsonb
                        )`,
                        [`app-role-negative-${phase4dSequence}`, unrelated.providerReference],
                    ),
                    /payment amount, currency, or provider does not match/,
                );
                await client.query('ROLLBACK TO SAVEPOINT cross_business_negative');
                await client.query('RELEASE SAVEPOINT cross_business_negative');

                await client.query(
                    `SELECT * FROM apply_verified_payment_event(
                        'mock_mobile_money', $1, $2, 1000, 'USD', true, 500,
                        '{"source":"hq_app_anonymous_test"}'::jsonb
                    )`,
                    [`app-role-late-${phase4dSequence}`, linked.providerReference],
                );
            });
        } finally {
            await appPool.query('RESET ROLE');
        }

        const { rows } = await adminPool.query<{
            linked_status: string;
            linked_reconciliation: string;
            unrelated_status: string;
            unrelated_reconciliation: string;
        }>(
            `SELECT lp.status AS linked_status, lp.reconciliation_status AS linked_reconciliation,
                    up.status AS unrelated_status, up.reconciliation_status AS unrelated_reconciliation
               FROM payments lp CROSS JOIN payments up
              WHERE lp.payment_id = $1 AND up.payment_id = $2`,
            [linked.paymentId, unrelated.paymentId],
        );
        assert.equal(rows[0]!.linked_status, 'succeeded');
        assert.equal(rows[0]!.linked_reconciliation, 'refund_review_required');
        assert.equal(rows[0]!.unrelated_status, 'pending');
        assert.equal(rows[0]!.unrelated_reconciliation, 'none');
        const { rows: afterUnrelated } = await adminPool.query<{
            status: string;
            reconciliation_status: string;
            order_status: string;
        }>(
            `SELECT p.status, p.reconciliation_status, o.order_status
               FROM payments p JOIN orders o ON o.order_id = p.order_id
              WHERE p.payment_id = $1`,
            [unrelated.paymentId],
        );
        assert.deepEqual(afterUnrelated[0], beforeUnrelated[0]);
    });

    it('keeps late-payment reconciliation isolated across businesses', async () => {
        const { rows: otherBusinesses } = await adminPool.query<{ business_id: string }>(
            `INSERT INTO businesses
                (business_name, business_slug, business_description, phone, email, city, district,
                 status, verification_status, is_verified, verified_at)
             VALUES ('Payments Isolation Shop', 'payments-isolation-shop', 'Payments isolation test',
                     '+252610000002', 'payments-isolation@hq.test', 'Mogadishu', 'Hodan',
                     'active', 'verified', true, now())
             RETURNING business_id`,
        );
        const otherBusinessId = Number(otherBusinesses[0]!.business_id);
        const fixtureA = await createPhase4dPayment();
        const fixtureB = await createPhase4dPayment({ businessId: otherBusinessId });
        await adminPool.query(
            `UPDATE orders SET order_status = 'cancelled', cancelled_at = now()
             WHERE order_id IN ($1, $2)`,
            [fixtureA.orderId, fixtureB.orderId],
        );
        await applyLateSuccess(fixtureA.providerReference, `cross-business-a-${phase4dSequence}`);
        await applyLateSuccess(fixtureB.providerReference, `cross-business-b-${phase4dSequence}`);
        const { rows } = await adminPool.query<{ order_id: string; business_id: string; status: string }>(
            `SELECT o.order_id::text, o.business_id::text, p.status
               FROM orders o JOIN payments p ON p.order_id = o.order_id
              WHERE o.order_id IN ($1, $2)
              ORDER BY o.order_id`,
            [fixtureA.orderId, fixtureB.orderId],
        );
        assert.equal(rows.length, 2);
        assert.deepEqual(
            rows.map((row) => Number(row.business_id)).sort((left, right) => left - right),
            [businessId, otherBusinessId].sort((left, right) => left - right),
        );
        assert.ok(rows.every((row) => row.status === 'succeeded'));
    });

    it('rolls migration 061 back to the original signature and reapplies it forward', async () => {
        const { migrateDown, migrateUp } = await import('../src/db/migrator.js');
        const signature = 'apply_verified_payment_event(text,text,text,bigint,text,boolean,integer,jsonb)';
        const { rows: forwardPrivilegeBeforeDown } = await adminPool.query<{
            hq_app_execute: boolean;
            public_execute: boolean;
        }>(
            `SELECT
                has_function_privilege('hq_app', $1, 'EXECUTE') AS hq_app_execute,
                EXISTS (
                    SELECT 1
                      FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                      JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl ON true
                     WHERE n.nspname = 'public'
                       AND p.proname = 'apply_verified_payment_event'
                       AND acl.grantee = 0
                       AND acl.privilege_type = 'EXECUTE'
                       AND acl.is_grantable = false
                ) AS public_execute`,
            [signature],
        );
        assert.equal(forwardPrivilegeBeforeDown[0]!.hq_app_execute, true);
        assert.equal(forwardPrivilegeBeforeDown[0]!.public_execute, false);

        const rolledBack = await migrateDown({ allowDataLoss: true });
        assert.equal(rolledBack, '061_late_success_payment_reconciliation');

        const { rows: downRows } = await adminPool.query<{ pronargs: number }>(
            `SELECT p.pronargs
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname = 'apply_verified_payment_event'`
        );
        assert.equal(downRows.length, 1);
        assert.equal(downRows[0]!.pronargs, 8);
        const { rows: downPrivileges } = await adminPool.query<{
            hq_app_execute: boolean;
            public_execute: boolean;
        }>(
            `SELECT
                has_function_privilege('hq_app', $1, 'EXECUTE') AS hq_app_execute,
                EXISTS (
                    SELECT 1
                      FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                      JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl ON true
                     WHERE n.nspname = 'public'
                       AND p.proname = 'apply_verified_payment_event'
                       AND acl.grantee = 0
                       AND acl.privilege_type = 'EXECUTE'
                ) AS public_execute`,
            [signature],
        );
        assert.equal(downPrivileges[0]!.hq_app_execute, true);
        assert.equal(downPrivileges[0]!.public_execute, false);
        const { rows: originalReturnRows } = await adminPool.query<{ columns: string }>(
            `SELECT pg_get_function_result(p.oid) AS columns
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname = 'apply_verified_payment_event'`
        );
        assert.doesNotMatch(originalReturnRows[0]!.columns, /reconciliation_required/i);

        const reapplied = await migrateUp();
        assert.ok(reapplied.includes('061_late_success_payment_reconciliation'));
        const { rows: forwardRows } = await adminPool.query<{ columns: string }>(
            `SELECT pg_get_function_result(p.oid) AS columns
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname = 'apply_verified_payment_event'`
        );
        assert.match(forwardRows[0]!.columns, /reconciliation_required/i);
        const { rows: grantRows } = await adminPool.query<{ can_execute: boolean }>(
            `SELECT has_function_privilege('hq_app',
                'apply_verified_payment_event(text,text,text,bigint,text,boolean,integer,jsonb)',
                'EXECUTE') AS can_execute`
        );
        assert.equal(grantRows[0]!.can_execute, true);
    });
});
