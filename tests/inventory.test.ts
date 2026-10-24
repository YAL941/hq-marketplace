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
let ownerAToken: string;
let employeeAToken: string;
let ownerBToken: string;
let customerToken: string;
let customerId: number;
let businessA: number;
let businessB: number;
let locationA: number;
let secondLocationA: number;
let productId: number;

before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const { rows: users } = await adminPool.query<{ user_id: string; email: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ('stock-owner-a@hq.test', 'unused', 'Stock Owner A', 'active'),
                ('stock-employee-a@hq.test', 'unused', 'Stock Employee A', 'active'),
                ('stock-owner-b@hq.test', 'unused', 'Stock Owner B', 'active'),
                ('stock-customer@hq.test', 'unused', 'Stock Customer', 'active')
         RETURNING user_id, email`,
    );
    const userIds = new Map(users.map((user) => [user.email, Number(user.user_id)]));
    const ownerAId = userIds.get('stock-owner-a@hq.test')!;
    const employeeAId = userIds.get('stock-employee-a@hq.test')!;
    const ownerBId = userIds.get('stock-owner-b@hq.test')!;
    customerId = userIds.get('stock-customer@hq.test')!;
    const { signAccessToken } = await import('../src/middleware/auth.js');
    ownerAToken = signAccessToken({ id: ownerAId, email: 'stock-owner-a@hq.test', isPlatformAdmin: false, token_version: 0 });
    employeeAToken = signAccessToken({ id: employeeAId, email: 'stock-employee-a@hq.test', isPlatformAdmin: false, token_version: 0 });
    ownerBToken = signAccessToken({ id: ownerBId, email: 'stock-owner-b@hq.test', isPlatformAdmin: false, token_version: 0 });
    customerToken = signAccessToken({ id: customerId, email: 'stock-customer@hq.test', isPlatformAdmin: false, token_version: 0 });

    const { rows: businesses } = await adminPool.query<{ business_id: string; business_slug: string }>(
        `INSERT INTO businesses (
            business_name, business_slug, address, city, status,
            verification_status, is_verified, verified_at
         ) VALUES
            ('Stock Business A', 'stock-business-a', 'A address', 'Mogadishu', 'active', 'verified', TRUE, now()),
            ('Stock Business B', 'stock-business-b', 'B address', 'Mogadishu', 'active', 'verified', TRUE, now())
         RETURNING business_id, business_slug`,
    );
    businessA = Number(businesses.find((business) => business.business_slug === 'stock-business-a')!.business_id);
    businessB = Number(businesses.find((business) => business.business_slug === 'stock-business-b')!.business_id);

    const { rows: roles } = await adminPool.query<{ role_id: string; role_key: string }>(
        `SELECT role_id, role_key FROM roles WHERE role_key IN ('business_owner', 'business_employee') AND scope = 'business'`,
    );
    const roleIds = new Map(roles.map((role) => [role.role_key, Number(role.role_id)]));
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now()), ($1, $4, $5, 'active', now()),
                ($6, $7, $3, 'active', now())`,
        [businessA, ownerAId, roleIds.get('business_owner'), employeeAId,
            roleIds.get('business_employee'), businessB, ownerBId],
    );
    const { rows: locations } = await adminPool.query<{ location_id: string; location_name: string }>(
        `INSERT INTO business_locations (business_id, location_name, is_primary, is_active)
         VALUES ($1, 'Main branch', TRUE, TRUE), ($1, 'Second branch', FALSE, TRUE), ($2, 'Other business branch', TRUE, TRUE)
         RETURNING location_id, location_name`,
        [businessA, businessB],
    );
    locationA = Number(locations.find((location) => location.location_name === 'Main branch')!.location_id);
    secondLocationA = Number(locations.find((location) => location.location_name === 'Second branch')!.location_id);
});

after(async () => {
    await closePools?.();
});

async function createProduct(name: string, stock: number, minimumStock = 0) {
    const response = await request(app)
        .post(`/api/business/${businessA}/products`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
            productName: name,
            price: 10,
            currency: 'USD',
            sku: `${name.toLowerCase().replace(/\s+/g, '-')}-sku`,
            barcode: `${name.toLowerCase().replace(/\s+/g, '-')}-barcode`,
            unitOfMeasure: 'piece',
            minimumStock,
            stockQuantity: stock,
            status: 'active',
        });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return Number(response.body.data.product_id);
}

async function balanceOf(id: number, selectedLocation = locationA): Promise<number> {
    const { rows } = await adminPool.query<{ quantity: number }>(
        `SELECT quantity FROM inventory_balances
          WHERE business_id = $1 AND product_id = $2 AND location_id = $3`,
        [businessA, id, selectedLocation],
    );
    return Number(rows[0]?.quantity ?? 0);
}

async function stockMovement(body: Record<string, unknown>, token = ownerAToken, business = businessA) {
    return request(app)
        .post(`/api/business/${business}/inventory/movements`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
}

describe('HQ Stock inventory service', () => {
    it('creates product metadata and auditable opening stock, with thresholds in the dashboard', async () => {
        productId = await createProduct('Opening Stock Item', 5, 5);
        assert.equal(await balanceOf(productId), 5);

        const response = await request(app)
            .get(`/api/business/${businessA}/inventory?stockStatus=low`)
            .set('Authorization', `Bearer ${ownerAToken}`);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.data.summary.active_products, 1);
        assert.equal(response.body.data.summary.total_units, 5);
        assert.equal(response.body.data.summary.low_stock_products, 1);
        assert.equal(response.body.data.canManageInventory, true);
        assert.equal(response.body.data.products.rows[0].minimum_stock, 5);
        assert.equal(response.body.data.products.rows[0].unit_of_measure, 'piece');
        assert.equal(response.body.data.recentMovements[0].movement_type, 'opening_balance');

        const publicProducts = await request(app)
            .get(`/api/products?businessId=${businessA}`);
        assert.equal(publicProducts.status, 200, JSON.stringify(publicProducts.body));
        const publicProduct = publicProducts.body.data.find((row: { product_id: string }) => row.product_id === String(productId));
        assert.equal(publicProduct.barcode, undefined);
        assert.equal(publicProduct.minimum_stock, undefined);

        const edited = await request(app)
            .patch(`/api/business/${businessA}/products/${productId}`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ minimumStock: 6, barcode: 'edited-barcode' });
        assert.equal(edited.status, 200, JSON.stringify(edited.body));
        assert.equal(edited.body.data.minimum_stock, 6);
        assert.equal(edited.body.data.barcode, 'edited-barcode');
        assert.equal(await balanceOf(productId), 5);

        const directStockEdit = await request(app)
            .patch(`/api/business/${businessA}/products/${productId}`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ stockQuantity: 99 });
        assert.equal(directStockEdit.status, 400);
        assert.equal(await balanceOf(productId), 5);
    });

    it('records purchases, returns, and adjustments and rejects stock below zero', async () => {
        const purchase = await stockMovement({ productId, locationId: locationA, movementType: 'purchase', quantity: 4, note: 'supplier invoice 1' });
        assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
        assert.equal(purchase.body.data.previous_quantity, 5);
        assert.equal(purchase.body.data.resulting_quantity, 9);

        const returnPayload = {
            productId, locationId: locationA, movementType: 'return', quantity: 1,
            idempotencyKey: 'inventory-return-once',
        };
        const returned = await stockMovement(returnPayload);
        assert.equal(returned.status, 201);
        const replayedReturn = await stockMovement(returnPayload);
        assert.equal(replayedReturn.status, 200);
        assert.equal(replayedReturn.body.replayed, true);
        const changedReturn = await stockMovement({ ...returnPayload, quantity: 2 });
        assert.equal(changedReturn.status, 409);
        const adjusted = await stockMovement({ productId, locationId: locationA, movementType: 'adjustment_out', quantity: 2 });
        assert.equal(adjusted.status, 201);
        assert.equal(await balanceOf(productId), 8);

        const tooMuch = await stockMovement({ productId, locationId: locationA, movementType: 'adjustment_out', quantity: 9 });
        assert.equal(tooMuch.status, 409);
        assert.equal(await balanceOf(productId), 8);

        const invalidQuantity = await stockMovement({ productId, locationId: locationA, movementType: 'purchase', quantity: 0 });
        assert.equal(invalidQuantity.status, 400);
        const missingReturnKey = await stockMovement({ productId, locationId: locationA, movementType: 'return', quantity: 1 });
        assert.equal(missingReturnKey.status, 400);
    });

    it('rejects aggregate quantity updates that bypass the location ledger', async () => {
        const client = await adminPool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'UPDATE products SET stock_quantity = stock_quantity + 1 WHERE business_id = $1 AND product_id = $2',
                [businessA, productId],
            );
            await assert.rejects(
                client.query('COMMIT'),
                (error: { code?: string }) => error.code === '23514',
            );
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
        assert.equal(await balanceOf(productId), 8);
    });

    it('serializes concurrent receipts without losing quantity or ledger rows', async () => {
        const product = await createProduct('Concurrent Receipt Item', 0);
        const results = await Promise.all(Array.from({ length: 12 }, () =>
            stockMovement({ productId: product, locationId: locationA, movementType: 'purchase', quantity: 1 }),
        ));
        assert.ok(results.every((result) => result.status === 201));
        assert.equal(await balanceOf(product), 12);
        const { rows } = await adminPool.query<{ count: string }>(
            `SELECT COUNT(*)::TEXT AS count FROM stock_movements
              WHERE business_id = $1 AND product_id = $2 AND movement_type = 'purchase'`,
            [businessA, product],
        );
        assert.equal(Number(rows[0]!.count), 12);
    });

    it('serializes concurrent multi-product orders submitted in opposite line order', async () => {
        const firstProduct = await createProduct('Concurrent Order First', 3);
        const secondProduct = await createProduct('Concurrent Order Second', 3);
        const orderInputs = [
            [{ productId: firstProduct, quantity: 1 }, { productId: secondProduct, quantity: 1 }],
            [{ productId: secondProduct, quantity: 1 }, { productId: firstProduct, quantity: 1 }],
        ];
        const responses = await Promise.all(orderInputs.map((items) =>
            request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${customerToken}`)
                .send({ businessId: businessA, items }),
        ));
        assert.ok(responses.every((response) => response.status === 201), JSON.stringify(responses.map((response) => response.body)));
        assert.equal(await balanceOf(firstProduct), 1);
        assert.equal(await balanceOf(secondProduct), 1);
    });

    it('separates branch balances and filters stock reports by location', async () => {
        const product = await createProduct('Branch Stock Item', 3);
        const receive = await stockMovement({ productId: product, locationId: secondLocationA, movementType: 'purchase', quantity: 7 });
        assert.equal(receive.status, 201, JSON.stringify(receive.body));
        assert.equal(await balanceOf(product, locationA), 3);
        assert.equal(await balanceOf(product, secondLocationA), 7);

        const report = await request(app)
            .get(`/api/business/${businessA}/inventory?locationId=${secondLocationA}&productId=${product}`)
            .set('Authorization', `Bearer ${ownerAToken}`);
        assert.equal(report.status, 200, JSON.stringify(report.body));
        assert.equal(report.body.data.products.rows[0].stock_quantity, 7);
    });

    it('deducts and restores order stock at the selected branch', async () => {
        const product = await createProduct('Selected Branch Order', 3);
        const receive = await stockMovement({ productId: product, locationId: secondLocationA, movementType: 'purchase', quantity: 5 });
        assert.equal(receive.status, 201);

        const order = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ businessId: businessA, locationId: secondLocationA, items: [{ productId: product, quantity: 2 }] });
        assert.equal(order.status, 201, JSON.stringify(order.body));
        assert.equal(await balanceOf(product, locationA), 3);
        assert.equal(await balanceOf(product, secondLocationA), 3);

        const orderItem = await adminPool.query<{ inventory_location_id: string }>(
            'SELECT inventory_location_id FROM order_items WHERE order_id = $1',
            [order.body.data.order_id],
        );
        assert.equal(Number(orderItem.rows[0]!.inventory_location_id), secondLocationA);

        const cancel = await request(app)
            .post(`/api/orders/mine/${order.body.data.order_id}/cancel`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({});
        assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
        assert.equal(await balanceOf(product, locationA), 3);
        assert.equal(await balanceOf(product, secondLocationA), 5);
    });

    it('allows sales to consume stock once and restores it once on cancellation', async () => {
        const product = await createProduct('Order Ledger Item', 5);
        const order = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ businessId: businessA, items: [{ productId: product, quantity: 2 }] });
        assert.equal(order.status, 201, JSON.stringify(order.body));
        const orderId = String(order.body.data.order_id);
        assert.equal(await balanceOf(product), 3);

        const { withTenant } = await import('../src/db/tenant.js');
        await withTenant({ userId: customerId, isPlatformAdmin: false, businessId: businessA }, async (client) => {
            await client.query('SELECT record_order_stock_sale($1)', [orderId]);
            await client.query('SELECT record_order_stock_sale($1)', [orderId]);
        });
        assert.equal(await balanceOf(product), 3, 'replaying the order stock event must not deduct twice');

        const historyAfterSale = await request(app)
            .get(`/api/business/${businessA}/inventory/movements?productId=${product}`)
            .set('Authorization', `Bearer ${ownerAToken}`);
        const sale = historyAfterSale.body.data.find((row: { source_reference: string }) => row.source_reference === orderId);
        assert.equal(sale.movement_type, 'sale');
        assert.equal(sale.quantity, 2);
        assert.equal(sale.previous_quantity, 5);
        assert.equal(sale.resulting_quantity, 3);

        const salesReport = await request(app)
            .get(`/api/business/${businessA}/inventory/reports/sales?productId=${product}`)
            .set('Authorization', `Bearer ${ownerAToken}`);
        assert.equal(salesReport.status, 200, JSON.stringify(salesReport.body));
        assert.equal(salesReport.body.data[0].units_sold, 2);
        assert.equal(salesReport.body.data[0].net_consumption, 2);

        const cancel = await request(app)
            .post(`/api/orders/mine/${orderId}/cancel`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({});
        assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
        assert.equal(await balanceOf(product), 5);

        const repeatCancel = await request(app)
            .post(`/api/orders/mine/${orderId}/cancel`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({});
        assert.equal(repeatCancel.status, 403);
        const { rows } = await adminPool.query<{ count: string }>(
            `SELECT COUNT(*)::TEXT AS count FROM stock_movements
              WHERE business_id = $1 AND product_id = $2 AND source_type = 'order' AND source_reference = $3`,
            [businessA, product, orderId],
        );
        assert.equal(Number(rows[0]!.count), 2);

        const afterCancelSales = await request(app)
            .get(`/api/business/${businessA}/inventory/reports/sales?productId=${product}`)
            .set('Authorization', `Bearer ${ownerAToken}`);
        assert.equal(afterCancelSales.body.data[0].net_consumption, 0);
        assert.equal(afterCancelSales.body.data[0].sales_amount, '0.00');
    });

    it('does not restock on financial refund until a physical return is received', async () => {
        const product = await createProduct('Refund Without Return', 4);
        const order = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ businessId: businessA, items: [{ productId: product, quantity: 1 }] });
        assert.equal(order.status, 201, JSON.stringify(order.body));
        assert.equal(await balanceOf(product), 3);

        await adminPool.query(
            "UPDATE orders SET payment_status = 'refunded' WHERE order_id = $1",
            [order.body.data.order_id],
        );
        assert.equal(await balanceOf(product), 3);

        const physicalReturn = await stockMovement({
            productId: product,
            locationId: locationA,
            movementType: 'return',
            quantity: 1,
            idempotencyKey: 'physical-return-1',
        });
        assert.equal(physicalReturn.status, 201, JSON.stringify(physicalReturn.body));
        assert.equal(await balanceOf(product), 4);
    });

    it('creates one open restock request per product and location', async () => {
        const first = await request(app)
            .post(`/api/business/${businessA}/inventory/restock-requests`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ productId, locationId: locationA, requestedQuantity: 8, note: 'Weekly restock' });
        assert.equal(first.status, 201, JSON.stringify(first.body));
        assert.equal(first.body.data.integration_key, 'hq_wholesale');

        const duplicate = await request(app)
            .post(`/api/business/${businessA}/inventory/restock-requests`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ productId, locationId: locationA, requestedQuantity: 8 });
        assert.equal(duplicate.status, 409);

        const ack = await request(app)
            .patch(`/api/business/${businessA}/inventory/restock-requests/${first.body.data.restock_request_id}`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ status: 'acknowledged' });
        assert.equal(ack.status, 200);
        assert.equal(ack.body.data.status, 'acknowledged');

        const cancelAcknowledged = await request(app)
            .patch(`/api/business/${businessA}/inventory/restock-requests/${first.body.data.restock_request_id}`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ status: 'cancelled' });
        assert.equal(cancelAcknowledged.status, 200);
        assert.equal(cancelAcknowledged.body.data.status, 'cancelled');

        const reopened = await request(app)
            .post(`/api/business/${businessA}/inventory/restock-requests`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ productId, locationId: locationA, requestedQuantity: 4 });
        assert.equal(reopened.status, 201, JSON.stringify(reopened.body));

        const fulfillmentProduct = await createProduct('Restock Fulfillment Item', 0);
        const fulfilledRequest = await request(app)
            .post(`/api/business/${businessA}/inventory/restock-requests`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ productId: fulfillmentProduct, locationId: locationA, requestedQuantity: 2 });
        assert.equal(fulfilledRequest.status, 201);
        const acknowledgedAgain = await request(app)
            .patch(`/api/business/${businessA}/inventory/restock-requests/${fulfilledRequest.body.data.restock_request_id}`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ status: 'acknowledged' });
        assert.equal(acknowledgedAgain.status, 200);
        const fulfilled = await request(app)
            .patch(`/api/business/${businessA}/inventory/restock-requests/${fulfilledRequest.body.data.restock_request_id}`)
            .set('Authorization', `Bearer ${ownerAToken}`)
            .send({ status: 'fulfilled' });
        assert.equal(fulfilled.status, 200);
        assert.equal(fulfilled.body.data.status, 'fulfilled');
    });

    it('enforces inventory view/manage permissions and business isolation', async () => {
        const viewOnly = await request(app)
            .get(`/api/business/${businessA}/inventory`)
            .set('Authorization', `Bearer ${employeeAToken}`);
        assert.equal(viewOnly.status, 200);
        assert.equal(viewOnly.body.data.canManageInventory, false);

        const deniedMutation = await stockMovement({ productId, locationId: locationA, movementType: 'purchase', quantity: 1 }, employeeAToken);
        assert.equal(deniedMutation.status, 403);

        const otherBusiness = await request(app)
            .get(`/api/business/${businessB}/inventory`)
            .set('Authorization', `Bearer ${ownerAToken}`);
        assert.equal(otherBusiness.status, 403);

        const customerAccess = await request(app)
            .get(`/api/business/${businessA}/inventory`)
            .set('Authorization', `Bearer ${customerToken}`);
        assert.equal(customerAccess.status, 403);

        const otherOwnerRead = await request(app)
            .get(`/api/business/${businessA}/inventory`)
            .set('Authorization', `Bearer ${ownerBToken}`);
        assert.equal(otherOwnerRead.status, 403);
    });

    it('provides low-stock report data and a permission-checked CSV export', async () => {
        const lowProduct = await createProduct('Low Report Product', 2, 3);
        await createProduct('=SUM(1,1)', 0);
        const report = await request(app)
            .get(`/api/business/${businessA}/inventory/reports/low-stock`)
            .set('Authorization', `Bearer ${ownerAToken}`);
        assert.equal(report.status, 200, JSON.stringify(report.body));
        assert.ok(report.body.data.some((row: { product_id: string }) => row.product_id === String(lowProduct)));

        const csv = await request(app)
            .get(`/api/business/${businessA}/inventory/reports/stock?format=csv`)
            .set('Authorization', `Bearer ${ownerAToken}`);
        assert.equal(csv.status, 200);
        assert.match(csv.headers['content-type'] ?? '', /text\/csv/);
        assert.match(csv.text, /product_name/);
        assert.match(csv.text, /Opening Stock Item/);
        assert.ok(csv.text.includes(`"'=SUM(1,1)"`));

        const deniedCsv = await request(app)
            .get(`/api/business/${businessA}/inventory/reports/stock?format=csv`)
            .set('Authorization', `Bearer ${ownerBToken}`);
        assert.equal(deniedCsv.status, 403);
    });
});
