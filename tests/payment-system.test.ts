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
            assert.equal(providers.isMockMobileMoneyAllowedFor('customer@example.com', settings), true);
            assert.equal(providers.isMockMobileMoneyAllowedFor(null, settings), true);
            assert.equal(
                providers.isMockMobileMoneyAllowedFor('tester@example.com', { ...settings, enabled: false }),
                false,
            );
            assert.equal(providers.listPaymentMethods('tester@example.com')[0]?.available, true);
            assert.equal(providers.listPaymentMethods('customer@example.com')[0]?.available, true);
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
});
