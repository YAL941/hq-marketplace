import type { PaymentInitialization, PaymentProvider, PaymentProviderName } from './payment.types.js';

export class PaymentProviderError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PaymentProviderError';
    }
}

export abstract class BasePaymentProvider implements PaymentProvider {
    abstract readonly name: PaymentProviderName;

    abstract initialize(input: {
        orderId: string;
        amountMinor: bigint;
        currency: string;
        idempotencyKey: string;
    }): Promise<PaymentInitialization>;

    abstract verifyWebhook(
        headers: Record<string, string | string[] | undefined>,
        rawBody: Buffer,
    ): ReturnType<PaymentProvider['verifyWebhook']>;
}
