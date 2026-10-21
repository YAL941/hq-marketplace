import { config } from '../../config.js';
import { getOrderNotificationContext, getPaidOrderNotificationContext } from './notification.repository.js';
import { renderNotification } from './notification.templates.js';
import { MockSmsProvider } from './mock-sms.provider.js';
import { MockWhatsAppProvider } from './mock-whatsapp.provider.js';
import type {
    NotificationEventType,
    NotificationMessage,
    NotificationProvider,
} from './notification.types.js';

export class NotificationService {
    constructor(private readonly providers: readonly NotificationProvider[]) {}

    async send(eventType: NotificationEventType, orderId: string, context: Awaited<ReturnType<typeof getOrderNotificationContext>>): Promise<void> {
        if (!context) return;
        const recipient = eventType === 'new_order' ? context.businessPhone : context.customerPhone;
        if (!recipient) {
            console.warn(`[notifications] skipped ${eventType} for order ${orderId}: recipient has no phone number`);
            return;
        }
        if (this.providers.length === 0) {
            console.warn(`[notifications] skipped ${eventType} for order ${orderId}: no notification providers configured`);
            return;
        }

        const message: NotificationMessage = {
            to: recipient,
            body: renderNotification(eventType, context.language, {
                orderNumber: context.orderNumber,
                businessName: context.businessName,
                orderStatus: context.orderStatus,
                deliveryConfirmationCode: context.deliveryConfirmationCode,
            }),
            eventType,
            orderId,
        };
        await Promise.all(this.providers.map(async (provider) => {
            try {
                await provider.send(message);
            } catch (error) {
                const reason = error instanceof Error ? error.message : 'Unknown provider error';
                console.warn(`[notifications] ${provider.channel} send failed for ${eventType}, order ${orderId}: ${reason}`);
            }
        }));
    }
}

export const mockSmsProvider = new MockSmsProvider();
export const mockWhatsAppProvider = new MockWhatsAppProvider();

export const notificationService = new NotificationService(
    config.isProduction ? [] : [mockSmsProvider, mockWhatsAppProvider],
);

export async function notifyOrderEventSafely(
    eventType: NotificationEventType,
    orderId: string,
    customerId: number,
): Promise<void> {
    try {
        const context = await getOrderNotificationContext(orderId, customerId);
        if (!context) {
            console.warn(`[notifications] skipped ${eventType} for order ${orderId}: notification context unavailable`);
            return;
        }
        await notificationService.send(eventType, orderId, context);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown notification error';
        console.warn(`[notifications] processing failed for ${eventType}, order ${orderId}: ${reason}`);
    }
}

export async function notifyPaidPaymentSafely(paymentId: string): Promise<void> {
    try {
        const context = await getPaidOrderNotificationContext(paymentId);
        if (!context) {
            console.warn(`[notifications] skipped payment confirmation for payment ${paymentId}: not a verified successful payment`);
            return;
        }
        await notifyOrderEventSafely('payment_confirmed', context.orderId, context.customerId);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown notification error';
        console.warn(`[notifications] processing failed for payment ${paymentId}: ${reason}`);
    }
}
