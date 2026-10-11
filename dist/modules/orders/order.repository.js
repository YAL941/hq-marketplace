import { badRequest, conflict, forbidden, notFound } from '../../db/errors.js';
import { assertPermission } from '../services/service.repository.js';
const round = (n) => Math.round(n * 100) / 100;
/**
 * Creates an order for the CURRENT user against ONE business.
 *
 * Prices are read and frozen here (unit_price snapshot), so a later price
 * change never rewrites historical orders. Every lookup is restricted to
 * the order's business, and the composite foreign keys in the schema make
 * it impossible to attach another business's product to this order.
 */
export async function createOrder(client, customerId, input) {
    if (input.items.length === 0) {
        throw badRequest('An order must contain at least one item');
    }
    const deliveryRequested = input.deliveryRequested ?? false;
    if (deliveryRequested) {
        if (!input.locationConsent)
            throw badRequest('Explicit consent to share the delivery location is required');
        if (input.deliveryLatitude === undefined || input.deliveryLongitude === undefined
            || input.deliveryLatitude === null || input.deliveryLongitude === null) {
            throw badRequest('A delivery location is required');
        }
        if (!input.customerPhone?.trim())
            throw badRequest('A customer phone number is required for delivery');
    }
    else if (input.locationConsent || input.deliveryLatitude != null || input.deliveryLongitude != null) {
        throw badRequest('Pickup orders cannot include delivery location data');
    }
    const snapshots = [];
    let containsService = false;
    for (const item of input.items) {
        const quantity = item.quantity ?? 1;
        if (quantity <= 0)
            throw badRequest('Quantity must be greater than zero');
        if (item.productId !== undefined) {
            const { rows } = await client.query(`SELECT * FROM reserve_order_product($1, $2, $3)`, [item.productId, input.businessId, quantity]);
            const product = rows[0];
            if (!product || product.reservation_status === 'not_found') {
                throw notFound(`Product ${item.productId} is not available in this business`);
            }
            if (product.reservation_status === 'shortage') {
                throw conflict(`Product ${item.productId} does not have enough stock`);
            }
            const unitPrice = Number(product.discount_price ?? product.price);
            snapshots.push({
                itemType: 'product',
                productId: item.productId,
                serviceId: null,
                itemName: product.product_name,
                quantity,
                unitPrice,
                totalPrice: round(unitPrice * quantity),
                currency: product.currency,
            });
        }
        else if (item.serviceId !== undefined) {
            const { rows } = await client.query(`SELECT service_name, price, currency, is_bookable
                   FROM services
                  WHERE service_id = $1 AND business_id = $2 AND deleted_at IS NULL AND status = 'active'`, [item.serviceId, input.businessId]);
            const service = rows[0];
            if (!service)
                throw notFound(`Service ${item.serviceId} is not available in this business`);
            if (!service.is_bookable)
                throw badRequest(`Service ${item.serviceId} is not bookable`);
            containsService = true;
            const unitPrice = Number(service.price);
            snapshots.push({
                itemType: 'service',
                productId: null,
                serviceId: item.serviceId,
                itemName: service.service_name,
                quantity,
                unitPrice,
                totalPrice: round(unitPrice * quantity),
                currency: service.currency,
            });
        }
        else {
            throw badRequest('Each item needs a productId or a serviceId');
        }
    }
    if (containsService && !input.scheduledFor) {
        throw badRequest('A booking time is required for service orders');
    }
    if (input.scheduledFor && new Date(input.scheduledFor).getTime() <= Date.now()) {
        throw badRequest('A booking time must be in the future');
    }
    const currencies = new Set(snapshots.map((item) => item.currency.toUpperCase()));
    if (currencies.size !== 1)
        throw badRequest('All items in an order must use the same currency');
    const subtotal = round(snapshots.reduce((sum, item) => sum + item.totalPrice, 0));
    const { rows: businessRows } = await client.query('SELECT delivery_enabled, delivery_fee FROM businesses WHERE business_id = $1', [input.businessId]);
    const businessDelivery = businessRows[0];
    if (!businessDelivery)
        throw notFound('Business not found');
    if (deliveryRequested && !businessDelivery.delivery_enabled) {
        throw badRequest('This business does not currently offer delivery');
    }
    const deliveryFee = deliveryRequested ? Number(businessDelivery.delivery_fee) : 0;
    const discount = 0;
    const tax = 0;
    const total = round(subtotal + deliveryFee);
    const currency = snapshots[0].currency.toUpperCase();
    const hasProduct = snapshots.some((i) => i.itemType === 'product');
    const hasService = snapshots.some((i) => i.itemType === 'service');
    const orderType = hasProduct && hasService ? 'mixed' : hasService ? 'service' : 'product';
    const { rows: orderRows } = await client.query(`INSERT INTO orders
            (business_id, customer_id, location_id, order_type, subtotal, delivery_fee,
             discount_amount, tax_amount, total_amount, currency, customer_note,
             delivery_address, scheduled_for, delivery_requested, location_consent,
             location_consent_at, delivery_latitude, delivery_longitude, delivery_note,
             customer_phone, payment_method)
         VALUES ($1, $2, $3, $4::order_type, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, CASE WHEN $15 THEN now() ELSE NULL END, $16, $17, $18, $19, $20)
         RETURNING *`, [
        input.businessId,
        customerId,
        input.locationId ?? null,
        orderType,
        subtotal,
        deliveryFee,
        discount,
        tax,
        total,
        currency,
        input.customerNote ?? null,
        input.deliveryAddress ?? null,
        input.scheduledFor ?? null,
        deliveryRequested,
        input.locationConsent ?? false,
        deliveryRequested ? input.deliveryLatitude : null,
        deliveryRequested ? input.deliveryLongitude : null,
        deliveryRequested ? input.deliveryNote?.trim() ?? null : null,
        deliveryRequested ? input.customerPhone?.trim() ?? null : null,
        input.paymentMethod ?? 'cash_on_delivery',
    ]);
    const order = orderRows[0];
    for (const item of snapshots) {
        await client.query(`INSERT INTO order_items
                (order_id, business_id, product_id, service_id, item_type, item_name, quantity, unit_price, total_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
            order.order_id,
            input.businessId,
            item.productId,
            item.serviceId,
            item.itemType,
            item.itemName,
            item.quantity,
            item.unitPrice,
            item.totalPrice,
        ]);
    }
    return order;
}
export async function listOrdersForBusiness(client, businessId, q) {
    const conditions = ['o.business_id = $1'];
    const params = [businessId];
    if (q.orderStatus) {
        params.push(q.orderStatus);
        conditions.push(`o.order_status = $${params.length}`);
    }
    if (q.customerId !== undefined) {
        params.push(q.customerId);
        conditions.push(`o.customer_id = $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, 100));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;
    const { rows } = await client.query(`SELECT o.*,
                order_preview.item_name AS preview_item_name,
                order_preview.image_url AS preview_image_url
           FROM orders o
           LEFT JOIN LATERAL (
               SELECT oi.item_name, p.image_url
                 FROM order_items oi
                 LEFT JOIN products p ON p.product_id = oi.product_id
                WHERE oi.order_id = o.order_id
                ORDER BY oi.order_item_id
                LIMIT 1
           ) order_preview ON TRUE
          WHERE ${conditions.join(' AND ')}
          ORDER BY o.created_at DESC, o.order_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    return rows;
}
export async function listOrderItems(client, orderId) {
    const { rows } = await client.query(`SELECT oi.order_item_id, oi.product_id, oi.service_id, oi.item_type, oi.item_name,
                oi.quantity, oi.unit_price, oi.total_price, oi.notes, p.image_url, p.ingredients
           FROM order_items oi
           LEFT JOIN products p ON p.product_id = oi.product_id
          WHERE oi.order_id = $1
          ORDER BY oi.order_item_id`, [orderId]);
    return rows;
}
export async function updateOrderStatus(client, businessId, orderId, orderStatus) {
    await assertPermission(client, businessId, 'orders.update');
    const transitions = {
        pending: ['confirmed', 'cancelled', 'rejected'],
        confirmed: ['in_progress', 'cancelled'],
        in_progress: ['ready', 'cancelled'],
        ready: ['out_for_delivery', 'completed', 'cancelled'],
        out_for_delivery: ['completed', 'cancelled'],
    };
    const { rows: currentRows } = await client.query('SELECT order_status, delivery_requested, delivery_status FROM orders WHERE order_id = $1 AND business_id = $2', [orderId, businessId]);
    const currentOrder = currentRows[0];
    const currentStatus = currentOrder?.order_status;
    if (!currentStatus)
        throw notFound('Order not found in this business');
    const allowedTransitions = currentOrder.delivery_requested
        ? {
            ...transitions,
            in_progress: ['ready', 'cancelled'],
            ready: ['cancelled'],
            out_for_delivery: [],
        }
        : {
            ...transitions,
            ready: ['out_for_delivery', 'completed', 'cancelled'],
        };
    if (!allowedTransitions[currentStatus]?.includes(orderStatus)) {
        throw badRequest(`Order cannot transition from ${currentStatus} to ${orderStatus}`);
    }
    const assignments = ['order_status = $3'];
    if (orderStatus === 'confirmed')
        assignments.push('confirmed_at = now()');
    if (orderStatus === 'completed')
        assignments.push('completed_at = now()');
    if (orderStatus === 'cancelled')
        assignments.push('cancelled_at = now()');
    if (orderStatus === 'ready' && currentOrder.delivery_requested) {
        assignments.push("delivery_status = 'waiting'");
    }
    if (orderStatus === 'cancelled' && currentOrder.delivery_requested) {
        assignments.push("delivery_status = 'not_applicable'");
        assignments.push('delivery_courier_id = NULL');
        assignments.push('delivery_confirmation_code = NULL');
        assignments.push('delivery_earning_amount = NULL');
    }
    const { rows } = await client.query(`UPDATE orders
            SET ${assignments.join(', ')}
          WHERE order_id = $1 AND business_id = $2 AND order_status = $4 AND delivery_status = $5
          RETURNING *`, [orderId, businessId, orderStatus, currentStatus, currentOrder.delivery_status]);
    if (!rows[0])
        throw conflict('Order status changed before this update could be applied');
    return rows[0];
}
/** A customer may cancel their own order while it is still pending. */
export async function cancelOwnOrder(client, customerId, orderId, reason) {
    const { rows } = await client.query(`UPDATE orders
            SET order_status = 'cancelled', cancelled_at = now(), cancellation_reason = $3
          WHERE order_id = $1 AND customer_id = $2 AND order_status = 'pending'
          RETURNING *`, [orderId, customerId, reason ?? null]);
    if (!rows[0])
        throw forbidden('Only a pending order you placed can be cancelled');
    return rows[0];
}
export async function getOrderForBusiness(client, businessId, orderId) {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_id = $1 AND business_id = $2', [orderId, businessId]);
    if (!rows[0])
        throw notFound('Order not found in this business');
    return rows[0];
}
export async function getOwnOrder(client, customerId, orderId) {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_id = $1 AND customer_id = $2', [orderId, customerId]);
    if (!rows[0])
        throw notFound('Order not found');
    return rows[0];
}
//# sourceMappingURL=order.repository.js.map