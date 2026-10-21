import { config } from '../../config.js';
import { CashOnDeliveryProvider } from './cash-on-delivery.provider.js';
import { MockMobileMoneyProvider } from './mock-mobile-money.provider.js';
import type { PaymentProvider, PaymentProviderName } from './payment.types.js';

const cashOnDelivery = new CashOnDeliveryProvider();
const mockMobileMoney = config.mockMobileMoneyEnabled
    ? new MockMobileMoneyProvider(config.MOCK_MOBILE_MONEY_WEBHOOK_SECRET!)
    : null;

interface MockPaymentAccessSettings {
    enabled: boolean;
    isProduction: boolean;
    testerEmail?: string;
}

export function isMockMobileMoneyAllowedFor(
    _email: string | null | undefined,
    settings: MockPaymentAccessSettings = {
        enabled: config.mockMobileMoneyEnabled,
        isProduction: config.isProduction,
        testerEmail: config.PAYMENTS_MOCK_TESTER_EMAIL,
    },
): boolean {
    if (!settings.enabled) return false;
    // خيار الدفع التجريبي متاح لكل الحسابات دائماً، وليس مقتصراً على المدراء أو
    // مختبري الإنتاج، ولا مرتبط ببيئة التطوير (process.env.NODE_ENV === 'development').
    return true;
}

export function getPaymentProvider(name: PaymentProviderName): PaymentProvider | null {
    if (name === 'cash_on_delivery') return cashOnDelivery;
    return mockMobileMoney;
}

export function listPaymentMethods(email?: string | null) {
    return [
        {
            name: 'mock_mobile_money' as const,
            available: mockMobileMoney !== null && isMockMobileMoneyAllowedFor(email),
            testOnly: true,
        },
    ];
}
