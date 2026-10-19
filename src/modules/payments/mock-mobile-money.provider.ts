import { randomUUID } from 'node:crypto';
import { BasePaymentProvider } from './payment.provider.js';
import { createWebhookSignature, verifyWebhookSignature } from './webhook-signature.js';
import type { PaymentInitialization, VerifiedPaymentEvent } from './payment.types.js';

interface MockWebhookPayload {
    id?: unknown;
    reference?: unknown;
    amount_minor?: unknown;
    currency?: unknown;
    status?: unknown;
}

export class MockMobileMoneyProvider extends BasePaymentProvider {
    readonly name = 'mock_mobile_money' as const;

    constructor(private readonly webhookSecret: string) {
        super();
        if (webhookSecret.length < 32) {
            throw new Error('Mock mobile money webhook secret must be at least 32 characters');
        }
    }

    async initialize(input: {
        orderId: string;
        amountMinor: bigint;
        currency: string;
        idempotencyKey: string;
    }): Promise<PaymentInitialization> {
        void input;
        return {
            providerReference: `mock_${randomUUID()}`,
            providerData: {
                simulated: true,
                instructions: 'Complete this simulated payment in the development checkout.',
            },
        };
    }

    verifyWebhook(
        headers: Record<string, string | string[] | undefined>,
        rawBody: Buffer,
    ): VerifiedPaymentEvent | null {
        if (!verifyWebhookSignature(this.webhookSecret, headers, rawBody)) return null;

        let payload: MockWebhookPayload;
        try {
            payload = JSON.parse(rawBody.toString('utf8')) as MockWebhookPayload;
        } catch {
            return null;
        }

        if (
            typeof payload.id !== 'string' || !payload.id.trim() || payload.id.length > 200 ||
            typeof payload.reference !== 'string' || !payload.reference.trim() || payload.reference.length > 200 ||
            typeof payload.amount_minor !== 'string' || !/^(0|[1-9]\d{0,17})$/.test(payload.amount_minor) ||
            typeof payload.currency !== 'string' || !/^[A-Z]{3}$/.test(payload.currency) ||
            (payload.status !== 'succeeded' && payload.status !== 'failed')
        ) {
            return null;
        }

        return {
            eventId: payload.id,
            providerReference: payload.reference,
            amountMinor: BigInt(payload.amount_minor),
            currency: payload.currency,
            succeeded: payload.status === 'succeeded',
            payload: payload as Record<string, unknown>,
        };
    }

    createSignedSuccessEvent(input: {
        paymentId: string;
        providerReference: string;
        amountMinor: string;
        currency: string;
        timestamp?: string;
    }): { rawBody: Buffer; timestamp: string; signature: string } {
        const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
        const rawBody = Buffer.from(JSON.stringify({
            id: `mock_evt_${input.paymentId}`,
            reference: input.providerReference,
            amount_minor: input.amountMinor,
            currency: input.currency,
            status: 'succeeded',
        }));
        return {
            rawBody,
            timestamp,
            signature: createWebhookSignature(this.webhookSecret, timestamp, rawBody),
        };
    }
}
