import { config } from '../../config.js';

export const EMAIL_TEMPLATE_KEYS = [
    'order.created',
    'order.status_changed',
    'payment.succeeded',
    'delivery.status_changed',
] as const;

export const EMAIL_LOCALES = ['en', 'ar', 'so'] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export interface EmailTemplateData {
    orderNumber: string;
    businessName?: string;
    status?: string;
    amount?: string;
    currency?: string;
    orderUrl?: string;
}

export interface RenderedEmailTemplate {
    subject: string;
    html: string;
    text: string;
}

interface Copy {
    title: string;
    subject: Record<EmailTemplateKey, string>;
    body: Record<EmailTemplateKey, (data: EmailTemplateData) => string>;
    order: string;
    footer: string;
    action: string;
}

const copy: Record<EmailLocale, Copy> = {
    en: {
        title: 'Marketplace update',
        subject: {
            'order.created': 'New order received',
            'order.status_changed': 'Your order status changed',
            'payment.succeeded': 'Payment successful',
            'delivery.status_changed': 'Your order is on the way',
        },
        body: {
            'order.created': (d) => `A new order was placed with ${d.businessName ?? 'the merchant'}.`,
            'order.status_changed': (d) => `The status of your order with ${d.businessName ?? 'the merchant'} is now ${statusLabel('en', d.status)}.`,
            'payment.succeeded': (d) => `Payment for your order was successful${amountText(d)}.`,
            'delivery.status_changed': () => 'Your order is on the way.',
        },
        order: 'Order', footer: 'Thank you for using OmniHQ Marketplace.', action: 'View order',
    },
    ar: {
        title: 'تحديث من السوق',
        subject: {
            'order.created': 'استلم النشاط طلبًا جديدًا',
            'order.status_changed': 'تحديث حالة طلبك',
            'payment.succeeded': 'تم الدفع بنجاح',
            'delivery.status_changed': 'طلبك في الطريق إليك',
        },
        body: {
            'order.created': (d) => `استلم ${d.businessName ?? 'المتجر'} طلبًا جديدًا.`,
            'order.status_changed': (d) => `أصبحت حالة طلبك لدى ${d.businessName ?? 'المتجر'}: ${statusLabel('ar', d.status)}.`,
            'payment.succeeded': (d) => `تم الدفع بنجاح لطلبك${amountText(d)}.`,
            'delivery.status_changed': () => 'طلبك في الطريق إليك.',
        },
        order: 'رقم الطلب', footer: 'شكرًا لاستخدامك سوق OmniHQ.', action: 'عرض الطلب',
    },
    so: {
        title: 'Cusboonaysiin suuqa',
        subject: {
            'order.created': 'Dalab cusub ayaa yimid',
            'order.status_changed': 'Xaaladda dalabkaaga waa la beddelay',
            'payment.succeeded': 'Lacag-bixintu way guulaysatay',
            'delivery.status_changed': 'Dalabkaagu jidka ayuu ku jiraa',
        },
        body: {
            'order.created': (d) => `${d.businessName ?? 'ganacsiga'} waxaa loo diray dalab cusub.`,
            'order.status_changed': (d) => `Xaaladda dalabkaaga ee ${d.businessName ?? 'ganacsiga'} hadda waa ${statusLabel('so', d.status)}.`,
            'payment.succeeded': (d) => `Lacag-bixinta dalabkaaga way guulaysatay${amountText(d)}.`,
            'delivery.status_changed': () => 'Dalabkaagu jidka ayuu ku jiraa.',
        },
        order: 'Dalab', footer: 'Waad ku mahadsan tahay isticmaalka Suuqa OmniHQ.', action: 'Eeg dalabka',
    },
};

export function renderMarketplaceEmail(
    templateKey: EmailTemplateKey,
    locale: EmailLocale,
    data: EmailTemplateData,
): RenderedEmailTemplate {
    if (!EMAIL_TEMPLATE_KEYS.includes(templateKey) || !EMAIL_LOCALES.includes(locale)) {
        throw new Error('Unsupported email template or locale');
    }
    const validatedUrl = data.orderUrl === undefined ? undefined : validateOrderUrl(data.orderUrl);
    const direction = locale === 'ar' ? 'rtl' : 'ltr';
    const localized = copy[locale];
    const body = localized.body[templateKey](data);
    const orderLine = `${localized.order}: ${data.orderNumber}`;
    const actionHtml = validatedUrl
        ? `<p style="margin:24px 0"><a href="${escapeHtml(validatedUrl)}" style="display:inline-block;padding:12px 20px;background:#175cd3;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(localized.action)}</a></p>`
        : '';
    const actionText = validatedUrl ? `\n${localized.action}: ${validatedUrl}` : '';
    const html = `<!doctype html>
<html lang="${locale}" dir="${direction}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(localized.subject[templateKey])}</title></head>
<body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#172b4d;line-height:1.6;direction:${direction}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
      <tr><td style="padding:22px 28px;background:#102a56;color:#ffffff;font-size:20px;font-weight:700">OmniHQ Marketplace</td></tr>
      <tr><td style="padding:28px"><h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(localized.title)}</h1>
        <p style="margin:0 0 12px">${escapeHtml(body)}</p><p style="margin:0;color:#475467">${escapeHtml(orderLine)}</p>
        ${actionHtml}<hr style="border:0;border-top:1px solid #eaecf0;margin:24px 0"><p style="margin:0;color:#667085;font-size:13px">${escapeHtml(localized.footer)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    const text = `${localized.title}\n\n${body}\n${orderLine}${actionText}\n\n${localized.footer}`;
    return { subject: localized.subject[templateKey], html, text };
}

function amountText(data: EmailTemplateData): string {
    if (data.amount === undefined || data.currency === undefined) return '';
    return ` (${data.amount} ${data.currency})`;
}

function statusLabel(locale: EmailLocale, status?: string): string {
    const labels: Record<EmailLocale, Record<string, string>> = {
        en: {
            pending: 'pending', confirmed: 'confirmed', in_progress: 'in progress', ready: 'ready',
            out_for_delivery: 'out for delivery', completed: 'completed', cancelled: 'cancelled',
            rejected: 'rejected', refunded: 'refunded',
        },
        ar: {
            pending: 'قيد الانتظار', confirmed: 'تم التأكيد', in_progress: 'قيد التنفيذ', ready: 'جاهز',
            out_for_delivery: 'خرج للتوصيل', completed: 'مكتمل', cancelled: 'ملغى',
            rejected: 'مرفوض', refunded: 'مسترد',
        },
        so: {
            pending: 'sugaya', confirmed: 'la xaqiijiyay', in_progress: 'socda', ready: 'diyaar',
            out_for_delivery: 'jidka ku jira', completed: 'dhammaaday', cancelled: 'la joojiyay',
            rejected: 'la diiday', refunded: 'la soo celiyay',
        },
    };
    return labels[locale][status ?? ''] ?? (locale === 'ar' ? 'تم التحديث' : locale === 'so' ? 'la cusboonaysiiyay' : 'updated');
}

function validateOrderUrl(value: string): string {
    let candidate: URL;
    let allowedOrigin: URL;
    try {
        candidate = new URL(value);
        allowedOrigin = new URL(config.PUBLIC_APP_URL);
    } catch {
        throw new Error('Invalid order URL');
    }
    if (!['https:', 'http:'].includes(candidate.protocol)
        || candidate.origin !== allowedOrigin.origin
        || candidate.username !== '' || candidate.password !== '') {
        throw new Error('Invalid order URL');
    }
    return candidate.toString();
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]!);
}
