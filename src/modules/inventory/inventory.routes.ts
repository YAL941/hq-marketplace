import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import {
    assertInventoryPermission,
    createRestockRequest,
    createStockMovement,
    getSalesConsumptionReport,
    getInventorySummary,
    hasInventoryPermission,
    listInventoryProducts,
    listRestockRequests,
    listStockMovements,
    resolveInventoryLocation,
    updateRestockRequestStatus,
    validateInventoryLocation,
    type InventoryFilters,
    type MovementFilters,
    type StockMovementType,
} from './inventory.repository.js';

const filtersSchema = z.object({
    productId: z.coerce.number().int().positive().optional(),
    locationId: z.coerce.number().int().positive().optional(),
    search: z.string().trim().min(1).max(120).optional(),
    stockStatus: z.enum(['all', 'low', 'out', 'in_stock']).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

const movementFiltersSchema = z.object({
    locationId: z.coerce.number().int().positive().optional(),
    productId: z.coerce.number().int().positive().optional(),
    movementType: z.enum([
        'opening_balance', 'purchase', 'sale', 'return',
        'adjustment_in', 'adjustment_out', 'cancellation_restore',
    ]).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

const movementSchema = z.object({
    productId: z.number().int().positive(),
    locationId: z.number().int().positive().nullish(),
    movementType: z.enum(['purchase', 'return', 'adjustment_in', 'adjustment_out']),
    quantity: z.number().int().positive().max(2_147_483_647),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
    note: z.string().trim().max(500).nullish(),
});

const restockSchema = z.object({
    productId: z.number().int().positive(),
    locationId: z.number().int().positive().nullish(),
    requestedQuantity: z.number().int().positive().max(2_147_483_647),
    note: z.string().trim().max(500).nullish(),
});

const requestStatusSchema = z.object({ status: z.enum(['acknowledged', 'fulfilled', 'cancelled']) });
const reportNameSchema = z.enum(['stock', 'low-stock', 'movements', 'sales']);
const REPORT_COLUMNS: Record<z.infer<typeof reportNameSchema>, string[]> = {
    stock: [
        'product_id', 'business_id', 'location_id', 'product_name', 'description', 'sku',
        'barcode', 'unit_of_measure', 'minimum_stock', 'stock_quantity', 'is_stock_tracked',
        'status', 'price', 'currency',
    ],
    'low-stock': [
        'product_id', 'business_id', 'location_id', 'product_name', 'description', 'sku',
        'barcode', 'unit_of_measure', 'minimum_stock', 'stock_quantity', 'is_stock_tracked',
        'status', 'price', 'currency',
    ],
    movements: [
        'stock_movement_id', 'business_id', 'product_id', 'location_id', 'product_name',
        'location_name', 'movement_type', 'quantity', 'previous_quantity', 'resulting_quantity',
        'source_type', 'source_reference', 'acting_user_id', 'acting_user_name', 'note', 'created_at',
    ],
    sales: [
        'product_id', 'product_name', 'sku', 'location_id', 'location_name', 'units_sold',
        'units_restored', 'units_returned', 'net_consumption', 'sales_amount',
    ],
};

export const inventoryRoutes: Router = Router();
const writeLimiter = rateLimiter('write');

inventoryRoutes.get('/business/:businessId/inventory', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const filters = filtersSchema.parse(req.query);
        const payload = await withTenant(contextFor(req, businessId), async (client) => {
            await assertInventoryPermission(client, businessId, 'inventory.view');
            const locationId = await validateInventoryLocation(client, businessId, filters.locationId);
            const inventoryFilters: InventoryFilters = { ...filters, locationId: locationId ?? undefined };
            const summary = await getInventorySummary(client, businessId, locationId ?? undefined);
            const products = await listInventoryProducts(client, businessId, inventoryFilters);
            const recentMovements = await listStockMovements(client, businessId, { locationId: locationId ?? undefined, limit: 8 });
            const restockRequests = await listRestockRequests(client, businessId, 8);
            const canManageInventory = await hasInventoryPermission(client, businessId, 'inventory.manage');
            return { summary, products, recentMovements: recentMovements.rows, restockRequests, canManageInventory };
        });
        res.json({
            data: payload,
            meta: {
                businessId,
                count: payload.products.rows.length,
                total: payload.products.total,
                limit: filters.limit ?? 25,
                offset: filters.offset ?? 0,
            },
        });
    } catch (error) {
        next(error);
    }
});

inventoryRoutes.get('/business/:businessId/inventory/movements', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const filters = movementFiltersSchema.parse(req.query);
        const result = await withTenant(contextFor(req, businessId), async (client) => {
            await assertInventoryPermission(client, businessId, 'inventory.view');
            const locationId = await validateInventoryLocation(client, businessId, filters.locationId);
            const movementFilters: MovementFilters = { ...filters, locationId: locationId ?? undefined };
            return listStockMovements(client, businessId, movementFilters);
        });
        res.json({
            data: result.rows,
            meta: { businessId, count: result.rows.length, total: result.total, limit: filters.limit ?? 25, offset: filters.offset ?? 0 },
        });
    } catch (error) {
        next(error);
    }
});

inventoryRoutes.post(
    '/business/:businessId/inventory/movements',
    authenticate,
    resolveBusiness,
    writeLimiter,
    async (req, res, next) => {
        try {
            if (!req.user) throw unauthorized();
            const businessId = req.businessId!;
            const input = movementSchema.parse(req.body);
            const idempotencyKey = input.idempotencyKey ?? req.header('Idempotency-Key') ?? undefined;
            if (input.movementType === 'return' && !idempotencyKey) {
                throw badRequest('Manual stock returns require an idempotency key');
            }
            const result = await withTenant(contextFor(req, businessId), async (client) => {
                const locationId = await resolveInventoryLocation(client, businessId, input.locationId);
                const sourceType = input.movementType === 'purchase'
                    ? 'manual_purchase'
                    : input.movementType === 'return'
                        ? 'manual_return'
                        : 'manual_adjustment';
                const sourceReference = input.movementType === 'return' ? idempotencyKey! : randomUUID();
                if (input.movementType === 'return') {
                    await client.query(
                        `SELECT pg_advisory_xact_lock(hashtextextended(
                            'manual-return:' || $1::TEXT || ':' || $2::TEXT, 0
                         ))`,
                        [businessId, sourceReference],
                    );
                    const { rows: prior } = await client.query(
                        `SELECT sm.stock_movement_id, sm.business_id, sm.product_id, sm.location_id,
                                p.product_name, bl.location_name, sm.movement_type, sm.quantity,
                                sm.previous_quantity, sm.resulting_quantity, sm.source_type,
                                sm.source_reference, sm.acting_user_id, u.full_name AS acting_user_name,
                                sm.note, sm.created_at
                           FROM stock_movements sm
                           JOIN products p ON p.product_id = sm.product_id AND p.business_id = sm.business_id
                           LEFT JOIN business_locations bl ON bl.location_id = sm.location_id AND bl.business_id = sm.business_id
                           LEFT JOIN users u ON u.user_id = sm.acting_user_id
                          WHERE sm.business_id = $1 AND sm.source_type = 'manual_return'
                            AND sm.source_reference = $2`,
                        [businessId, sourceReference],
                    );
                    if (prior[0]) {
                        const movement = prior[0];
                        if (Number(movement.product_id) !== input.productId
                            || (movement.location_id == null) !== (locationId == null)
                            || (movement.location_id != null && Number(movement.location_id) !== locationId)
                            || Number(movement.quantity) !== input.quantity
                            || movement.note !== (input.note ?? null)) {
                            throw conflict('Idempotency key was already used with a different stock return');
                        }
                        return { movement, replayed: true };
                    }
                }
                const movement = await createStockMovement(contextFor(req, businessId), client, {
                    businessId,
                    productId: input.productId,
                    locationId,
                    movementType: input.movementType,
                    quantity: input.quantity,
                    sourceType,
                    sourceReference,
                    note: input.note ?? null,
                });
                return { movement, replayed: false };
            });
            res.status(result.replayed ? 200 : 201).json({ data: result.movement, replayed: result.replayed });
        } catch (error) {
            next(error);
        }
    },
);

inventoryRoutes.get('/business/:businessId/inventory/restock-requests', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const limit = z.coerce.number().int().positive().max(100).default(25).parse(req.query['limit']);
        const requests = await withTenant(contextFor(req, businessId), async (client) => {
            await assertInventoryPermission(client, businessId, 'inventory.view');
            return listRestockRequests(client, businessId, limit);
        });
        res.json({ data: requests, meta: { businessId, count: requests.length } });
    } catch (error) {
        next(error);
    }
});

inventoryRoutes.post(
    '/business/:businessId/inventory/restock-requests',
    authenticate,
    resolveBusiness,
    writeLimiter,
    async (req, res, next) => {
        try {
            if (!req.user) throw unauthorized();
            const businessId = req.businessId!;
            const input = restockSchema.parse(req.body);
            const restockRequest = await withTenant(contextFor(req, businessId), async (client) => {
                const locationId = await resolveInventoryLocation(client, businessId, input.locationId);
                return createRestockRequest(contextFor(req, businessId), client, {
                    businessId,
                    productId: input.productId,
                    locationId,
                    requestedQuantity: input.requestedQuantity,
                    note: input.note ?? null,
                });
            });
            res.status(201).json({ data: restockRequest });
        } catch (error) {
            next(error);
        }
    },
);

inventoryRoutes.patch(
    '/business/:businessId/inventory/restock-requests/:requestId',
    authenticate,
    resolveBusiness,
    writeLimiter,
    async (req, res, next) => {
        try {
            const businessId = req.businessId!;
            const requestId = z.coerce.number().int().positive().parse(req.params['requestId']);
            const { status } = requestStatusSchema.parse(req.body);
            const restockRequest = await withTenant(contextFor(req, businessId), (client) =>
                updateRestockRequestStatus(client, businessId, requestId, status));
            res.json({ data: restockRequest });
        } catch (error) {
            next(error);
        }
    },
);

inventoryRoutes.get('/business/:businessId/inventory/reports/:report', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const report = reportNameSchema.parse(req.params['report']);
        const format = z.enum(['json', 'csv']).default('json').parse(req.query['format']);
        const filters = filtersSchema.parse(req.query);
        const movementFilters = movementFiltersSchema.parse(req.query);
        const result = await withTenant(contextFor(req, businessId), async (client) => {
            await assertInventoryPermission(client, businessId, 'inventory.view');
            const pageLimit = format === 'csv' ? MAX_EXPORT_ROWS_PER_PAGE : filters.limit ?? 25;
            const firstOffset = format === 'csv' ? 0 : filters.offset ?? 0;
            const getPage = async (offset: number) => {
                if (report === 'movements') {
                    return listStockMovements(client, businessId, { ...movementFilters, limit: pageLimit, offset });
                }
                if (report === 'sales') {
                    const locationId = await validateInventoryLocation(client, businessId, filters.locationId);
                    return getSalesConsumptionReport(client, businessId, {
                        locationId: locationId ?? undefined,
                        productId: filters.productId,
                        from: movementFilters.from,
                        to: movementFilters.to,
                        limit: pageLimit,
                        offset,
                    });
                }
                const stockStatus = report === 'low-stock' ? 'low' : 'all';
                const products: InventoryFilters = { ...filters, stockStatus, limit: pageLimit, offset };
                return listInventoryProducts(client, businessId, products);
            };

            const firstPage = await getPage(firstOffset);
            if (format !== 'csv') return { rows: firstPage.rows, total: firstPage.total };
            if (firstPage.total > MAX_CSV_EXPORT_ROWS) {
                throw badRequest(`CSV exports are limited to ${MAX_CSV_EXPORT_ROWS} rows; filter the report and try again`);
            }
            const rows = [...firstPage.rows];
            for (let offset = pageLimit; offset < firstPage.total; offset += pageLimit) {
                const nextPage = await getPage(offset);
                rows.push(...nextPage.rows);
            }
            return { rows, total: firstPage.total };
        });
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="hq-stock-${report}.csv"`);
            res.send(`\uFEFF${toCsv(result.rows as Array<Record<string, unknown>>, REPORT_COLUMNS[report])}`);
            return;
        }
        res.json({ data: result.rows, meta: { businessId, count: result.rows.length, total: result.total, report } });
    } catch (error) {
        next(error);
    }
});

const MAX_EXPORT_ROWS_PER_PAGE = 100;
const MAX_CSV_EXPORT_ROWS = 25_000;

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
    const encode = (value: unknown) => {
        let text = String(value ?? '');
        if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    return [columns.map(encode).join(','), ...rows.map((row) => columns.map((column) => encode(row[column])).join(','))].join('\r\n');
}

export const inventoryMovementTypes: readonly StockMovementType[] = [
    'opening_balance', 'purchase', 'sale', 'return', 'adjustment_in', 'adjustment_out', 'cancellation_restore',
];