import { randomUUID } from 'node:crypto';
import { BasePaymentProvider } from './payment.provider.js';
import type { PaymentInitialization } from './payment.types.js';

export class CashOnDeliveryProvider extends BasePaymentProvider {
    readonly name = 'cash_on_delivery' as const;

    async initialize(input: {
        orderId: string;
        amountMinor: bigint;
        currency: string;
        idempotencyKey: string;
    }): Promise<PaymentInitialization> {
        void input;
        return {
            providerReference: `cod_${input.orderId}_${randomUUID()}`,
            providerData: { collection: 'on_delivery' },
        };
    }

    verifyWebhook(): null {
        return null;
    }
}
