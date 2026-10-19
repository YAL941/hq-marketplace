import type { PoolClient } from 'pg';
import { badRequest, conflict, notFound } from '../../db/errors.js';
import { config } from '../../config.js';
import { decimalToMinorUnits } from './money.js';
import { getPaymentProvider } from './payment.providers.js';
import type { PaymentProviderName, PaymentRecord, VerifiedPaymentEvent } from './payment.types.js';

interface OrderForPayment {
    order_id: string;
    customer_id: string;
    payment_method: PaymentProviderName;
    payment_status: string;
    order_status: string;
    total_amount: string;
    subtotal: string;
    currency: string;
}

export async function createPayment(
    client: PoolClient,
    customerId: number,
    orderId: number,
    providerName: PaymentProviderName,
    idempotencyKey: string,
): Promise<PaymentRecord> {
    await client.query(
        'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
        [0x5041594d, orderId],
    );
    const { rows: orderRows } = await client.query<OrderForPayment>(
        `SELECT order_id, customer_id, payment_method, payment_status, order_status,
                total_amount, subtotal, currency
           FROM orders
          WHERE order_id = $1 AND customer_id = $2`,
        [orderId, customerId],
    );
    const order = orderRows[0];
    if (!order) throw notFound('Order not found');
    if (order.payment_method !== providerName) {
        throw badRequest('Payment provider does not match the method selected for this order');
    }
    if (['cancelled', 'rejected', 'refunded'].includes(order.order_status)) {
        throw conflict('This order is no longer eligible for payment');
    }

    const { rows: existingAttempts } = await client.query<PaymentRecord>(
        `SELECT * FROM payments
          WHERE order_id = $1 AND idempotency_key = $2`,
        [orderId, idempotencyKey],
    );
    if (existingAttempts[0]) return existingAttempts[0];
    if (order.payment_status === 'paid') throw conflict('Order already has a successful payment');
    if (order.payment_status !== 'pending') throw conflict('This order cannot accept another payment attempt');

    const { rows: pendingRows } = await client.query<{ payment_id: string }>(
        `SELECT payment_id FROM payments
          WHERE order_id = $1 AND status = 'pending'
          LIMIT 1`,
        [orderId],
    );
    if (pendingRows[0]) throw conflict('A payment attempt is already pending for this order');

    const provider = getPaymentProvider(providerName);
    if (!provider) throw badRequest('This payment method is not currently available');

    const amountMinor = decimalToMinorUnits(order.total_amount);
    const initialized = await provider.initialize({
        orderId: order.order_id,
        amountMinor,
        currency: order.currency,
        idempotencyKey,
    });

    const { rows } = await client.query<PaymentRecord>(
        `INSERT INTO payments
            (order_id, customer_id, provider, payment_method, status, amount_minor, currency,
             provider_reference, idempotency_key, provider_data)
         VALUES ($1, $2, $3, $3, 'pending', $4, $5, $6, $7, $8::jsonb)
         RETURNING *`,
        [
            orderId,
            customerId,
            providerName,
            amountMinor.toString(),
            order.currency,
            initialized.providerReference,
            idempotencyKey,
            JSON.stringify(initialized.providerData),
        ],
    );
    if (!rows[0]) throw new Error('Payment insert returned no row');
    return rows[0];
}

export async function findOwnedPayment(
    client: PoolClient,
    customerId: number,
    paymentId: number,
): Promise<PaymentRecord> {
    const { rows } = await client.query<PaymentRecord>(
        `SELECT * FROM payments WHERE payment_id = $1 AND customer_id = $2`,
        [paymentId, customerId],
    );
    if (!rows[0]) throw notFound('Payment not found');
    return rows[0];
}

export async function applyVerifiedPaymentEvent(
    client: PoolClient,
    providerName: PaymentProviderName,
    event: VerifiedPaymentEvent,
) {
    const { rows } = await client.query<{
        payment_id: string;
        order_id: string;
        payment_status: string;
        duplicate: boolean;
    }>(
        `SELECT * FROM apply_verified_payment_event($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
            providerName,
            event.eventId,
            event.providerReference,
            event.amountMinor.toString(),
            event.currency,
            event.succeeded,
            config.PAYMENT_COMMISSION_BPS,
            JSON.stringify(event.payload),
        ],
    );
    if (!rows[0]) throw new Error('Verified payment event was not applied');
    return rows[0];
}
