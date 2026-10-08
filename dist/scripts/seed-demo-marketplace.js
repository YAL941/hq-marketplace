import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { adminPool, closePools } from '../src/db/pool.js';
import { processImage } from '../src/modules/media/image-processing.js';
import { buildImageKey, getStorage } from '../src/modules/media/storage/index.js';
const OWNER_EMAIL = 'nertu.owner@example.test';
const CUSTOMER_EMAIL = 'nertu.customer@example.test';
const BUSINESS_SLUG = 'nertu-fashion-demo';
const PRODUCT_SKU = 'NERTU-DEMO-SET-01';
const PRODUCT_PRICE = 29.99;
const ORDER_STATUSES = [
    'pending',
    'confirmed',
    'in_progress',
    'ready',
    'out_for_delivery',
    'completed',
    'cancelled',
    'rejected',
    'refunded',
];
async function main() {
    if (process.env['NODE_ENV'] === 'production') {
        throw new Error('refusing to create demo data in a production database');
    }
    const imagePath = process.argv[2];
    const password = process.env['NERTU_DEMO_PASSWORD'];
    if (!imagePath)
        throw new Error('usage: npm run db:seed:demo -- <product-image-path>');
    if (!password || password.length < 12) {
        throw new Error('set NERTU_DEMO_PASSWORD to a password at least 12 characters long');
    }
    const processed = await processImage(await readFile(imagePath), 'product');
    const passwordHash = await bcrypt.hash(password, 12);
    const client = await adminPool.connect();
    const storage = getStorage();
    let storedImage = null;
    let previousImage = null;
    let storedBusinessId = null;
    let committed = false;
    try {
        await client.query('BEGIN');
        const { rows: ownerRows } = await client.query(`INSERT INTO users (email, password_hash, full_name, status)
             VALUES ($1, $2, 'Nertu Demo Store Owner', 'active')
             ON CONFLICT (email) DO UPDATE
                 SET password_hash = EXCLUDED.password_hash,
                     full_name = EXCLUDED.full_name,
                     status = 'active'
             RETURNING user_id`, [OWNER_EMAIL, passwordHash]);
        const ownerId = Number(ownerRows[0].user_id);
        const { rows: customerRows } = await client.query(`INSERT INTO users (email, password_hash, full_name, status)
             VALUES ($1, $2, 'Nertu Demo Customer', 'active')
             ON CONFLICT (email) DO UPDATE
                 SET password_hash = EXCLUDED.password_hash,
                     full_name = EXCLUDED.full_name,
                     status = 'active'
             RETURNING user_id`, [CUSTOMER_EMAIL, passwordHash]);
        const customerId = Number(customerRows[0].user_id);
        const { rows: customerRoleRows } = await client.query(`SELECT role_id FROM roles WHERE role_key = 'customer' AND scope = 'platform'`);
        const { rows: ownerRoleRows } = await client.query(`SELECT role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business'`);
        const { rows: adminRows } = await client.query(`SELECT user_id FROM users WHERE email = 'admin@hq.test'`);
        if (!customerRoleRows[0] || !ownerRoleRows[0] || !adminRows[0]) {
            throw new Error('required seed roles or the local platform admin are missing; run npm run db:seed first');
        }
        for (const userId of [ownerId, customerId]) {
            await client.query(`INSERT INTO user_platform_roles (user_id, role_id)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, customerRoleRows[0].role_id]);
        }
        const { rows: businessCategoryRows } = await client.query(`SELECT category_id FROM business_categories WHERE category_slug = 'shops' AND is_active`);
        const { rows: productCategoryRows } = await client.query(`SELECT category_id FROM product_categories WHERE category_slug = 'fashion' AND is_active`);
        if (!businessCategoryRows[0] || !productCategoryRows[0]) {
            throw new Error('required Shops/Fashion categories are missing; run database migrations and seed first');
        }
        const { rows: businessRows } = await client.query(`INSERT INTO businesses
                (business_name, business_slug, business_description, business_category_id,
                 email, address, city, district, status, is_verified, verification_status,
                 verified_at, verified_by)
             VALUES
                ('Nertu Fashion (Demo)', $1,
                 'DEMO STORE — sample fashion shop for testing the marketplace. Not a real business.',
                 $2, $3, 'Demo address, Mogadishu', 'Mogadishu', 'Demo',
                 'active', TRUE, 'verified', now(), $4)
             ON CONFLICT (business_slug) DO UPDATE SET
                 business_name = EXCLUDED.business_name,
                 business_description = EXCLUDED.business_description,
                 business_category_id = EXCLUDED.business_category_id,
                 email = EXCLUDED.email,
                 address = EXCLUDED.address,
                 city = EXCLUDED.city,
                 district = EXCLUDED.district,
                 status = 'active',
                 is_verified = TRUE,
                 verification_status = 'verified',
                 verified_at = COALESCE(businesses.verified_at, now()),
                 verified_by = EXCLUDED.verified_by,
                 deleted_at = NULL
             RETURNING business_id`, [BUSINESS_SLUG, businessCategoryRows[0].category_id, OWNER_EMAIL, adminRows[0].user_id]);
        const businessId = Number(businessRows[0].business_id);
        storedBusinessId = businessId;
        await client.query(`INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
             VALUES ($1, $2, $3, 'active', now())
             ON CONFLICT (business_id, user_id, role_id) DO UPDATE SET
                 status = 'active',
                 joined_at = COALESCE(business_users.joined_at, now())`, [businessId, ownerId, ownerRoleRows[0].role_id]);
        const { rows: productRows } = await client.query(`INSERT INTO products
                (business_id, category_id, product_name, description, price, currency, sku,
                 stock_quantity, is_stock_tracked, status)
             VALUES
                ($1, $2, 'Nertu Fashion Striped Polo & Jeans Set',
                 'DEMO PRODUCT — striped short-sleeve polo shirt with light-blue denim jeans, as shown in the supplied photo.',
                 $3, 'USD', $4, 20, TRUE, 'active')
             ON CONFLICT (business_id, sku) DO UPDATE SET
                 category_id = EXCLUDED.category_id,
                 product_name = EXCLUDED.product_name,
                 description = EXCLUDED.description,
                 price = EXCLUDED.price,
                 currency = EXCLUDED.currency,
                 stock_quantity = EXCLUDED.stock_quantity,
                 is_stock_tracked = TRUE,
                 status = 'active',
                 deleted_at = NULL
             RETURNING product_id, image_url`, [businessId, productCategoryRows[0].category_id, PRODUCT_PRICE, PRODUCT_SKU]);
        const productId = Number(productRows[0].product_id);
        previousImage = productRows[0].image_url;
        const stored = await storage.put(buildImageKey(businessId, `products/${productId}`), processed.body, processed.contentType, { width: processed.width, height: processed.height });
        storedImage = stored.url;
        await client.query('UPDATE products SET image_url = $1 WHERE product_id = $2 AND business_id = $3', [
            storedImage,
            productId,
            businessId,
        ]);
        await client.query(`DELETE FROM orders
              WHERE business_id = $1 AND customer_id = $2
                AND customer_note LIKE '[DEMO] Nertu Fashion sample order%'`, [businessId, customerId]);
        for (const [index, orderStatus] of ORDER_STATUSES.entries()) {
            const completedAt = orderStatus === 'completed' ? new Date() : null;
            const cancelledAt = orderStatus === 'cancelled' ? new Date() : null;
            const confirmedAt = ['confirmed', 'in_progress', 'ready', 'out_for_delivery', 'completed']
                .includes(orderStatus) ? new Date() : null;
            const { rows: orderRows } = await client.query(`INSERT INTO orders
                    (business_id, customer_id, order_type, order_status, subtotal, total_amount,
                     currency, customer_note, delivery_address, confirmed_at, completed_at,
                     cancelled_at, cancellation_reason, created_at)
                 VALUES
                    ($1, $2, 'product', $3::order_status, $4, $4, 'USD',
                     $5, 'DEMO ONLY — Mogadishu', $6, $7, $8,
                     CASE WHEN $3::order_status = 'cancelled' THEN 'Demo cancellation' END,
                     now() - ($9 * interval '5 minutes'))
                 RETURNING order_id`, [
                businessId,
                customerId,
                orderStatus,
                PRODUCT_PRICE,
                `[DEMO] Nertu Fashion sample order — ${orderStatus}`,
                confirmedAt,
                completedAt,
                cancelledAt,
                index,
            ]);
            await client.query(`INSERT INTO order_items
                    (order_id, business_id, product_id, item_type, item_name, quantity, unit_price, total_price)
                 VALUES ($1, $2, $3, 'product', 'Nertu Fashion Striped Polo & Jeans Set', 1, $4, $4)`, [orderRows[0].order_id, businessId, productId, PRODUCT_PRICE]);
        }
        await client.query(`SELECT set_config('app.is_platform_admin', 'true', true)`);
        await client.query('SELECT refresh_business_statistics()');
        await client.query('COMMIT');
        committed = true;
        if (previousImage && previousImage !== storedImage) {
            await storage.removeByStoredValue(previousImage, businessId);
        }
        console.log('[demo-seed] created Nertu Fashion demo data', {
            businessSlug: BUSINESS_SLUG,
            product: 'Nertu Fashion Striped Polo & Jeans Set',
            productPrice: `${PRODUCT_PRICE.toFixed(2)} USD (demo placeholder)`,
            orderStatuses: ORDER_STATUSES,
            ownerEmail: OWNER_EMAIL,
            customerEmail: CUSTOMER_EMAIL,
            password: '(the value supplied in NERTU_DEMO_PASSWORD)',
            demoOnly: true,
        });
    }
    catch (error) {
        if (!committed)
            await client.query('ROLLBACK').catch(() => undefined);
        if (!committed && storedImage && storedBusinessId !== null) {
            await storage.removeByStoredValue(storedImage, storedBusinessId);
        }
        throw error;
    }
    finally {
        client.release();
        await closePools();
    }
}
main().catch((error) => {
    console.error('[demo-seed] failed:', error);
    process.exitCode = 1;
});
//# sourceMappingURL=seed-demo-marketplace.js.map