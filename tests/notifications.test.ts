import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotificationService } from '../src/modules/notifications/notification.service.js';
import { renderNotification } from '../src/modules/notifications/notification.templates.js';
import type { NotificationMessage, NotificationProvider } from '../src/modules/notifications/notification.types.js';

const context = {
    orderId: '42',
    orderNumber: 'HQ-0042',
    businessId: '8',
    businessName: 'Tijaabo Market',
    businessPhone: '+252610000008',
    customerId: '17',
    customerPhone: '+252610000017',
    language: 'so' as const,
    orderStatus: 'confirmed',
    deliveryConfirmationCode: null,
};

describe('notification templates and providers', () => {
    it('renders each notification trigger in Arabic, English and Somali', () => {
        for (const language of ['ar', 'en', 'so'] as const) {
            for (const eventType of ['new_order', 'order_status_changed', 'payment_confirmed'] as const) {
                const message = renderNotification(eventType, language, {
                    orderNumber: 'HQ-0042',
                    businessName: 'Test Market',
                    orderStatus: 'confirmed',
                });
                assert.ok(message.length > 0);
                assert.ok(message.includes('HQ-0042'));
            }
        }
        assert.match(renderNotification('payment_confirmed', 'ar', {
            orderNumber: 'HQ-0042',
            businessName: 'Test Market',
        }), /تم تأكيد الدفع/);
        assert.match(renderNotification('order_status_changed', 'so', {
            orderNumber: 'HQ-0042',
            businessName: 'Test Market',
            orderStatus: 'confirmed',
        }), /la xaqiijiyay/);
        assert.match(renderNotification('order_status_changed', 'ar', {
            orderNumber: 'HQ-0042',
            businessName: 'Test Market',
            orderStatus: 'out_for_delivery',
            deliveryConfirmationCode: '1234',
        }), /1234/);
    });

    it('routes new-order notices to the merchant and status/payment notices to the customer', async () => {
        const delivered: Array<{ channel: string; message: NotificationMessage }> = [];
        const providers: NotificationProvider[] = (['sms', 'whatsapp'] as const).map((channel) => ({
            channel,
            async send(message) {
                delivered.push({ channel, message });
            },
        }));
        const service = new NotificationService(providers);

        await service.send('new_order', context.orderId, context);
        await service.send('order_status_changed', context.orderId, context);
        await service.send('payment_confirmed', context.orderId, context);

        assert.equal(delivered.length, 6);
        assert.deepEqual(delivered.filter((entry) => entry.message.eventType === 'new_order')
            .map((entry) => entry.message.to), [context.businessPhone, context.businessPhone]);
        assert.deepEqual(delivered.filter((entry) => entry.message.eventType !== 'new_order')
            .map((entry) => entry.message.to), Array(4).fill(context.customerPhone));
        assert.ok(delivered.every((entry) => entry.message.body.length > 0));
    });

    it('continues sending on the other channel when one provider throws', async () => {
        const delivered: NotificationMessage[] = [];
        const providers: NotificationProvider[] = [
            {
                channel: 'sms',
                async send() {
                    throw new Error('mock SMS failure');
                },
            },
            {
                channel: 'whatsapp',
                async send(message) {
                    delivered.push(message);
                },
            },
        ];
        const service = new NotificationService(providers);
        const originalWarn = console.warn;
        console.warn = () => undefined;
        try {
            await assert.doesNotReject(service.send('payment_confirmed', context.orderId, context));
        } finally {
            console.warn = originalWarn;
        }
        assert.equal(delivered.length, 1);
        assert.equal(delivered[0]!.to, context.customerPhone);
    });
});
