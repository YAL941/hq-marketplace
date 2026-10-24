import type { PoolClient } from 'pg';
import { badRequest, conflict, forbidden, notFound } from '../../db/errors.js';
import type { TenantContext } from '../../db/tenant.js';

export type StockMovementType =
    | 'opening_balance'
    | 'purchase'
    | 'sale'
    | 'return'
    | 'adjustment_in'
    | 'adjustment_out'
    | 'cancellation_restore';

export interface InventoryProductRow {
    product_id: string;
    business_id: string;
    location_id: string | null;
    product_name: string;
    description: string | null;
    sku: string | null;
    barcode: string | null;
    unit_of_measure: string;
    minimum_stock: number;
    stock_quantity: number;
    is_stock_tracked: boolean;
    status: string;
    price: string;
    currency: string;
}

export interface StockMovementRow {
    stock_movement_id: string;
    business_id: string;
    product_id: string;
    location_id: string | null;
    product_name: string;
    location_name: string | null;
    movement_type: StockMovementType;
    quantity: number;
    previous_quantity: number;
    resulting_quantity: number;
    source_type: string | null;
    source_reference: string | null;
    acting_user_id: string | null;
    acting_user_name: string | null;
    note: string | null;
    created_at: Date;
}

export interface InventoryFilters {
    productId?: number;
    locationId?: number;
    search?: string;
    stockStatus?: 'all' | 'low' | 'out' | 'in_stock';
    limit?: number;
    offset?: number;
}

export interface MovementFilters {
    locationId?: number;
    productId?: number;
    movementType?: StockMovementType;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
}

const MAX_PAGE_SIZE = 100;

export async function assertInventoryPermission(
    client: PoolClient,
    businessId: number,
    permission: 'inventory.view' | 'inventory.manage',
): Promise<void> {
    if (!(await hasInventoryPermission(client, businessId, permission))) {
        throw forbidden(`Missing permission: ${permission}`);
    }
}

export async function hasInventoryPermission(
    client: PoolClient,
    businessId: number,
    permission: 'inventory.view' | 'inventory.manage',
): Promise<boolean> {
    const { rows } = await client.query<{ allowed: boolean }>(
        'SELECT (app_has_business_permission($1, $2) OR app_is_platform_admin()) AS allowed',
        [businessId, permission],
    );
    return rows[0]?.allowed === true;
}

export async function defaultInventoryLocationId(client: PoolClient, businessId: number): Promise<number | null> {
    const { rows } = await client.query<{ location_id: string }>(
        `SELECT location_id
           FROM business_locations
          WHERE business_id = $1 AND is_active
          ORDER BY is_primary DESC, created_at, location_id
          LIMIT 1`,
        [businessId],
    );
    return rows[0] ? Number(rows[0].location_id) : null;
}

export async function validateInventoryLocation(
    client: PoolClient,
    businessId: number,
    locationId: number | null | undefined,
): Promise<number | null> {
    if (locationId == null) return null;
    const { rows } = await client.query<{ location_id: string }>(
        `SELECT location_id
           FROM business_locations
          WHERE business_id = $1 AND location_id = $2 AND is_active`,
        [businessId, locationId],
    );
    if (!rows[0]) throw badRequest('Choose an active location belonging to this business', { field: 'locationId' });
    return Number(rows[0].location_id);
}

export async function resolveInventoryLocation(
    client: PoolClient,
    businessId: number,
    locationId: number | null | undefined,
): Promise<number | null> {
    return locationId == null
        ? defaultInventoryLocationId(client, businessId)
        : validateInventoryLocation(client, businessId, locationId);
}

export async function getInventorySummary(
    client: PoolClient,
    businessId: number,
    locationId?: number,
) {
    const { rows } = await client.query<{
        active_products: string;
        total_units: string;
        low_stock_products: string;
        out_of_stock_products: string;
    }>(
        `WITH product_stock AS (
             SELECT p.product_id, p.status, p.minimum_stock, p.is_stock_tracked,
                    COALESCE(SUM(ib.quantity), 0)::BIGINT AS quantity
               FROM products p
               LEFT JOIN inventory_balances ib
                 ON ib.product_id = p.product_id
                AND ib.business_id = p.business_id
                AND ($2::BIGINT IS NULL OR ib.location_id = $2)
              WHERE p.business_id = $1 AND p.deleted_at IS NULL
                            GROUP BY p.product_id, p.status, p.minimum_stock, p.is_stock_tracked
         )
         SELECT COUNT(*) FILTER (WHERE status = 'active')::TEXT AS active_products,
                                COALESCE(SUM(quantity) FILTER (WHERE status = 'active' AND is_stock_tracked), 0)::TEXT AS total_units,
                COUNT(*) FILTER (
                                        WHERE status = 'active' AND is_stock_tracked AND quantity > 0 AND quantity <= minimum_stock
                )::TEXT AS low_stock_products,
                                COUNT(*) FILTER (WHERE status = 'active' AND is_stock_tracked AND quantity = 0)::TEXT AS out_of_stock_products
           FROM product_stock`,
        [businessId, locationId ?? null],
    );
    const row = rows[0]!;
    return {
        active_products: Number(row.active_products),
        total_units: Number(row.total_units),
        low_stock_products: Number(row.low_stock_products),
        out_of_stock_products: Number(row.out_of_stock_products),
    };
}

export async function listInventoryProducts(
    client: PoolClient,
    businessId: number,
    filters: InventoryFilters = {},
): Promise<{ rows: InventoryProductRow[]; total: number }> {
    const params: unknown[] = [businessId, filters.locationId ?? null, filters.search?.trim() || null, filters.productId ?? null];
    const conditions = [
        'p.business_id = $1',
        'p.deleted_at IS NULL',
        `($3::TEXT IS NULL OR lower(p.product_name) LIKE '%' || lower($3) || '%'
            OR lower(COALESCE(p.sku, '')) LIKE '%' || lower($3) || '%'
            OR lower(COALESCE(p.barcode, '')) LIKE '%' || lower($3) || '%')`,
        '($4::BIGINT IS NULL OR p.product_id = $4)',
        'p.is_stock_tracked',
    ];
    const status = filters.stockStatus ?? 'all';
    if (status === 'low') conditions.push('stock.quantity > 0 AND stock.quantity <= p.minimum_stock');
    if (status === 'out') conditions.push('stock.quantity = 0');
    if (status === 'in_stock') conditions.push('stock.quantity > p.minimum_stock');
        const { rows: countRows } = await client.query<{ total: string }>(
                `WITH stock AS (
                         SELECT p.product_id, COALESCE(SUM(ib.quantity), 0)::INTEGER AS quantity
                             FROM products p
                             LEFT JOIN inventory_balances ib
                                 ON ib.product_id = p.product_id
                                AND ib.business_id = p.business_id
                                AND ($2::BIGINT IS NULL OR ib.location_id = $2)
                            WHERE p.business_id = $1 AND p.deleted_at IS NULL
                            GROUP BY p.product_id
                 )
                 SELECT COUNT(*)::TEXT AS total
                     FROM products p
                     JOIN stock ON stock.product_id = p.product_id
                    WHERE ${conditions.join(' AND ')}`,
                params,
        );
    params.push(Math.min(filters.limit ?? 25, MAX_PAGE_SIZE));
    const limitIndex = params.length;
    params.push(Math.max(filters.offset ?? 0, 0));
    const offsetIndex = params.length;

    const { rows } = await client.query<InventoryProductRow & { total_count: string }>(
        `WITH stock AS (
             SELECT p.product_id, COALESCE(SUM(ib.quantity), 0)::INTEGER AS quantity
               FROM products p
               LEFT JOIN inventory_balances ib
                 ON ib.product_id = p.product_id
                AND ib.business_id = p.business_id
                AND ($2::BIGINT IS NULL OR ib.location_id = $2)
              WHERE p.business_id = $1 AND p.deleted_at IS NULL
              GROUP BY p.product_id
         )
         SELECT p.product_id, p.business_id, $2::BIGINT AS location_id,
                p.product_name, p.description, p.sku, p.barcode, p.unit_of_measure,
                p.minimum_stock, stock.quantity AS stock_quantity, p.is_stock_tracked,
                p.status, p.price, p.currency
           FROM products p
           JOIN stock ON stock.product_id = p.product_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY (stock.quantity = 0) DESC, p.product_name, p.product_id
          LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        params,
    );
    return { rows, total: Number(countRows[0]?.total ?? 0) };
}

export async function createStockMovement(
    ctx: TenantContext,
    client: PoolClient,
    input: {
        businessId: number;
        productId: number;
        locationId: number | null;
        movementType: 'purchase' | 'return' | 'adjustment_in' | 'adjustment_out';
        quantity: number;
        sourceType?: string | null;
        sourceReference?: string | null;
        note?: string | null;
    },
): Promise<StockMovementRow> {
    await assertInventoryPermission(client, input.businessId, 'inventory.manage');
    return applyStockMovement(ctx, client, input);
}

export async function recordOpeningStock(
    ctx: TenantContext,
    client: PoolClient,
    businessId: number,
    productId: number,
    quantity: number,
): Promise<void> {
    if (quantity < 0 || !Number.isInteger(quantity)) throw badRequest('Opening stock must be a non-negative whole number');
    const locationId = await defaultInventoryLocationId(client, businessId);
    if (quantity === 0) {
        await client.query(
            `INSERT INTO inventory_balances (business_id, product_id, location_id, quantity)
             VALUES ($1, $2, $3, 0)
             ON CONFLICT ON CONSTRAINT inventory_balances_location_unique DO NOTHING`,
            [businessId, productId, locationId],
        );
        return;
    }
    await applyStockMovement(ctx, client, {
        businessId,
        productId,
        locationId,
        movementType: 'opening_balance',
        quantity,
        sourceType: 'product',
        sourceReference: String(productId),
        note: 'Initial stock recorded when the product was created',
    });
}

async function applyStockMovement(
    ctx: TenantContext,
    client: PoolClient,
    input: {
        businessId: number;
        productId: number;
        locationId: number | null;
        movementType: StockMovementType;
        quantity: number;
        sourceType?: string | null;
        sourceReference?: string | null;
        note?: string | null;
    },
): Promise<StockMovementRow> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 2_147_483_647) {
        throw badRequest('Quantity must be a positive whole number', { field: 'quantity' });
    }
    const { rows: products } = await client.query<{
        product_id: string;
        product_name: string;
        is_stock_tracked: boolean;
    }>(
        `SELECT product_id, product_name, is_stock_tracked
           FROM products
          WHERE product_id = $1 AND business_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [input.productId, input.businessId],
    );
    const product = products[0];
    if (!product) throw notFound('Inventory product not found');
    if (!product.is_stock_tracked) throw badRequest('Stock tracking is disabled for this product');
    await validateInventoryLocation(client, input.businessId, input.locationId);

    const isIncrease = ['opening_balance', 'purchase', 'return', 'adjustment_in'].includes(input.movementType)
        || input.movementType === 'cancellation_restore';
    const delta = isIncrease ? input.quantity : -input.quantity;

    await client.query(
        `INSERT INTO inventory_balances (business_id, product_id, location_id, quantity)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT ON CONSTRAINT inventory_balances_location_unique DO NOTHING`,
        [input.businessId, input.productId, input.locationId],
    );
    const { rows: balances } = await client.query<{ quantity: number }>(
        `SELECT quantity
           FROM inventory_balances
          WHERE business_id = $1 AND product_id = $2 AND location_id IS NOT DISTINCT FROM $3::BIGINT
          FOR UPDATE`,
        [input.businessId, input.productId, input.locationId],
    );
    const previousQuantity = balances[0]?.quantity;
    if (previousQuantity === undefined) throw notFound('Inventory balance not found');
    const resultingQuantity = previousQuantity + delta;
    if (resultingQuantity < 0) throw conflict('This movement would make stock negative');

        await client.query('SELECT apply_inventory_stock_delta($1, $2, $3)', [input.businessId, input.productId, delta]);
    await client.query(
        `UPDATE inventory_balances
            SET quantity = $4
          WHERE business_id = $1 AND product_id = $2 AND location_id IS NOT DISTINCT FROM $3::BIGINT`,
        [input.businessId, input.productId, input.locationId, resultingQuantity],
    );

    const { rows: movements } = await client.query<StockMovementRow>(
        `INSERT INTO stock_movements (
            business_id, product_id, location_id, movement_type, quantity,
            previous_quantity, resulting_quantity, source_type, source_reference,
            acting_user_id, note
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING stock_movement_id, business_id, product_id, location_id,
                   movement_type, quantity, previous_quantity, resulting_quantity,
                   source_type, source_reference, acting_user_id, note, created_at`,
        [
            input.businessId,
            input.productId,
            input.locationId,
            input.movementType,
            input.quantity,
            previousQuantity,
            resultingQuantity,
            input.sourceType ?? null,
            input.sourceReference ?? null,
            ctx.userId,
            input.note ?? null,
        ],
    );
    return { ...movements[0]!, product_name: product.product_name, location_name: null, acting_user_name: null };
}

export async function listStockMovements(
    client: PoolClient,
    businessId: number,
    filters: MovementFilters = {},
): Promise<{ rows: StockMovementRow[]; total: number }> {
    const params: unknown[] = [businessId];
    const conditions = ['sm.business_id = $1'];
    const addCondition = (value: unknown, condition: (index: number) => string) => {
        params.push(value);
        conditions.push(condition(params.length));
    };
    if (filters.locationId !== undefined) addCondition(filters.locationId, (i) => `sm.location_id = $${i}`);
    if (filters.productId !== undefined) addCondition(filters.productId, (i) => `sm.product_id = $${i}`);
    if (filters.movementType) addCondition(filters.movementType, (i) => `sm.movement_type = $${i}`);
    if (filters.from) addCondition(filters.from, (i) => `sm.created_at >= $${i}::timestamptz`);
    if (filters.to) addCondition(filters.to, (i) => `sm.created_at < $${i}::timestamptz`);
    const { rows: countRows } = await client.query<{ total: string }>(
        `SELECT COUNT(*)::TEXT AS total
           FROM stock_movements sm
          WHERE ${conditions.join(' AND ')}`,
        params,
    );
    params.push(Math.min(filters.limit ?? 25, MAX_PAGE_SIZE));
    const limitIndex = params.length;
    params.push(Math.max(filters.offset ?? 0, 0));
    const offsetIndex = params.length;
    const { rows } = await client.query<StockMovementRow & { total_count: string }>(
        `SELECT sm.stock_movement_id, sm.business_id, sm.product_id, sm.location_id,
                p.product_name, bl.location_name, sm.movement_type, sm.quantity,
                sm.previous_quantity, sm.resulting_quantity, sm.source_type,
            sm.source_reference, sm.acting_user_id, u.full_name AS acting_user_name,
            sm.note, sm.created_at
           FROM stock_movements sm
           JOIN products p ON p.product_id = sm.product_id AND p.business_id = sm.business_id
           LEFT JOIN business_locations bl
             ON bl.location_id = sm.location_id AND bl.business_id = sm.business_id
           LEFT JOIN users u ON u.user_id = sm.acting_user_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY sm.created_at DESC, sm.stock_movement_id DESC
          LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        params,
    );
    return { rows, total: Number(countRows[0]?.total ?? 0) };
}

export async function createRestockRequest(
    ctx: TenantContext,
    client: PoolClient,
    input: {
        businessId: number;
        productId: number;
        locationId: number | null;
        requestedQuantity: number;
        note?: string | null;
    },
) {
    await assertInventoryPermission(client, input.businessId, 'inventory.manage');
    if (!Number.isInteger(input.requestedQuantity) || input.requestedQuantity <= 0 || input.requestedQuantity > 2_147_483_647) {
        throw badRequest('Requested quantity must be a positive whole number', { field: 'requestedQuantity' });
    }
    await validateInventoryLocation(client, input.businessId, input.locationId);
    const { rows: products } = await client.query<{ product_id: string }>(
        'SELECT product_id FROM products WHERE product_id = $1 AND business_id = $2 AND deleted_at IS NULL',
        [input.productId, input.businessId],
    );
    if (!products[0]) throw notFound('Inventory product not found');
    const { rows } = await client.query(
        `INSERT INTO stock_restock_requests
            (business_id, product_id, location_id, requested_quantity, requested_by, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [input.businessId, input.productId, input.locationId, input.requestedQuantity, ctx.userId, input.note ?? null],
    );
    return rows[0];
}

export async function listRestockRequests(client: PoolClient, businessId: number, limit = 10) {
    const { rows } = await client.query(
        `SELECT rr.*, p.product_name, p.sku, bl.location_name
           FROM stock_restock_requests rr
           JOIN products p ON p.product_id = rr.product_id AND p.business_id = rr.business_id
           LEFT JOIN business_locations bl
             ON bl.location_id = rr.location_id AND bl.business_id = rr.business_id
          WHERE rr.business_id = $1
          ORDER BY rr.created_at DESC, rr.restock_request_id DESC
          LIMIT $2`,
        [businessId, Math.min(Math.max(limit, 1), MAX_PAGE_SIZE)],
    );
    return rows;
}

export async function updateRestockRequestStatus(
    client: PoolClient,
    businessId: number,
    requestId: number,
    status: 'acknowledged' | 'fulfilled' | 'cancelled',
) {
    await assertInventoryPermission(client, businessId, 'inventory.manage');
    const { rows } = await client.query(
        `UPDATE stock_restock_requests
            SET status = $3
          WHERE restock_request_id = $1
            AND business_id = $2
                        AND (
                                (status = 'requested' AND $3 IN ('acknowledged', 'cancelled'))
                                OR (status = 'acknowledged' AND $3 IN ('fulfilled', 'cancelled'))
                        )
         RETURNING *`,
        [requestId, businessId, status],
    );
    if (!rows[0]) throw notFound('Open restock request not found');
    return rows[0];
}

export async function getSalesConsumptionReport(
        client: PoolClient,
        businessId: number,
    filters: { locationId?: number; productId?: number; from?: string; to?: string; limit?: number; offset?: number } = {},
) {
    const params: unknown[] = [
        businessId,
        filters.locationId ?? null,
        filters.from ?? null,
        filters.to ?? null,
        filters.productId ?? null,
    ];
    const reportCtes = `WITH order_totals AS (
             SELECT oi.product_id, oi.business_id, oi.inventory_location_id AS location_id,
                    SUM(oi.quantity) FILTER (
                        WHERE o.order_status NOT IN ('cancelled', 'rejected', 'refunded')
                    )::INTEGER AS units_sold,
                    SUM(oi.quantity) FILTER (
                        WHERE o.order_status IN ('cancelled', 'rejected')
                    )::INTEGER AS units_restored,
                    SUM(oi.total_price) FILTER (
                        WHERE o.order_status NOT IN ('cancelled', 'rejected', 'refunded')
                          AND o.payment_status <> 'refunded'
                    )::NUMERIC(14, 2)::TEXT AS sales_amount
               FROM order_items oi
               JOIN orders o ON o.order_id = oi.order_id AND o.business_id = oi.business_id
              WHERE oi.business_id = $1
                AND oi.product_id IS NOT NULL
                AND ($2::BIGINT IS NULL OR oi.inventory_location_id = $2)
                AND ($3::TIMESTAMPTZ IS NULL OR o.created_at >= $3)
                AND ($4::TIMESTAMPTZ IS NULL OR o.created_at < $4)
                AND ($5::BIGINT IS NULL OR oi.product_id = $5)
              GROUP BY oi.product_id, oi.business_id, oi.inventory_location_id
         ), movement_returns AS (
             SELECT sm.product_id, sm.business_id, sm.location_id,
                    SUM(sm.quantity)::INTEGER AS units_returned
               FROM stock_movements sm
              WHERE sm.business_id = $1
                AND sm.movement_type = 'return'
                AND ($2::BIGINT IS NULL OR sm.location_id = $2)
                AND ($3::TIMESTAMPTZ IS NULL OR sm.created_at >= $3)
                AND ($4::TIMESTAMPTZ IS NULL OR sm.created_at < $4)
                AND ($5::BIGINT IS NULL OR sm.product_id = $5)
              GROUP BY sm.product_id, sm.business_id, sm.location_id
         ), activity_keys AS (
             SELECT product_id, business_id, location_id FROM order_totals
             UNION
             SELECT product_id, business_id, location_id FROM movement_returns
         )`;
    const { rows: countRows } = await client.query<{ total: string }>(
        `${reportCtes} SELECT COUNT(*)::TEXT AS total FROM activity_keys`,
        params,
    );
    const total = Number(countRows[0]?.total ?? 0);
        params.push(Math.min(filters.limit ?? 25, MAX_PAGE_SIZE));
        const limitIndex = params.length;
        params.push(Math.max(filters.offset ?? 0, 0));
        const offsetIndex = params.length;
        const { rows } = await client.query(
        `${reportCtes}
                 SELECT p.product_id, p.product_name, p.sku, ak.location_id, bl.location_name,
                                COALESCE(ot.units_sold, 0)::INTEGER AS units_sold,
                                (COALESCE(ot.units_restored, 0) + COALESCE(mr.units_returned, 0))::INTEGER AS units_restored,
                                COALESCE(mr.units_returned, 0)::INTEGER AS units_returned,
                                (COALESCE(ot.units_sold, 0) - COALESCE(mr.units_returned, 0))::INTEGER AS net_consumption,
                                COALESCE(ot.sales_amount, '0.00') AS sales_amount
                     FROM activity_keys ak
                     JOIN products p ON p.product_id = ak.product_id AND p.business_id = ak.business_id
                     LEFT JOIN business_locations bl ON bl.location_id = ak.location_id AND bl.business_id = ak.business_id
                     LEFT JOIN order_totals ot
                         ON ot.product_id = ak.product_id
                        AND ot.business_id = ak.business_id
                        AND ot.location_id IS NOT DISTINCT FROM ak.location_id
                     LEFT JOIN movement_returns mr
                         ON mr.product_id = ak.product_id
                        AND mr.business_id = ak.business_id
                        AND mr.location_id IS NOT DISTINCT FROM ak.location_id
                    ORDER BY net_consumption DESC, p.product_name, p.product_id
                    LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
                params,
        );
                return { rows, total };
}