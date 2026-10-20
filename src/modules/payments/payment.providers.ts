import { config } from '../../config.js';
import { CashOnDeliveryProvider } from './cash-on-delivery.provider.js';
import { MockMobileMoneyProvider } from './mock-mobile-money.provider.js';
import type { PaymentProvider, PaymentProviderName } from './payment.types.js';

const cashOnDelivery = new CashOnDeliveryProvider();
const mockMobileMoney = config.mockMobileMoneyEnabled
    ? new MockMobileMoneyProvider(config.MOCK_MOBILE_MONEY_WEBHOOK_SECRET!)
    : null;

export function getPaymentProvider(name: PaymentProviderName): PaymentProvider | null {
    if (name === 'cash_on_delivery') return cashOnDelivery;
    return mockMobileMoney;
}

export function listPaymentMethods() {
    return [
        { name: 'mock_mobile_money' as const, available: mockMobileMoney !== null, testOnly: true },
    ];
}
