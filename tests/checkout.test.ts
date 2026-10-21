import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildCheckoutOrderInput,
    estimateCheckoutTotal,
    isCheckoutDraft,
} from '../frontend/src/lib/checkout.js';
import type { CheckoutDraft } from '../frontend/src/types/index.js';

const draft: CheckoutDraft = {
    businessId: 12,
    businessName: 'Local shop',
    businessSlug: 'local-shop',
    currency: 'USD',
    items: [{
        productId: 34,
        itemName: 'Coffee',
        quantity: 2,
        unitPrice: '3.50',
        imageUrl: null,
    }],
    deliveryRequested: false,
    locationConsent: false,
};

describe('customer checkout', () => {
    it('accepts a valid product draft and rejects an item without exactly one catalogue id', () => {
        assert.equal(isCheckoutDraft(draft), true);
        assert.equal(isCheckoutDraft({
            ...draft,
            items: [{ ...draft.items[0]!, productId: undefined }],
        }), false);
        assert.equal(isCheckoutDraft({
            ...draft,
            items: [{ ...draft.items[0]!, serviceId: 45 }],
        }), false);
    });

    it('rejects delivery drafts without consent, coordinates, and a usable phone', () => {
        assert.equal(isCheckoutDraft({
            ...draft,
            deliveryRequested: true,
        }), false);
        assert.equal(isCheckoutDraft({
            ...draft,
            deliveryRequested: true,
            locationConsent: true,
            deliveryLatitude: 2.04,
            deliveryLongitude: 45.32,
            customerPhone: '+252612345678',
            deliveryAddress: '123 Main St',
        }), true);
    });

    it('builds the order request with the supported payment method and service booking time', () => {
        const input = buildCheckoutOrderInput({
            ...draft,
            items: [{
                serviceId: 56,
                itemName: 'Consultation',
                quantity: 1,
                unitPrice: '10.00',
            }],
            scheduledFor: '2026-10-20T09:00:00.000Z',
        }, 'mock_mobile_money');
        assert.deepEqual(input, {
            businessId: 12,
            items: [{ serviceId: 56, quantity: 1 }],
            scheduledFor: '2026-10-20T09:00:00.000Z',
            deliveryRequested: false,
            locationConsent: false,
            paymentMethod: 'mock_mobile_money',
            notificationLanguage: 'en',
        });
    });

    it('keeps the selected checkout language for future order notifications', () => {
        assert.equal(buildCheckoutOrderInput(draft, 'mock_mobile_money', 'ar').notificationLanguage, 'ar');
        assert.equal(buildCheckoutOrderInput(draft, 'mock_mobile_money', 'so').notificationLanguage, 'so');
        assert.equal(buildCheckoutOrderInput(draft, 'mock_mobile_money', 'fr').notificationLanguage, 'en');
    });

    it('includes delivery location, contact, consent, and note when delivery is selected at checkout', () => {
        assert.deepEqual(buildCheckoutOrderInput({
            ...draft,
            deliveryRequested: true,
            locationConsent: true,
            deliveryLatitude: 2.04,
            deliveryLongitude: 45.32,
            deliveryNote: 'Near the main road',
            customerPhone: '+252612345678',
            deliveryAddress: '123 Main St',
        }, 'mock_mobile_money'), {
            businessId: 12,
            items: [{ productId: 34, quantity: 2 }],
            deliveryRequested: true,
            locationConsent: true,
            deliveryLatitude: 2.04,
            deliveryLongitude: 45.32,
            deliveryNote: 'Near the main road',
            customerPhone: '+252612345678',
            deliveryAddress: '123 Main St',
            paymentMethod: 'mock_mobile_money',
            notificationLanguage: 'en',
        });
    });

    it('estimates item totals and adds the selected business delivery fee', () => {
        assert.equal(estimateCheckoutTotal(draft), 7);
        assert.equal(estimateCheckoutTotal({
            ...draft,
            deliveryRequested: true,
            locationConsent: true,
            deliveryLatitude: 2.04,
            deliveryLongitude: 45.32,
            customerPhone: '+252612345678',
            deliveryFee: '1.25',
        }), 8.25);
    });
});
