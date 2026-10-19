export const PAYMENT_PROVIDERS = ['cash_on_delivery', 'mock_mobile_money'] as const;

export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

export interface PaymentInitialization {
    providerReference: string;
    providerData: Record<string, unknown>;
}

export interface VerifiedPaymentEvent {
    eventId: string;
    providerReference: string;
    amountMinor: bigint;
    currency: string;
    succeeded: boolean;
    payload: Record<string, unknown>;
}

export interface PaymentProvider {
    readonly name: PaymentProviderName;
    initialize(input: {
        orderId: string;
        amountMinor: bigint;
        currency: string;
        idempotencyKey: string;
    }): Promise<PaymentInitialization>;
    verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): VerifiedPaymentEvent | null;
}

export interface PaymentMethodOption {
    name: PaymentProviderName;
    available: boolean;
    testOnly: boolean;
}

export interface PaymentRecord {
    payment_id: string;
    order_id: string;
    customer_id: string;
    provider: PaymentProviderName;
    payment_method: PaymentProviderName;
    status: PaymentStatus;
    amount_minor: string;
    currency: string;
    provider_reference: string;
    idempotency_key: string;
    provider_event_id: string | null;
    commission_minor: string | null;
    merchant_amount_minor: string | null;
    rate_used_bps: number | null;
    provider_data: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
    paid_at: Date | null;
}
