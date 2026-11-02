import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../src/config.js';
import {
    EMAIL_LOCALES,
    EMAIL_TEMPLATE_KEYS,
    renderMarketplaceEmail,
    type EmailLocale,
    type EmailTemplateKey,
} from '../src/modules/notifications/email-templates.js';

const expectedSubjects: Record<EmailLocale, Record<EmailTemplateKey, string>> = {
    en: {
        'order.created': 'New order received',
        'order.status_changed': 'Your order status changed',
        'payment.succeeded': 'Payment successful',
        'delivery.status_changed': 'Your order is on the way',
    },
    ar: {
        'order.created': 'استلم النشاط طلبًا جديدًا',
        'order.status_changed': 'تحديث حالة طلبك',
        'payment.succeeded': 'تم الدفع بنجاح',
        'delivery.status_changed': 'طلبك في الطريق إليك',
    },
    so: {
        'order.created': 'Dalab cusub ayaa yimid',
        'order.status_changed': 'Xaaladda dalabkaaga waa la beddelay',
        'payment.succeeded': 'Lacag-bixintu way guulaysatay',
        'delivery.status_changed': 'Dalabkaagu jidka ayuu ku jiraa',
    },
};

describe('marketplace email templates', () => {
    for (const locale of EMAIL_LOCALES) {
        for (const templateKey of EMAIL_TEMPLATE_KEYS) {
            it(`renders ${templateKey} in ${locale} with subject, HTML, and text`, () => {
                const template = renderMarketplaceEmail(templateKey, locale, {
                    orderNumber: 'ORD-1042',
                    businessName: 'Daryeel Store',
                    status: 'ready',
                    amount: '12.50',
                    currency: 'USD',
                    orderUrl: new URL('/orders/1042', config.PUBLIC_APP_URL).toString(),
                });
                assert.equal(template.subject, expectedSubjects[locale][templateKey]);
                assert.match(template.html, /<html lang="/);
                assert.match(template.html, /href="/);
                assert.match(template.text, /ORD-1042/);
                if (templateKey === 'order.created' || templateKey === 'order.status_changed') {
                    assert.match(template.text, /Daryeel Store/);
                }
                assert.equal(template.html.includes('dir="rtl"'), locale === 'ar');
                assert.equal(template.html.includes('dir="ltr"'), locale !== 'ar');
                assert.equal(template.html.includes('out_for_delivery'), false);
                assert.equal(template.text.includes('<html'), false);
            });
        }
    }

    it('escapes dynamic HTML values and does not include delivery confirmation codes', () => {
        const htmlInjection = '<img src=x onerror="alert(1)"> & "buyer"';
        const template = renderMarketplaceEmail('order.status_changed', 'en', {
            orderNumber: '<script>1</script>',
            businessName: htmlInjection,
            status: 'ready',
            orderUrl: new URL('/orders/1', config.PUBLIC_APP_URL).toString(),
            ...({ deliveryConfirmationCode: 'SECRET-CODE-123' } as object),
        });
        assert.equal(template.html.includes(htmlInjection), false);
        assert.match(template.html, /&lt;script&gt;1&lt;&#x2F;script&gt;|&lt;script&gt;1&lt;\/script&gt;/);
        assert.match(template.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &quot;buyer&quot;/);
        assert.equal(template.html.includes('SECRET-CODE-123'), false);
        assert.equal(template.text.includes('SECRET-CODE-123'), false);
    });

    it('rejects invalid, foreign-origin, and credential-bearing order URLs', () => {
        const base = { orderNumber: 'ORD-1', businessName: 'Store' };
        assert.throws(() => renderMarketplaceEmail('order.created', 'en', { ...base, orderUrl: 'javascript:alert(1)' }), /Invalid order URL/);
        assert.throws(() => renderMarketplaceEmail('order.created', 'en', { ...base, orderUrl: 'https://attacker.example/orders/1' }), /Invalid order URL/);
        const withCredentials = new URL('/orders/1', config.PUBLIC_APP_URL);
        withCredentials.username = 'user';
        withCredentials.password = 'password';
        assert.throws(() => renderMarketplaceEmail('order.created', 'en', { ...base, orderUrl: withCredentials.toString() }), /Invalid order URL/);
    });

    it('omits an action link when no order URL is supplied', () => {
        const template = renderMarketplaceEmail('payment.succeeded', 'so', {
            orderNumber: 'ORD-2', businessName: 'Duka', amount: '10', currency: 'USD',
        });
        assert.equal(template.html.includes('<a href='), false);
        assert.equal(template.text.includes('Eeg dalabka:'), false);
    });
});
