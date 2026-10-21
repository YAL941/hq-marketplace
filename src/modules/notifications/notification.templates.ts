import type { NotificationEventType, NotificationLanguage } from './notification.types.js';

interface TemplateInput {
    orderNumber: string;
    businessName: string;
    orderStatus?: string;
    deliveryConfirmationCode?: string | null;
}

type NotificationTemplate = (input: TemplateInput) => string;
type EventTemplates = Record<NotificationLanguage, NotificationTemplate>;

const statusLabels: Record<NotificationLanguage, Record<string, string>> = {
    ar: {
        pending: 'قيد الانتظار',
        confirmed: 'تم التأكيد',
        in_progress: 'قيد التنفيذ',
        ready: 'جاهز',
        out_for_delivery: 'خرج للتوصيل',
        completed: 'مكتمل',
        cancelled: 'ملغى',
        rejected: 'مرفوض',
    },
    en: {
        pending: 'pending',
        confirmed: 'confirmed',
        in_progress: 'in progress',
        ready: 'ready',
        out_for_delivery: 'out for delivery',
        completed: 'completed',
        cancelled: 'cancelled',
        rejected: 'rejected',
    },
    so: {
        pending: 'sugaya',
        confirmed: 'la xaqiijiyay',
        in_progress: 'socda',
        ready: 'diyaar',
        out_for_delivery: 'la geeyay',
        completed: 'dhammaaday',
        cancelled: 'la joojiyay',
        rejected: 'la diiday',
    },
};

const templates: Record<NotificationEventType, EventTemplates> = {
    new_order: {
        ar: ({ orderNumber, businessName }) => `لديك طلب جديد (${orderNumber}) لنشاط ${businessName}.`,
        en: ({ orderNumber, businessName }) => `New order ${orderNumber} was placed with ${businessName}.`,
        so: ({ orderNumber, businessName }) => `Dalab cusub ${orderNumber} ayaa loo sameeyay ganacsiga ${businessName}.`,
    },
    order_status_changed: {
        ar: ({ orderNumber, businessName, orderStatus, deliveryConfirmationCode }) =>
            `تحدّثت حالة طلبك ${orderNumber} لدى ${businessName} إلى ${statusLabels.ar[orderStatus ?? ''] ?? 'حالة جديدة'}.${orderStatus === 'out_for_delivery' && deliveryConfirmationCode ? ` رمز استلام التوصيل: ${deliveryConfirmationCode}.` : ''}`,
        en: ({ orderNumber, businessName, orderStatus, deliveryConfirmationCode }) =>
            `Your order ${orderNumber} with ${businessName} is now ${statusLabels.en[orderStatus ?? ''] ?? 'updated'}.${orderStatus === 'out_for_delivery' && deliveryConfirmationCode ? ` Delivery confirmation code: ${deliveryConfirmationCode}.` : ''}`,
        so: ({ orderNumber, businessName, orderStatus, deliveryConfirmationCode }) =>
            `Xaaladda dalabkaaga ${orderNumber} ee ${businessName} hadda waa ${statusLabels.so[orderStatus ?? ''] ?? 'la cusboonaysiiyay'}.${orderStatus === 'out_for_delivery' && deliveryConfirmationCode ? ` Koodhka xaqiijinta gaarsiinta: ${deliveryConfirmationCode}.` : ''}`,
    },
    payment_confirmed: {
        ar: ({ orderNumber, businessName }) => `تم تأكيد الدفع للطلب ${orderNumber} لدى ${businessName}.`,
        en: ({ orderNumber, businessName }) => `Payment was confirmed for order ${orderNumber} with ${businessName}.`,
        so: ({ orderNumber, businessName }) => `Lacag-bixinta dalabka ${orderNumber} ee ${businessName} waa la xaqiijiyay.`,
    },
};

export function renderNotification(
    eventType: NotificationEventType,
    language: NotificationLanguage,
    input: TemplateInput,
): string {
    return templates[eventType][language](input);
}
