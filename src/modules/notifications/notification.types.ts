export const NOTIFICATION_LANGUAGES = ['ar', 'en', 'so'] as const;
export type NotificationLanguage = (typeof NOTIFICATION_LANGUAGES)[number];
export type NotificationChannel = 'sms' | 'whatsapp';
export type NotificationEventType = 'new_order' | 'order_status_changed' | 'payment_confirmed';

export interface NotificationMessage {
    to: string;
    body: string;
    eventType: NotificationEventType;
    orderId: string;
}

export interface NotificationProvider {
    readonly channel: NotificationChannel;
    send(message: NotificationMessage): Promise<void>;
}

export interface OrderNotificationContext {
    orderId: string;
    orderNumber: string;
    businessId: string;
    businessName: string;
    businessPhone: string | null;
    customerId: string;
    customerPhone: string | null;
    language: NotificationLanguage;
    orderStatus: string;
}
