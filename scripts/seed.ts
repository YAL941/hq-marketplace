/**
 * Development seed.
 *
 * Uses the OWNER connection on purpose: seeding is a platform-level
 * operation, and it keeps the fixture data independent from the tenant
 * policies. Never run this against production; the script refuses to start if
 * NODE_ENV is production.
 *
 * IDEMPOTENCE
 * -----------
 * The whole seed runs in ONE transaction and owns an explicit set of slugs and
 * email addresses. Running it twice leaves the database in the same state as
 * running it once, and re-running it after editing this file replaces the rows
 * it owns instead of duplicating them.
 *
 * Ownership is by name, not by a marker column, because the schema has no
 * `seed` flag to set. That has one deliberate consequence: a row created through
 * the API with a slug the seed does not know about is never touched. The seed
 * replaces its own fixture, it does not reset the database.
 *
 * Deletion order follows the foreign keys: reviews reference users and
 * businesses, orders reference businesses, and businesses reference categories.
 * Children go first, and `businesses` before the users that own them, because
 * `users` is the parent of almost everything here.
 */

import bcrypt from 'bcryptjs';
import { adminPool, closePools } from '../src/db/pool.js';
import {
    LEGACY_BUSINESS_SLUGS,
    LEGACY_USER_EMAILS,
    RETIRED_CATEGORY_SLUGS,
    SEED_ADMIN,
    SEED_BUSINESSES,
    SEED_CATEGORIES,
    SEED_OWNERS,
    SEED_PASSWORD,
    SEED_REVIEWERS,
} from '../db/seed/somali-directory.js';

/** Every business slug the seed owns, current and previous. */
const OWNED_BUSINESS_SLUGS = [
    ...SEED_BUSINESSES.map((b) => b.slug),
    ...LEGACY_BUSINESS_SLUGS,
];

/**
 * Every user email the seed owns and may delete.
 *
 * `admin@hq.test` is deliberately NOT in this list. It is the platform
 * administrator, and deleting it to re-insert it would hand the account a new
 * `user_id` on every re-seed: anything a developer has wired to id 1 would
 * break with no visible cause. The admin is upserted instead, which keeps its
 * id and its row intact.
 *
 * `users` may already be gone if a previous seed was interrupted, so the admin
 * is upserted rather than assumed to exist.
 */
const OWNED_USER_EMAILS = [
    ...SEED_OWNERS.map((o) => o.email),
    ...SEED_REVIEWERS.map((r) => r.email),
    ...LEGACY_USER_EMAILS,
];

interface Summary {
    removedBusinesses: number;
    removedUsers: number;
    createdBusinesses: number;
    createdUsers: number;
    createdReviews: number;
    createdHours: number;
    categories: number;
}

async function main(): Promise<void> {
    if (process.env['NODE_ENV'] === 'production') {
        throw new Error('refusing to seed a production database');
    }

    const client = await adminPool.connect();
    const summary: Summary = {
        removedBusinesses: 0,
        removedUsers: 0,
        createdBusinesses: 0,
        createdUsers: 0,
        createdReviews: 0,
        createdHours: 0,
        categories: 0,
    };

    try {
        await client.query('BEGIN');

        summary.removedBusinesses = await removeOwnedBusinesses(client);
        summary.removedUsers = await removeOwnedUsers(client);
        await removeOwnedCategories(client);

        await upsertCategories(client);
        summary.categories = SEED_CATEGORIES.length;

        const platformAdmin = await upsertUser(client, SEED_ADMIN.email, SEED_ADMIN.fullName);
        const adminRoleId = await roleId(client, 'platform_admin', 'platform');
        await client.query(
            `INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [platformAdmin, adminRoleId],
        );

        summary.createdUsers += 1; // the platform admin

        if (SEED_BUSINESSES.length > 0) {
            const customerRoleId = await roleId(client, 'customer', 'platform');
            const ownerRoleId = await roleId(client, 'business_owner', 'business');

            // Demo accounts are only created when fictional demo listings are
            // explicitly enabled with SEED_DEMO_BUSINESSES=true.
            const reviewerIds: number[] = [];
            for (const reviewer of SEED_REVIEWERS) {
                reviewerIds.push(await upsertUser(client, reviewer.email, reviewer.fullName));
                summary.createdUsers += 1;
            }

            const ownerIds: number[] = [];
            for (const owner of SEED_OWNERS) {
                ownerIds.push(await upsertUser(client, owner.email, owner.fullName));
                summary.createdUsers += 1;
            }

            for (const [index, business] of SEED_BUSINESSES.entries()) {
                const ownerId = ownerIds[index % ownerIds.length]!;
                const businessId = await insertBusiness(client, business);
                summary.createdBusinesses += 1;

                await client.query(
                    `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
                     VALUES ($1, $2, $3, 'active', now())
                     ON CONFLICT (business_id, user_id, role_id) DO NOTHING`,
                    [businessId, ownerId, ownerRoleId],
                );

                summary.createdHours += await insertOpeningHours(client, businessId, business.hours);

                for (const review of business.reviews) {
                    const { rows } = await client.query(
                        `INSERT INTO reviews (business_id, user_id, rating, review_text, status)
                         VALUES ($1, $2, $3, $4, 'published')
                         ON CONFLICT (business_id, user_id) DO NOTHING
                         RETURNING review_id`,
                        [businessId, reviewerIds[review.reviewer]!, review.rating, review.text],
                    );
                    if (rows.length > 0) summary.createdReviews += 1;
                }
            }

            // Reviewers are customers of the platform, which makes their
            // reviews meaningful within the demo directory.
            for (const reviewerId of reviewerIds) {
                await client.query(
                    `INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [reviewerId, customerRoleId],
                );
            }
        }

        // Refreshing every business at once is a platform-admin operation:
        // migration 006 added that check to the function itself, so the seeding
        // session has to say it is an admin. The setting is transaction-local,
        // so it cannot leak to the next request on a pooled connection.
        await client.query(`SELECT set_config('app.is_platform_admin', 'true', true)`);
        await client.query('SELECT refresh_business_statistics()');

        await client.query('COMMIT');

        const { rows } = await adminPool.query(
            `SELECT (SELECT count(*) FROM businesses) AS businesses,
                    (SELECT count(*) FROM users) AS users,
                    (SELECT count(*) FROM reviews) AS reviews,
                    (SELECT count(*) FROM business_opening_hours) AS opening_hours`,
        );
        console.log('[seed] done', { ...summary, totals: rows[0] });
        console.log(`[seed] every seeded account has the password: ${SEED_PASSWORD}`);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Deletes the businesses the seed owns, children first.
 *
 * `business_opening_hours` goes with ON DELETE CASCADE, so it needs no explicit
 * statement here.
 *
 * `deleted_at IS NULL` is deliberately absent: a soft-deleted seeded row is
 * still a seeded row, and leaving it behind would let the unique slug block
 * the re-insert on the next run.
 */
async function removeOwnedBusinesses(client: import('pg').PoolClient): Promise<number> {
    const ids = await ownedBusinessIds(client);
    if (ids.length === 0) return 0;

    // Reviews first, then order_items, then orders.
    //
    // The order matters and is not obvious. reviews has
    // ON DELETE SET NULL on (order_id, business_id), but business_id is NOT
    // NULL, so that action can never succeed: deleting an order that a review
    // still points at aborts with a not-null violation. Removing the review
    // before the order is the only order that works.
    await client.query('DELETE FROM reviews WHERE business_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM order_items WHERE business_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM orders WHERE business_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM products WHERE business_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM services WHERE business_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM business_locations WHERE business_id = ANY($1::bigint[])', [ids]);
    await client.query('DELETE FROM business_users WHERE business_id = ANY($1::bigint[])', [ids]);

    const { rowCount } = await client.query('DELETE FROM businesses WHERE business_id = ANY($1::bigint[])', [ids]);
    return rowCount ?? 0;
}

async function ownedBusinessIds(client: import('pg').PoolClient): Promise<number[]> {
    const { rows } = await client.query<{ business_id: string }>(
        'SELECT business_id FROM businesses WHERE business_slug = ANY($1::text[])',
        [OWNED_BUSINESS_SLUGS],
    );
    return rows.map((r) => Number(r.business_id));
}

/**
 * Deletes the users the seed owns, after their reviews are already gone.
 *
 * `user_platform_roles` and `business_users` cascade; the remaining references
 * that do not cascade are left alone on purpose, because failing loudly beats
 * deleting somebody's order history to make a re-seed succeed.
 */
async function removeOwnedUsers(client: import('pg').PoolClient): Promise<number> {
    const { rowCount } = await client.query(
        'DELETE FROM users WHERE email = ANY($1::text[])',
        [OWNED_USER_EMAILS],
    );
    return rowCount ?? 0;
}
/**
 * Deactivates the categories 004 seeded that this seed does not own.
 *
 * Deactivated rather than deleted: `businesses.business_category_id` is ON
 * DELETE RESTRICT, and a hand-created business pointing at one of them would
 * make the delete fail. The public directory only lists active categories, so
 * deactivating is enough to make them disappear.
 */
async function removeOwnedCategories(client: import('pg').PoolClient): Promise<void> {
    await client.query(
        `UPDATE business_categories
            SET is_active = FALSE
          WHERE category_slug = ANY($1::text[])
            AND category_slug <> ALL($2::text[])`,
        [RETIRED_CATEGORY_SLUGS, SEED_CATEGORIES.map((c) => c.slug)],
    );
}

/** Creates the seed's categories, updating the ones 004 already seeded. */
async function upsertCategories(client: import('pg').PoolClient): Promise<void> {
    for (const category of SEED_CATEGORIES) {
        await client.query(
            `INSERT INTO business_categories
                (category_name, category_slug, description, icon, sort_order, is_active)
             VALUES ($1, $2, $3, $4, $5, TRUE)
             ON CONFLICT (category_slug) DO UPDATE SET
                category_name = EXCLUDED.category_name,
                description = EXCLUDED.description,
                icon = EXCLUDED.icon,
                sort_order = EXCLUDED.sort_order,
                is_active = TRUE`,
            [category.name, category.slug, category.description, category.icon, category.sortOrder],
        );
    }
}

async function upsertUser(
    client: import('pg').PoolClient,
    email: string,
    fullName: string,
): Promise<number> {
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
    const { rows } = await client.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING user_id`,
        [email, passwordHash, fullName],
    );
    return Number(rows[0]!.user_id);
}

async function roleId(
    client: import('pg').PoolClient,
    roleKey: string,
    scope: 'platform' | 'business',
): Promise<number> {
    const { rows } = await client.query<{ role_id: string }>(
        'SELECT role_id FROM roles WHERE role_key = $1 AND scope = $2',
        [roleKey, scope],
    );
    if (!rows[0]) throw new Error(`role ${roleKey} (${scope}) is missing`);
    return Number(rows[0].role_id);
}

/**
 * Every seeded business is active and verified.
 *
 * `businesses_verified_flag_consistent` requires is_verified, verification_status
 * and verified_at to agree, so all three are set together here rather than
 * relying on a default.
 */
async function insertBusiness(
    client: import('pg').PoolClient,
    business: (typeof SEED_BUSINESSES)[number],
): Promise<number> {
    const { rows } = await client.query<{ business_id: string }>(
        `INSERT INTO businesses
            (business_name, business_slug, business_description, business_category_id,
             phone, whatsapp_number, email, address, city, district,
             status, verification_status, is_verified, verified_at, is_featured)
         VALUES ($1, $2, $3,
                 (SELECT category_id FROM business_categories WHERE category_slug = $4 AND is_active),
                 $5, $6, $7, $8, $9, $10,
                 'active', 'verified', TRUE, now(), $11)
         RETURNING business_id`,
        [
            business.name,
            business.slug,
            business.description,
            business.category,
            business.phone,
            business.whatsapp,
            `${business.slug}@example.test`,
            business.address,
            business.city,
            business.district,
            business.featured,
        ],
    );
    return Number(rows[0]!.business_id);
}

async function insertOpeningHours(
    client: import('pg').PoolClient,
    businessId: number,
    hours: ReadonlyArray<{ day: number; open: string | null; close?: string | null }>,
): Promise<number> {
    let inserted = 0;
    for (const entry of hours) {
        const isClosed = entry.open === null;
        await client.query(
            `INSERT INTO business_opening_hours
                (business_id, day_of_week, opens_at, closes_at, is_closed)
             VALUES ($1, $2, $3::time, $4::time, $5)
             ON CONFLICT (business_id, day_of_week) DO UPDATE SET
                opens_at = EXCLUDED.opens_at,
                closes_at = EXCLUDED.closes_at,
                is_closed = EXCLUDED.is_closed`,
            [
                businessId,
                entry.day,
                isClosed ? null : entry.open,
                isClosed ? null : (entry.close ?? null),
                isClosed,
            ],
        );
        inserted += 1;
    }
    return inserted;
}

main()
    .then(closePools)
    .catch(async (error) => {
        console.error('[seed]', error);
        await closePools();
        process.exit(1);
    });
