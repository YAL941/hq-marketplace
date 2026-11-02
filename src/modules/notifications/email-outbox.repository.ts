import type { PoolClient } from 'pg';

/** Enqueues the merchant email in the transaction that inserted the order. */
export async function enqueueNewOrderEmail(client: PoolClient, orderId: string): Promise<string | null> {
    const { rows } = await client.query<{ outbox_id: string | null }>(
        'SELECT public.enqueue_new_order_email($1) AS outbox_id', [orderId],
    );
    return rows[0]?.outbox_id ?? null;
}

/** Enqueues the customer's status email using the committed state transition timestamp. */
export async function enqueueOrderStatusEmail(
    client: PoolClient,
    businessId: string,
    orderId: string,
): Promise<string | null> {
    const { rows } = await client.query<{ outbox_id: string | null }>(`
        SELECT public.enqueue_notification_email(
            'order:' || o.order_id::TEXT || ':status:' || o.order_status::TEXT || ':'
                || pg_catalog.to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'),
            'order.status_changed', 'order.status_changed', o.customer_id,
            o.notification_language, o.business_id, o.order_id, NULL,
            pg_catalog.jsonb_build_object('order_number', o.order_number, 'status', o.order_status::TEXT)
        ) AS outbox_id
          FROM public.orders AS o
         WHERE o.order_id = $1 AND o.business_id = $2
    `, [orderId, businessId]);
    return rows[0]?.outbox_id ?? null;
}

/** Enqueues only the requested on_the_way delivery milestone. */
export async function enqueueOnTheWayEmail(client: PoolClient, orderId: string): Promise<string | null> {
    const { rows } = await client.query<{ outbox_id: string | null }>(`
        SELECT public.enqueue_notification_email(
            'order:' || o.order_id::TEXT || ':delivery:' || o.delivery_status || ':'
                || pg_catalog.to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'),
            'delivery.status_changed', 'delivery.status_changed', o.customer_id,
            o.notification_language, o.business_id, o.order_id, NULL,
            pg_catalog.jsonb_build_object('order_number', o.order_number, 'delivery_status', o.delivery_status)
        ) AS outbox_id
          FROM public.orders AS o
         WHERE o.order_id = $1 AND o.delivery_status = 'on_the_way'
    `, [orderId]);
    return rows[0]?.outbox_id ?? null;
}

/**
 * Call after the signed provider event was applied, while still inside that
 * transaction. Recipient identity and locale come from the restricted
 * successful-payment lookup, never from webhook fields.
 */
export async function enqueueSuccessfulPaymentEmail(
    client: PoolClient,
    paymentId: string,
): Promise<string | null> {
    const { rows: recipientRows } = await client.query<{
        customer_id: string;
        order_id: string;
        notification_language: 'ar' | 'en' | 'so';
    }>('SELECT * FROM public.app_payment_notification_customer($1)', [paymentId]);
    const recipient = recipientRows[0];
    if (!recipient) return null;

    // The signed webhook and the restricted DB lookup establish this user
    // context within the current transaction; it is not request-supplied.
    await client.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [recipient.customer_id]);
    const { rows: orderRows } = await client.query<{
        order_id: string;
        business_id: string;
        order_number: string;
        currency: string;
    }>(`
        SELECT o.order_id, o.business_id, o.order_number, o.currency
          FROM public.orders AS o
         WHERE o.order_id = $1 AND o.customer_id = $2
    `, [recipient.order_id, recipient.customer_id]);
    const order = orderRows[0];
    if (!order) return null;

    const { rows } = await client.query<{ outbox_id: string | null }>(`
        SELECT public.enqueue_notification_email(
            'payment:' || p.payment_id::TEXT || ':succeeded',
            'payment.succeeded', 'payment.succeeded', p.customer_id,
            $2, o.business_id, o.order_id, p.payment_id,
            pg_catalog.jsonb_build_object('order_number', o.order_number)
        ) AS outbox_id
          FROM public.payments AS p
          JOIN public.orders AS o ON o.order_id = p.order_id
         WHERE p.payment_id = $1 AND p.order_id = $3
           AND p.status = 'succeeded' AND p.customer_id = $4
    `, [paymentId, recipient.notification_language, order.order_id, recipient.customer_id]);
    return rows[0]?.outbox_id ?? null;
}
