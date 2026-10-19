import { withTenant } from '../../db/tenant.js';
import type { NotificationLanguage, OrderNotificationContext } from './notification.types.js';

interface OrderNotificationRow {
    order_id: string;
    order_number: string;
    business_id: string;
    business_name: string;
    business_phone: string | null;
    customer_id: string;
    account_phone: string | null;
    customer_phone: string | null;
    notification_language: string;
    order_status: string;
}

export async function getOrderNotificationContext(
    orderId: string,
    customerId: number,
): Promise<OrderNotificationContext | null> {
    return withTenant({ userId: customerId, isPlatformAdmin: false, businessId: null }, async (client) => {
        const { rows } = await client.query<OrderNotificationRow>(
            `SELECT o.order_id, o.order_number, o.business_id, b.business_name, b.phone AS business_phone,
                    o.customer_id, u.phone AS account_phone, o.customer_phone,
                    o.notification_language, o.order_status
               FROM orders o
               JOIN businesses b ON b.business_id = o.business_id
               JOIN users u ON u.user_id = o.customer_id
              WHERE o.order_id = $1 AND o.customer_id = $2`,
            [orderId, customerId],
        );
        const row = rows[0];
        if (!row) return null;
        return {
            orderId: row.order_id,
            orderNumber: row.order_number,
            businessId: row.business_id,
            businessName: row.business_name,
            businessPhone: row.business_phone,
            customerId: row.customer_id,
            customerPhone: row.customer_phone ?? row.account_phone,
            language: isNotificationLanguage(row.notification_language) ? row.notification_language : 'en',
            orderStatus: row.order_status,
        };
    });
}

export async function getPaidOrderNotificationContext(
    paymentId: string,
): Promise<{ customerId: number; orderId: string } | null> {
    return withTenant({ userId: null, isPlatformAdmin: false, businessId: null }, async (client) => {
        const { rows } = await client.query<{ customer_id: string; order_id: string; notification_language: string }>(
            'SELECT * FROM app_payment_notification_customer($1)',
            [paymentId],
        );
        const row = rows[0];
        if (!row) return null;
        return {
            customerId: Number(row.customer_id),
            orderId: row.order_id,
        };
    });
}

function isNotificationLanguage(value: string): value is NotificationLanguage {
    return value === 'ar' || value === 'en' || value === 'so';
}
