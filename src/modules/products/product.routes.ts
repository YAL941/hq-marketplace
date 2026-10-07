import { Router } from 'express';
import { z } from 'zod';
import { forbidden, notFound } from '../../db/errors.js';
import { hasBusinessPermission, withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { requireBusinessPermission, resolveBusiness } from '../../middleware/error.js';
import { optionalManagedImageUrlSchema } from '../media/stored-image-url.js';
import {
    archiveProduct,
    createProduct,
    listProductsForBusiness,
    listPublicProducts,
    requireProduct,
    updateProduct,
    type ProductRow,
} from './product.repository.js';

const listQuerySchema = z.object({
    status: z.enum(['draft', 'active', 'inactive', 'archived']).optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    search: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Product body schemas.
 *
 * Built per request because `imageUrl` is checked against the business the route
 * resolved: a managed upload path is only legal under `/uploads/<that id>/`, so
 * the schema cannot be a module constant. See
 * `modules/media/stored-image-url.ts`.
 */
function createSchema(businessId: number) {
    return z.object({
        productName: z.string().min(2).max(200),
        categoryId: z.number().int().positive().nullish(),
        description: z.string().max(5000).nullish(),
        price: z.number().nonnegative(),
        currency: z.string().length(3).regex(/^[A-Z]{3}$/).optional(),
        sku: z.string().max(64).nullish(),
        imageUrl: optionalManagedImageUrlSchema(businessId),
        stockQuantity: z.number().int().nonnegative().optional(),
        status: z.enum(['draft', 'active', 'inactive', 'archived']).optional(),
    });
}

function updateSchema(businessId: number) {
    return createSchema(businessId)
        .partial()
        .refine((v) => Object.keys(v).length > 0, { message: 'Empty patch' });
}

export const productRoutes: Router = Router();

/** Business staff endpoints â€” always inside a resolved business context. */
productRoutes.get('/business/:businessId/products', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const q = listQuerySchema.parse(req.query);
        const ctx = contextFor(req, businessId);
        const products = await withTenant(ctx, (client) => listProductsForBusiness(client, businessId, q));
        res.json({ data: products, meta: { count: products.length, businessId } });
    } catch (error) {
        next(error);
    }
});

productRoutes.get('/business/:businessId/products/:productId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const productId = Number(req.params['productId']);
        const ctx = contextFor(req, businessId);
        const product = await withTenant(ctx, (client) => requireProduct(client, businessId, productId));
        res.json({ data: product });
    } catch (error) {
        next(error);
    }
});

productRoutes.post('/business/:businessId/products', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const input = createSchema(businessId).parse(req.body);
        const ctx = contextFor(req, businessId);
        const product = await withTenant(ctx, (client) => createProduct(ctx, client, businessId, input));
        res.status(201).json({ data: product });
    } catch (error) {
        next(error);
    }
});

productRoutes.patch('/business/:businessId/products/:productId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        const businessId = req.businessId!;
        const productId = Number(req.params['productId']);
        const patch = updateSchema(businessId).parse(req.body) as Record<string, unknown>;
        const ctx = contextFor(req, businessId);
        if (patch['status'] === 'archived') {
            const canArchive = await hasBusinessPermission(ctx, businessId, 'products.delete');
            if (!canArchive) throw forbidden('Missing permission: products.delete');
        }
        const product = await withTenant(ctx, (client) => updateProduct(client, businessId, productId, patch));
        if (!product) throw notFound('Product not found in this business');
        res.json({ data: product });
    } catch (error) {
        next(error);
    }
});

productRoutes.delete(
    '/business/:businessId/products/:productId',
    authenticate,
    resolveBusiness,
    requireBusinessPermission('products.delete'),
    async (req, res, next) => {
        try {
            const businessId = req.businessId!;
            const productId = Number(req.params['productId']);
            const ctx = contextFor(req, businessId);
            const deleted = await withTenant(ctx, (client) => archiveProduct(client, businessId, productId));
            if (!deleted) throw notFound('Product not found in this business');
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    },
);

/** Public marketplace catalogue: active products of active businesses only. */
productRoutes.get('/products', async (req, res, next) => {
    try {
        const q = listQuerySchema.parse(req.query);
        const products = await withTenant(contextFor(req), (client) => listPublicProducts(client, q));
        res.json({ data: products, meta: { count: products.length } });
    } catch (error) {
        next(error);
    }
});
