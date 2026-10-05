/**
 * Image uploads: a business logo, a business cover, and a product image.
 *
 * Each of the three is a single file in a single-slot column, so the whole
 * feature is six routes and no schema change: `logo_url` and `cover_image_url`
 * already exist on `businesses`, `image_url` already exists on `products`.
 *
 * Three decisions are worth stating before the code, because they explain most
 * of what follows.
 *
 * **The middleware order is fixed and each entry earns its place.**
 * `authenticate` before anything else, then `resolveBusiness`, so an anonymous
 * or foreign caller is refused before a byte of the body is read. Then the write
 * limiter, because a permission check is a database round trip and an attacker
 * should not be able to buy thousands of them. Then the permission check, which
 * is the same `app_has_business_permission()` the profile PATCH and the product
 * routes use, with the same permission keys — `business.edit` for the business
 * images and `products.edit` for a product image. Only then is the multipart
 * body parsed, so a caller who may not upload never causes a buffer to be
 * allocated.
 *
 * **The file is written before the row, and the old file after it.** The order
 * is: write the new file, update the column inside a transaction, and only once
 * that transaction has committed delete what the column used to point at. A
 * failure at any step removes the new file and leaves the row and the old file
 * exactly as they were, so the worst case is a picture that did not change,
 * never a row pointing at a file that no longer exists.
 *
 * **What goes in the column is a path, not a filesystem location.** It is
 * `/uploads/<businessId>/<slot>/<random>.webp`, produced by the storage driver
 * and not by this file. Nothing here knows where the bytes live, which is what
 * makes replacing the local disk with S3 or R2 a change of driver rather than a
 * data migration.
 */
import { Router } from 'express';
import { notFound } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { requireBusinessPermission, resolveBusiness } from '../../middleware/error.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { buildImageKey, getStorage } from './storage/index.js';
import { processImage } from './image-processing.js';
import { imageUpload } from './upload.middleware.js';
/** The permission keys the existing routes already use. Inventing new ones would
 * leave a row writable by nobody and readable by everybody. */
const BUSINESS_EDIT = 'business.edit';
const PRODUCTS_EDIT = 'products.edit';
export const mediaRoutes = Router();
/** One write limiter for all six routes: 30 per minute per IP. */
const writeLimiter = rateLimiter('write');
/**
 * Stores a processed image and returns the row with the new column set.
 *
 * `column` is never taken from the request: it is one of three literals written
 * into the SQL by the two callers below, so there is no path from a URL segment
 * to a column name.
 */
async function replaceBusinessImage(req, businessId, column, kind) {
    const upload = req.uploadedFile;
    const storage = getStorage();
    const processed = await processImage(upload.buffer, kind);
    const stored = await storage.put(buildImageKey(businessId, kind), processed.body, processed.contentType, {
        width: processed.width,
        height: processed.height,
    });
    let previous = null;
    try {
        const row = await withTenant(contextFor(req, businessId), async (client) => {
            // FOR UPDATE serialises two simultaneous uploads of the same slot,
            // so the second one deletes the file the first one just stored
            // instead of both deleting whatever was there before.
            const { rows: current } = await client.query(`SELECT ${column} FROM businesses WHERE business_id = $1 FOR UPDATE`, [businessId]);
            if (!current[0])
                throw notFound('Business not found');
            previous = current[0][column] ?? null;
            const { rows } = await client.query(`UPDATE businesses SET ${column} = $1 WHERE business_id = $2 RETURNING *`, [stored.url, businessId]);
            if (!rows[0])
                throw notFound('Business not found');
            return rows[0];
        });
        // Committed. Only now is the previous file unreachable, and only now is
        // it safe to remove. A failure here leaves an orphaned file rather than
        // a broken row, which is the correct way round.
        if (previous && previous !== stored.url) {
            await storage.removeByStoredValue(previous, businessId).catch(() => undefined);
        }
        return row;
    }
    catch (error) {
        // The row was not updated, so the new file is unreachable. Remove it:
        // the alternative is a file per rejected request.
        await storage.removeByStoredValue(stored.url, businessId).catch(() => undefined);
        throw error;
    }
}
/** Stores a processed product image. Scoped to the business in every statement. */
async function replaceProductImage(req, businessId, productId, kind) {
    const upload = req.uploadedFile;
    const storage = getStorage();
    const processed = await processImage(upload.buffer, kind);
    const stored = await storage.put(buildImageKey(businessId, `products/${productId}`), processed.body, processed.contentType, {
        width: processed.width,
        height: processed.height,
    });
    let previous = null;
    try {
        const row = await withTenant(contextFor(req, businessId), async (client) => {
            const { rows: current } = await client.query(`SELECT image_url FROM products
                  WHERE product_id = $1 AND business_id = $2 AND deleted_at IS NULL
                  FOR UPDATE`, [productId, businessId]);
            // Same answer as the product routes give for a product of another
            // business: not found, so the endpoint cannot be used to find out
            // which product ids exist.
            if (!current[0])
                throw notFound('Product not found in this business');
            previous = current[0].image_url;
            const { rows } = await client.query(`UPDATE products SET image_url = $1
                  WHERE product_id = $2 AND business_id = $3 AND deleted_at IS NULL
                  RETURNING *`, [stored.url, productId, businessId]);
            if (!rows[0])
                throw notFound('Product not found in this business');
            return rows[0];
        });
        if (previous && previous !== stored.url) {
            await storage.removeByStoredValue(previous, businessId).catch(() => undefined);
        }
        return row;
    }
    catch (error) {
        await storage.removeByStoredValue(stored.url, businessId).catch(() => undefined);
        throw error;
    }
}
/** Clears a business image column and removes the file it pointed at. */
async function clearBusinessImage(req, businessId, column) {
    const storage = getStorage();
    let previous = null;
    await withTenant(contextFor(req, businessId), async (client) => {
        const { rows: current } = await client.query(`SELECT ${column} FROM businesses WHERE business_id = $1 FOR UPDATE`, [businessId]);
        if (!current[0])
            throw notFound('Business not found');
        previous = current[0][column] ?? null;
        await client.query(`UPDATE businesses SET ${column} = NULL WHERE business_id = $1`, [businessId]);
    });
    if (previous) {
        await storage.removeByStoredValue(previous, businessId).catch(() => undefined);
    }
}
/** Clears a product image column and removes the file it pointed at. */
async function clearProductImage(req, businessId, productId) {
    const storage = getStorage();
    let previous = null;
    await withTenant(contextFor(req, businessId), async (client) => {
        const { rows: current } = await client.query(`SELECT image_url FROM products
              WHERE product_id = $1 AND business_id = $2 AND deleted_at IS NULL
              FOR UPDATE`, [productId, businessId]);
        if (!current[0])
            throw notFound('Product not found in this business');
        previous = current[0].image_url;
        await client.query(`UPDATE products SET image_url = NULL
              WHERE product_id = $1 AND business_id = $2 AND deleted_at IS NULL`, [productId, businessId]);
    });
    if (previous) {
        await storage.removeByStoredValue(previous, businessId).catch(() => undefined);
    }
}
function handle(work) {
    return (req, res, next) => {
        void work(req, res).catch(next);
    };
}
/** The product id in the path, or the same 404 every other product route gives. */
function productIdFrom(req) {
    const raw = req.params['productId'];
    const productId = Number(raw);
    if (raw === undefined || !Number.isInteger(productId) || productId <= 0) {
        throw notFound('Product not found in this business');
    }
    return productId;
}
// ---------------------------------------------------------------------------
// Business logo and cover
// ---------------------------------------------------------------------------
mediaRoutes.put('/business/:businessId/logo', authenticate, resolveBusiness, writeLimiter, requireBusinessPermission(BUSINESS_EDIT), imageUpload('logo'), handle(async (req, res) => {
    const businessId = req.businessId;
    const data = await replaceBusinessImage(req, businessId, 'logo_url', 'logo');
    res.json({ data });
}));
mediaRoutes.delete('/business/:businessId/logo', authenticate, resolveBusiness, writeLimiter, requireBusinessPermission(BUSINESS_EDIT), handle(async (req, res) => {
    await clearBusinessImage(req, req.businessId, 'logo_url');
    res.status(204).send();
}));
mediaRoutes.put('/business/:businessId/cover', authenticate, resolveBusiness, writeLimiter, requireBusinessPermission(BUSINESS_EDIT), imageUpload('cover'), handle(async (req, res) => {
    const businessId = req.businessId;
    const data = await replaceBusinessImage(req, businessId, 'cover_image_url', 'cover');
    res.json({ data });
}));
mediaRoutes.delete('/business/:businessId/cover', authenticate, resolveBusiness, writeLimiter, requireBusinessPermission(BUSINESS_EDIT), handle(async (req, res) => {
    await clearBusinessImage(req, req.businessId, 'cover_image_url');
    res.status(204).send();
}));
// ---------------------------------------------------------------------------
// Product image
// ---------------------------------------------------------------------------
mediaRoutes.put('/business/:businessId/products/:productId/image', authenticate, resolveBusiness, writeLimiter, requireBusinessPermission(PRODUCTS_EDIT), imageUpload('product'), handle(async (req, res) => {
    const businessId = req.businessId;
    const productId = productIdFrom(req);
    const data = await replaceProductImage(req, businessId, productId, 'product');
    res.json({ data });
}));
mediaRoutes.delete('/business/:businessId/products/:productId/image', authenticate, resolveBusiness, writeLimiter, requireBusinessPermission(PRODUCTS_EDIT), handle(async (req, res) => {
    const businessId = req.businessId;
    const productId = productIdFrom(req);
    await clearProductImage(req, businessId, productId);
    res.status(204).send();
}));
//# sourceMappingURL=media.routes.js.map