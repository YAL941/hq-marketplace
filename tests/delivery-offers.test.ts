process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;
let customerToken: string;
let courierToken: string;
let orderId: string;
let mockSmsProvider: import('../src/modules/notifications/mock-sms.provider.js').MockSmsProvider;
let mockWhatsAppProvider: import('../src/modules/notifications/mock-whatsapp.provider.js').MockWhatsAppProvider;

before(async () => {
    const notifications = await import('../src/modules/notifications/notification.service.js');
    mockSmsProvider = notifications.mockSmsProvider;
    mockWhatsAppProvider = notifications.mockWhatsAppProvider;
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const { rows: users } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ('delivery-offer-customer@hq.test', 'unused', 'Offer Customer', 'active'),
                ('delivery-offer-courier@hq.test', 'unused', 'Offer Courier', 'active')
         RETURNING user_id`,
    );
    const courierId = users[1]!.user_id;
    await adminPool.query(
        `UPDATE users SET phone = '+252611111222' WHERE user_id = $1`,
        [courierId],
    );
    const customerId = users[0]!.user_id;
    const [{ signAccessToken }, { rows: businesses }] = await Promise.all([
        import('../src/middleware/auth.js'),
        adminPool.query<{ business_id: string }>(
            `INSERT INTO businesses
                (business_name, business_slug, address, city, status, verification_status, is_verified, verified_at)
             VALUES ('Delivery Offer Shop', 'delivery-offer-shop', 'Shop pickup address', 'Mogadishu',
                     'active', 'verified', TRUE, now())
             RETURNING business_id`,
        ),
    ]);
    const businessId = businesses[0]!.business_id;
    await adminPool.query(
        'INSERT INTO business_couriers (business_id, user_id) VALUES ($1, $2)',
        [businessId, courierId],
    );
    const { rows: orders } = await adminPool.query<{ order_id: string }>(
        `INSERT INTO orders (
            business_id, customer_id, order_status, subtotal, delivery_fee, total_amount, currency,
            delivery_requested, location_consent, location_consent_at, delivery_latitude,
            delivery_longitude, delivery_address, delivery_note, customer_phone, delivery_status
         )
         VALUES ($1, $2, 'ready', 10, 2, 12, 'USD',
                 TRUE, TRUE, now(), 2.0469, 45.3182, 'Customer full address',
                 'Blue gate, second street', '+252611234567', 'waiting')
         RETURNING order_id`,
        [businessId, customerId],
    );
    orderId = orders[0]!.order_id;
    customerToken = signAccessToken({
        id: Number(customerId),
        email: 'delivery-offer-customer@hq.test',
        isPlatformAdmin: false,
        token_version: 0,
    });
    courierToken = signAccessToken({
        id: Number(courierId),
        email: 'delivery-offer-courier@hq.test',
        isPlatformAdmin: false,
        token_version: 0,
    });
});

after(async () => {
    await closePools?.();
});

describe('courier delivery price offers', () => {
    it('shows route details, waits for customer approval, and applies the accepted price', async () => {
        mockSmsProvider.clear();
        mockWhatsAppProvider.clear();
        const completedAfter = encodeURIComponent(new Date(0).toISOString());
        const available = await request(app)
            .get(`/api/courier/deliveries?completedAfter=${completedAfter}`)
            .set('Authorization', `Bearer ${courierToken}`);
        assert.equal(available.status, 200);
        const delivery = available.body.data.available.find(
            (item: { order_id: string }) => item.order_id === orderId,
        );
        assert.equal(delivery.delivery_address, 'Customer full address');
        assert.equal(delivery.delivery_note, 'Blue gate, second street');
        assert.equal(delivery.customer_phone, '+252611234567');

        const firstOffer = await request(app)
            .post(`/api/courier/deliveries/${orderId}/offer`)
            .set('Authorization', `Bearer ${courierToken}`)
            .send({ proposedEarningAmount: '5.00' });
        assert.equal(firstOffer.status, 200);
        assert.equal(firstOffer.body.data.delivery_status, 'offer_pending');

        const customerOrders = await request(app)
            .get('/api/orders/mine')
            .set('Authorization', `Bearer ${customerToken}`);
        const pendingOrder = customerOrders.body.data.find(
            (item: { order_id: string }) => item.order_id === orderId,
        );
        assert.equal(pendingOrder.delivery_status, 'offer_pending');
        assert.equal(pendingOrder.delivery_earning_amount, '5.00');
        assert.equal(pendingOrder.total_amount, '15.00');
        assert.equal(pendingOrder.courier_phone, null);

        const courierOffers = await request(app)
            .get(`/api/courier/deliveries?completedAfter=${completedAfter}`)
            .set('Authorization', `Bearer ${courierToken}`);
        assert.equal(courierOffers.body.data.pendingOffers.length, 1);
        assert.equal(courierOffers.body.data.pendingOffers[0].order_id, orderId);

        const decline = await request(app)
            .post(`/api/orders/mine/${orderId}/delivery-offer-response`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ accept: false });
        assert.equal(decline.status, 200);
        assert.equal(decline.body.data.delivery_status, 'waiting');

        const reoffered = await request(app)
            .post(`/api/courier/deliveries/${orderId}/offer`)
            .set('Authorization', `Bearer ${courierToken}`)
            .send({ proposedEarningAmount: '6.25' });
        assert.equal(reoffered.status, 200);

        const accept = await request(app)
            .post(`/api/orders/mine/${orderId}/delivery-offer-response`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ accept: true });
        assert.equal(accept.status, 200);
        assert.equal(accept.body.data.delivery_status, 'assigned');
        assert.equal(accept.body.data.delivery_fee, '6.25');
        assert.equal(accept.body.data.total_amount, '16.25');

        const acceptedOrder = await request(app)
            .get('/api/orders/mine')
            .set('Authorization', `Bearer ${customerToken}`);
        const finalOrder = acceptedOrder.body.data.find(
            (item: { order_id: string }) => item.order_id === orderId,
        );
        assert.match(finalOrder.delivery_confirmation_code, /^\d{4}$/);
        assert.equal(finalOrder.courier_phone, '+252611111222');

        const activeDeliveries = await request(app)
            .get(`/api/courier/deliveries?completedAfter=${completedAfter}`)
            .set('Authorization', `Bearer ${courierToken}`);
        assert.equal(activeDeliveries.body.data.pendingOffers.length, 0);
        assert.equal(activeDeliveries.body.data.assigned[0].order_id, orderId);

        const pickedUp = await request(app)
            .patch(`/api/courier/deliveries/${orderId}/status`)
            .set('Authorization', `Bearer ${courierToken}`)
            .send({ deliveryStatus: 'picked_up' });
        assert.equal(pickedUp.status, 200, JSON.stringify(pickedUp.body));
        assert.equal(pickedUp.body.data.order_status, 'out_for_delivery');
        assert.equal(mockSmsProvider.delivered.length, 1);
        assert.equal(mockSmsProvider.delivered[0]!.eventType, 'order_status_changed');
        assert.equal(mockSmsProvider.delivered[0]!.to, '+252611234567');
        assert.equal(mockWhatsAppProvider.delivered.length, 1);
    });
});
