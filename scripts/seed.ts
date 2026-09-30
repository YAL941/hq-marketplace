import bcrypt from 'bcryptjs';
import { adminPool, closePools } from '../src/db/pool.js';

/**
 * Development seed.
 *
 * Uses the OWNER connection on purpose: seeding is a platform-level
 * operation, and it keeps the fixture data independent from the tenant
 * policies. Never run this against production.
 *
 * Creates three businesses on purpose:
 *   - two of them share the SAME name on purpose (uniqueness test),
 *   - one healthcare business that sells only services,
 *   - one restaurant that sells both products and services.
 */

const PASSWORD = 'Password123!';

async function createUser(email: string, fullName: string): Promise<number> {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const { rows } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING user_id`,
        [email, passwordHash, fullName],
    );
    const userId = Number(rows[0]!.user_id);
    await adminPool.query(
        `INSERT INTO user_platform_roles (user_id, role_id)
         SELECT $1, role_id FROM roles WHERE role_key = 'customer' AND scope = 'platform'
         ON CONFLICT DO NOTHING`,
        [userId],
    );
    return userId;
}

async function roleId(roleKey: string, scope: 'platform' | 'business'): Promise<number> {
    const { rows } = await adminPool.query<{ role_id: string }>(
        'SELECT role_id FROM roles WHERE role_key = $1 AND scope = $2',
        [roleKey, scope],
    );
    if (!rows[0]) throw new Error(`role ${roleKey} (${scope}) is missing`);
    return Number(rows[0].role_id);
}

async function main(): Promise<void> {
    if (process.env['NODE_ENV'] === 'production') {
        throw new Error('refusing to seed a production database');
    }

    const platformAdmin = await createUser('admin@hq.test', 'HQ Platform Admin');
    await adminPool.query(
        `INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [platformAdmin, await roleId('platform_admin', 'platform')],
    );

    const ahmed = await createUser('ahmed@hq.test', 'Ahmed');
    const mohamed = await createUser('mohamed@hq.test', 'Mohamed');
    const ali = await createUser('ali@hq.test', 'Ali');
    const sara = await createUser('sara@hq.test', 'Sara');

    const ownerRole = await roleId('business_owner', 'business');
    const employeeRole = await roleId('business_employee', 'business');

    const insertBusiness = async (
        name: string,
        slug: string,
        categorySlug: string,
        status: 'pending' | 'active',
        extra: Record<string, unknown> = {},
    ): Promise<number> => {
        const { rows } = await adminPool.query<{ business_id: string }>(
            `INSERT INTO businesses
                (business_name, business_slug, business_description, business_category_id, phone, email,
                 address, city, district, status, verification_status, is_verified, verified_at)
             VALUES ($1, $2, $3, (SELECT category_id FROM business_categories WHERE category_slug = $4),
                     $5, $6, $7, $8, $9, $10::business_status,
                     CASE WHEN $10::text = 'active' THEN 'verified'::verification_status ELSE 'pending'::verification_status END,
                     $10::text = 'active', CASE WHEN $10::text = 'active' THEN now() ELSE NULL END)
             ON CONFLICT (business_slug) DO UPDATE SET business_name = EXCLUDED.business_name
             RETURNING business_id`,
            [
                name,
                slug,
                extra['description'] ?? null,
                categorySlug,
                extra['phone'] ?? '+9630000001',
                extra['email'] ?? `${slug}@hq.test`,
                extra['address'] ?? 'Main street 1',
                extra['city'] ?? 'Damascus',
                extra['district'] ?? 'Central',
                status,
            ],
        );
        return Number(rows[0]!.business_id);
    };

    // Two businesses with the SAME name on purpose (name is not unique).
    const hospitalA = await insertBusiness('ABC Clinic', 'abc-clinic-damascus', 'healthcare', 'active', {
        description: 'General hospital, services only',
    });
    const restaurantA = await insertBusiness('ABC Clinic', 'abc-clinic-homs', 'restaurants', 'active', {
        description: 'Same name, different city and owner',
        city: 'Homs',
    });
    const hospitalB = await insertBusiness('City Pharmacy', 'city-pharmacy-1', 'healthcare', 'active');
    const pendingBusiness = await insertBusiness('New Tech Store', 'new-tech-store', 'technology', 'pending');

    const memberships: Array<[number, number, number]> = [
        [hospitalA, ahmed, ownerRole],
        [hospitalA, mohamed, employeeRole],
        [restaurantA, ali, ownerRole],
        [hospitalB, sara, ownerRole],
        [pendingBusiness, ali, ownerRole],
    ];
    for (const [businessId, userId, role] of memberships) {
        await adminPool.query(
            `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
             VALUES ($1, $2, $3, 'active', now())
             ON CONFLICT (business_id, user_id, role_id) DO NOTHING`,
            [businessId, userId, role],
        );
    }

    // Branches: the hospital has three.
    const locations: Array<[number, string, string]> = [
        [hospitalA, 'Main Branch', 'Damascus'],
        [hospitalA, 'North Branch', 'Damascus'],
        [hospitalA, 'Airport Branch', 'Damascus'],
        [restaurantA, 'Downtown', 'Homs'],
    ];
    for (const [businessId, locationName, city] of locations) {
        await adminPool.query(
            `INSERT INTO business_locations (business_id, location_name, address, city, district, phone, is_primary)
             SELECT $1, $2, 'Street 1', $3, 'Centre', '+9630000001', (COUNT(*) = 0)
             FROM business_locations WHERE business_id = $1`,
            [businessId, locationName, city],
        );
    }

    const { rows: medicalCategory } = await adminPool.query<{ category_id: string }>(
        `SELECT category_id FROM service_categories WHERE category_slug = 'medical-consultation'`,
    );
    await adminPool.query(
        `INSERT INTO services (business_id, service_category_id, service_name, price, duration_minutes, status)
         VALUES ($1, $2, 'Medical Consultation', 40.00, 30, 'active')
         ON CONFLICT DO NOTHING`,
        [hospitalA, medicalCategory[0]!.category_id],
    );

    const { rows: catering } = await adminPool.query<{ category_id: string }>(
        `SELECT category_id FROM service_categories WHERE category_slug = 'events-catering'`,
    );
    await adminPool.query(
        `INSERT INTO services (business_id, service_category_id, service_name, price, status)
         VALUES ($1, $2, 'Wedding Catering Package', 1500.00, 'active')
         ON CONFLICT DO NOTHING`,
        [restaurantA, catering[0]!.category_id],
    );

    const { rows: productCategories } = await adminPool.query<{ category_id: string }>(
        `SELECT category_id FROM product_categories WHERE category_slug = 'food-beverage'`,
    );
    const productNames = ['Grape Leaves 1kg', 'Chicken Sandwich', 'Fresh Juice 500ml'];
    for (const [index, productName] of productNames.entries()) {
        await adminPool.query(
            `INSERT INTO products (business_id, category_id, product_name, price, stock_quantity, sku, status)
             VALUES ($1, $2, $3, $4, 50, $5, 'active')
             ON CONFLICT (business_id, sku) DO NOTHING`,
            [restaurantA, productCategories[0]!.category_id, productName, 5 + index * 2.5, `SKU-${index + 1}`],
        );
    }

    // One completed order so statistics are not all zeroes.
    const { rows: orderRows } = await adminPool.query<{ order_id: string }>(
        `INSERT INTO orders (business_id, customer_id, order_status, subtotal, total_amount, completed_at)
         SELECT $1, $2, 'completed', 15.00, 15.00, now()
         RETURNING order_id`,
        [restaurantA, sara],
    );
    const { rows: firstProduct } = await adminPool.query<{ product_id: string; price: string }>(
        `SELECT product_id, price FROM products WHERE business_id = $1 ORDER BY product_id LIMIT 1`,
        [restaurantA],
    );
    await adminPool.query(
        `INSERT INTO order_items (order_id, business_id, product_id, item_type, item_name, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, 'product', 'Grape Leaves 1kg', 1, $4, $4)`,
        [orderRows[0]!.order_id, restaurantA, firstProduct[0]!.product_id, firstProduct[0]!.price],
    );

    await adminPool.query(
        `INSERT INTO reviews (business_id, user_id, order_id, rating, review_text, status)
         VALUES ($1, $2, $3, 5, 'Excellent service and fast delivery', 'published')
         ON CONFLICT (business_id, user_id) DO NOTHING`,
        [restaurantA, sara, orderRows[0]!.order_id],
    );

    await adminPool.query('SELECT refresh_business_statistics()');

    const { rows: summary } = await adminPool.query(
        `SELECT (SELECT count(*) FROM businesses) AS businesses,
                (SELECT count(*) FROM users) AS users,
                (SELECT count(*) FROM products) AS products,
                (SELECT count(*) FROM services) AS services,
                (SELECT count(*) FROM orders) AS orders,
                (SELECT count(*) FROM business_locations) AS locations`,
    );
    console.log('[seed] done', summary[0]);
    console.log(`[seed] every seeded user has the password: ${PASSWORD}`);
}

main()
    .then(closePools)
    .catch(async (error) => {
        console.error('[seed]', error);
        await closePools();
        process.exit(1);
    });
