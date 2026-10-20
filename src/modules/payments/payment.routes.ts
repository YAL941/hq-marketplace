import { Router } from 'express';
import { z } from 'zod';
import { ANONYMOUS, withTenant } from '../../db/tenant.js';
import { AppError, badRequest, notFound, unauthorized } from '../../db/errors.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { config } from '../../config.js';
import { applyVerifiedPaymentEvent, createPayment, findOwnedPayment } from './payment.repository.js';
import { getPaymentProvider, listPaymentMethods } from './payment.providers.js';
import { PAYMENT_PROVIDERS, type PaymentProviderName } from './payment.types.js';
import { MockMobileMoneyProvider } from './mock-mobile-money.provider.js';
import { notifyPaidPaymentSafely } from '../notifications/notification.service.js';

const createPaymentSchema = z.object({
    provider: z.enum(PAYMENT_PROVIDERS),
});

const writeLimiter = rateLimiter('write');
const webhookLimiter = rateLimiter('public');

export const paymentRoutes: Router = Router();

paymentRoutes.get('/payments/methods', (_req, res) => {
    res.json({ data: listPaymentMethods() });
});

paymentRoutes.post(
    '/orders/mine/:orderId/payments',
    writeLimiter,
    authenticate,
    async (req, res, next) => {
        try {
            const orderId = Number(req.params['orderId']);
            if (!Number.isSafeInteger(orderId) || orderId <= 0) throw notFound('Order not found');
            const { provider } = createPaymentSchema.parse(req.body);
            const method = listPaymentMethods().find((option) => option.name === provider);
            if (!method?.available || (config.isProduction && method.testOnly)) {
                throw new AppError(
                    503,
                    'PAYMENT_PROVIDER_UNAVAILABLE',
                    'Online payment is not configured. Orders must be paid when placed.',
                );
            }
            const idempotencyKey = req.header('Idempotency-Key')?.trim();
            if (!idempotencyKey || idempotencyKey.length > 200) {
                throw badRequest('A valid Idempotency-Key header is required');
            }
            const payment = await withTenant(contextFor(req), (client) =>
                createPayment(client, req.user!.id, orderId, provider, idempotencyKey),
            );
            res.status(201).json({ data: payment });
        } catch (error) {
            next(error);
        }
    },
);

async function processWebhook(
    providerName: PaymentProviderName,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
) {
    const provider = getPaymentProvider(providerName);
    if (!provider) throw notFound('Payment provider is not available');
    const event = provider.verifyWebhook(headers, rawBody);
    if (!event) throw unauthorized('Webhook signature or payload is invalid');
    return withTenant(ANONYMOUS, (client) => applyVerifiedPaymentEvent(client, providerName, event));
}

paymentRoutes.post('/payments/webhooks/:provider', webhookLimiter, async (req, res, next) => {
    try {
        const parsedProvider = z.enum(PAYMENT_PROVIDERS).safeParse(req.params['provider']);
        if (!parsedProvider.success) throw notFound('Payment provider not found');
        if (!Buffer.isBuffer(req.body)) throw badRequest('Webhook body must be JSON bytes');
        const result = await processWebhook(parsedProvider.data, req.body, req.headers);
        if (result.payment_status === 'paid' && !result.duplicate) {
            await notifyPaidPaymentSafely(String(result.payment_id));
        }
        res.json({ data: result });
    } catch (error) {
        next(error);
    }
});

paymentRoutes.post(
    '/payments/:paymentId/mock-complete',
    writeLimiter,
    authenticate,
    async (req, res, next) => {
        try {
            if (config.isProduction || !config.mockMobileMoneyEnabled) {
                throw notFound('Route not found');
            }
            const paymentId = Number(req.params['paymentId']);
            if (!Number.isSafeInteger(paymentId) || paymentId <= 0) throw notFound('Payment not found');

            const event = await withTenant(contextFor(req), async (client) => {
                const payment = await findOwnedPayment(client, req.user!.id, paymentId);
                if (payment.provider !== 'mock_mobile_money') throw notFound('Payment not found');
                if (payment.status !== 'pending') throw badRequest('Only a pending mock payment can be completed');
                const provider = getPaymentProvider('mock_mobile_money');
                if (!(provider instanceof MockMobileMoneyProvider)) throw notFound('Payment provider is not available');
                const signature = provider.createSignedSuccessEvent({
                    paymentId: payment.payment_id,
                    providerReference: payment.provider_reference,
                    amountMinor: payment.amount_minor,
                    currency: payment.currency,
                });
                const event = provider.verifyWebhook(
                    {
                        'x-mock-timestamp': signature.timestamp,
                        'x-mock-signature': signature.signature,
                    },
                    signature.rawBody,
                );
                if (!event) throw unauthorized('Generated mock webhook could not be verified');
                return event;
            });
            const result = await withTenant(ANONYMOUS, (client) =>
                applyVerifiedPaymentEvent(client, 'mock_mobile_money', event),
            );
            if (result.payment_status === 'paid' && !result.duplicate) {
                await notifyPaidPaymentSafely(String(result.payment_id));
            }
            res.json({ data: result });
        } catch (error) {
            next(error);
        }
    },
);
