/**
 * The public directory: businesses, categories, cities and reviews.
 *
 * These run against a REAL PostgreSQL database, because the property that
 * matters most here is enforced by the database and not by the route: a
 * suspended or unverified business must not be listable, and `hq_app` is not the
 * table owner, so every statement really is filtered by RLS.
 *
 * The privacy assertions are written as "the key is absent", not "the value is
 * null", because a key that exists with a null value still documents that the
 * field exists, and a future `SELECT *` would be one careless edit away from
 * shipping an owner's email address to the storefront.
 */

process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import request from 'supertest';

const assert: typeof assertModule = assertModule;

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;

const PASSWORD = 'Password123!';

/**
 * Keys that must never appear on any public payload.
 *
 * `latitude` / `longitude` are deliberately absent: a business's coordinates
 * are what a map widget needs and are published by the profile on purpose.
 * Everything below is either an account identifier, a moderation decision or a
 * column that only the owner and the platform should see.
 */
const FORBIDDEN_KEYS = [
    'created_by',
    'verified_by',
    'verified_at',
    'rejection_reason',
    'is_verified',
    'verification_status',
    'deleted_at',
    'user_id',
    'password_hash',
    'business_id_secondary',
];

interface Fixture {
    id: number;
    business_slug: string;
    name: string;
}

let clinic: Fixture;
let grill: Fixture;
let garage: Fixture;
/** active + verified, so the only reason it is absent is the featured flag */
let featuredClinic: Fixture;
let suspended: Fixture;
let unverified: Fixture;
let softDeleted: Fixture;
let categoryClinic: number;
let categoryGarage: number;
let ownerId: number;
let reviewSeq = 0;

function requiredCategory(found: Map<string, string>, slug: string): number {
    const id = found.get(slug);
    assert.ok(id !== undefined, `the seeded category '${slug}' is missing; the directory fixtures need it`);
    return Number(id);
}

/**
 * The slugs in a directory response, in the order the server returned them.
 *
 * The API names the column `business_slug`, matching the rest of this codebase
 * rather than the shorter `slug` the brief used in prose.
 */
function slugsOf(res: { body: { data: Array<Record<string, unknown>> } }): string[] {
    return res.body.data.map((b) => b['business_slug'] as string);
}

async function hash(): Promise<string> {
    return bcrypt.hash(PASSWORD, 4);
}

async function createUser(email: string, fullName = 'Directory Owner'): Promise<number> {
    const { rows } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active') RETURNING user_id`,
        [email, await hash(), fullName],
    );
    return Number(rows[0]!.user_id);
}

/**
 * Inserts a business directly, bypassing the API.
 *
 * The lifecycle states the directory has to filter on (suspended, unverified,
 * soft-deleted) are not reachable through any endpoint, so the only honest way
 * to test the filter is to set the columns the way an administrator would.
 */
async function insertBusiness(options: {
    name: string;
    slug: string;
    city?: string | null;
    categoryId?: number | null;
    status?: 'active' | 'pending' | 'suspended' | 'rejected' | 'inactive';
    verified?: boolean;
    featured?: boolean;
    deletedAt?: string | null;
    whatsapp?: string | null;
    address?: string | null;
    phone?: string | null;
    description?: string | null;
}): Promise<number> {
    const verified = options.verified ?? true;
    const status = options.status ?? 'active';
    const { rows } = await adminPool.query<{ business_id: string }>(
        `INSERT INTO businesses
            (business_name, business_slug, business_description, phone, whatsapp_number, email,
             address, city, district, business_category_id, is_featured,
             status, verification_status, is_verified, verified_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 $12::business_status,
                 CASE WHEN $13 THEN 'verified'::verification_status ELSE 'pending'::verification_status END,
                 $13, CASE WHEN $13 THEN now() ELSE NULL END,
                 $14::timestamptz)
         RETURNING business_id`,
        [
            options.name,
            options.slug,
            options.description ?? `${options.name} short description`,
            options.phone ?? '+252610000000',
            options.whatsapp ?? null,
            `${options.slug}@hq.test`,
            options.address ?? '1 Test Street',
            options.city === undefined ? 'Mogadishu' : options.city,
            'Central',
            options.categoryId ?? null,
            options.featured ?? false,
            status,
            verified,
            options.deletedAt ?? null,
        ],
    );
    return Number(rows[0]!.business_id);
}

/**
 * Adds a published (or otherwise) review from its own reviewer account.
 *
 * A separate account per review, because reviews_business_user_unique allows
 * exactly one review per (business, user). Reusing the customer would fail on
 * the second review and hide the fact that the fixtures were wrong.
 */
async function addReview(
    businessId: number,
    rating: number,
    text: string,
    status: 'published' | 'pending' | 'hidden' | 'rejected' = 'published',
    reviewerName = 'Directory Customer',
): Promise<number> {
    const reviewerId = await createUser(`reviewer-${reviewSeq++}@hq.test`, reviewerName);
    const { rows } = await adminPool.query<{ review_id: string }>(
        `INSERT INTO reviews (business_id, user_id, rating, review_text, status)
         VALUES ($1, $2, $3, $4, $5::review_status) RETURNING review_id`,
        [businessId, reviewerId, rating, text, status],
    );
    return Number(rows[0]!.review_id);
}

async function setOpeningHours(
    businessId: number,
    rows: Array<{ day: number; open: string; close: string } | { day: number; closed: true }>,
): Promise<void> {
    for (const row of rows) {
        if ('closed' in row) {
            await adminPool.query(
                `INSERT INTO business_opening_hours (business_id, day_of_week, is_closed)
                 VALUES ($1, $2, TRUE)`,
                [businessId, row.day],
            );
        } else {
            await adminPool.query(
                `INSERT INTO business_opening_hours (business_id, day_of_week, opens_at, closes_at)
                 VALUES ($1, $2, $3::time, $4::time)`,
                [businessId, row.day, row.open, row.close],
            );
        }
    }
}

before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;

    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    ownerId = await createUser('directory-owner@hq.test');

    // A missing fixture must fail here with a clear message. Letting it through
    // turns the category id into NaN and the failure surfaces much later as
    // "invalid input syntax for type bigint", which says nothing about the cause.
    const { rows: categories } = await adminPool.query<{ category_id: string; category_slug: string }>(
        `SELECT category_id, category_slug FROM business_categories
          WHERE category_slug IN ('healthcare', 'restaurants', 'transportation')`,
    );
    const found = new Map(categories.map((c) => [c.category_slug, c.category_id]));
    categoryClinic = requiredCategory(found, 'healthcare');
    categoryGarage = requiredCategory(found, 'transportation');

    clinic = {
        id: await insertBusiness({ name: 'Bright Smile Clinic', slug: 'bright-smile-clinic', categoryId: categoryClinic, city: 'Mogadishu' }),
        name: 'Bright Smile Clinic',
        business_slug: 'bright-smile-clinic',
    };
    grill = {
        id: await insertBusiness({ name: 'Harbour Grill', slug: 'harbour-grill', city: 'Hargeisa', whatsapp: '+252610000999' }),
        name: 'Harbour Grill',
        business_slug: 'harbour-grill',
    };
    garage = {
        id: await insertBusiness({ name: 'Quick Fix Garage', slug: 'quick-fix-garage', categoryId: categoryGarage, city: 'Mogadishu' }),
        name: 'Quick Fix Garage',
        business_slug: 'quick-fix-garage',
    };
    featuredClinic = {
        id: await insertBusiness({
            name: 'Featured Care Point',
            slug: 'featured-care-point',
            categoryId: categoryClinic,
            city: 'Mogadishu',
            featured: true,
        }),
        name: 'Featured Care Point',
        business_slug: 'featured-care-point',
    };

    // the three that must never surface
    suspended = {
        id: await insertBusiness({ name: 'Suspended Shop', slug: 'suspended-shop', status: 'suspended', verified: false }),
        name: 'Suspended Shop',
        business_slug: 'suspended-shop',
    };
    unverified = {
        id: await insertBusiness({ name: 'Unverified Clinic', slug: 'unverified-clinic', status: 'active', verified: false }),
        name: 'Unverified Clinic',
        business_slug: 'unverified-clinic',
    };
    softDeleted = {
        id: await insertBusiness({ name: 'Removed Shop', slug: 'removed-shop', deletedAt: '2026-01-01T00:00:00Z' }),
        name: 'Removed Shop',
        business_slug: 'removed-shop',
    };

    // ratings: the featured business is rated highest, the clinic is mid
    await addReview(garage.id, 5, 'Excellent work', 'published', 'Amina Warsame');
    await addReview(garage.id, 4, 'Fast and friendly', 'published', 'Hassan Ali');
    await addReview(clinic.id, 3, 'Fine, a long wait', 'published', 'Fatima Noor');
    await addReview(featuredClinic.id, 5, 'Outstanding service', 'published', 'Omar Aden');
    await addReview(featuredClinic.id, 5, 'Second five star visit', 'published', 'Layla Farah');

    // these must never be counted or shown
    await addReview(clinic.id, 1, 'Pending moderation', 'pending');
    await addReview(clinic.id, 1, 'Hidden by the business', 'hidden');
    await addReview(suspended.id, 5, 'Review on a suspended business', 'published');

    await setOpeningHours(clinic.id, [
        { day: 0, closed: true },
        { day: 1, open: '08:00', close: '17:00' },
        { day: 2, open: '08:00', close: '17:00' },
    ]);

    // the owner relationship exists, so a leak would have something to leak
    const { rows: roleRows } = await adminPool.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business'`,
    );
    await adminPool.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [clinic.id, ownerId, roleRows[0]!.role_id],
    );
});

after(async () => {
    await closePools?.();
});

describe('GET /api/businesses: only public businesses are listed', () => {
    it('lists verified active businesses without authentication', async () => {
        const res = await request(app).get('/api/businesses');

        assert.equal(res.status, 200);
        const slugs = slugsOf(res);
        assert.ok(slugs.includes('bright-smile-clinic'));
        assert.ok(slugs.includes('harbour-grill'));
    });

    it('does not list a suspended business', async () => {
        const res = await request(app).get('/api/businesses');
        const slugs = slugsOf(res);
        assert.ok(!slugs.includes('suspended-shop'), 'a suspended business is not public');
    });

    it('does not list an active but unverified business', async () => {
        // This is the case RLS does not cover on its own:
        // app_business_is_public() only requires status = 'active'.
        const res = await request(app).get('/api/businesses');
        const slugs = slugsOf(res);
        assert.ok(!slugs.includes('unverified-clinic'), 'active is not enough, verification is required');
    });

    it('does not list a soft-deleted business', async () => {
        const res = await request(app).get('/api/businesses');
        const slugs = slugsOf(res);
        assert.ok(!slugs.includes('removed-shop'));
    });
});

describe('GET /api/businesses: the payload carries nothing private', () => {
    it('returns exactly the documented card fields', async () => {
        const res = await request(app).get('/api/businesses');
        const card = res.body.data.find((b: Fixture) => b['business_slug'] === 'bright-smile-clinic');

        assert.ok(card, 'the clinic is in the listing');
        for (const key of [
            'business_id',
            'business_name',
            'business_slug',
            'category_name',
            'city',
            'district',
            'average_rating',
            'review_count',
            'logo_url',
            'cover_image_url',
            'business_description',
        ]) {
            assert.ok(key in card, `the card is missing ${key}`);
        }
    });

    it('carries no owner, moderation or internal field', async () => {
        const res = await request(app).get('/api/businesses');

        for (const business of res.body.data) {
            for (const key of FORBIDDEN_KEYS) {
                assert.ok(
                    !(key in business),
                    `the public listing leaked ${key} on ${business['business_slug']}`,
                );
            }
        }
    });

    it('carries no owner email anywhere in the raw body', async () => {
        const res = await request(app).get('/api/businesses');
        const raw = JSON.stringify(res.body);
        assert.ok(!raw.includes('directory-owner@hq.test'), 'the owner account email is not published');
        assert.ok(!raw.includes('"password_hash"'));
        assert.ok(!raw.includes('"created_by"'));
    });
});

describe('GET /api/businesses: filters', () => {
    it('filters by city', async () => {
        const res = await request(app).get('/api/businesses').query({ city: 'Hargeisa' });
        const slugs = slugsOf(res);

        assert.deepEqual(slugs, ['harbour-grill']);
    });

    it('returns nothing for a city with no public business', async () => {
        const res = await request(app).get('/api/businesses').query({ city: 'Kismayo' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data, []);
        assert.equal(res.body.meta.total, 0);
    });

    it('filters by category slug', async () => {
        const res = await request(app).get('/api/businesses').query({ category: 'transportation' });
        const slugs = slugsOf(res);

        assert.ok(slugs.includes('quick-fix-garage'));
        assert.ok(!slugs.includes('bright-smile-clinic'));
    });

    it('filters by category id', async () => {
        const res = await request(app).get('/api/businesses').query({ categoryId: categoryClinic });
        const slugs = slugsOf(res);

        assert.ok(slugs.includes('bright-smile-clinic'));
        assert.ok(!slugs.includes('quick-fix-garage'));
    });

    it('searches the name, case insensitively', async () => {
        const res = await request(app).get('/api/businesses').query({ q: 'SMILE' });
        const slugs = slugsOf(res);
        assert.deepEqual(slugs, ['bright-smile-clinic']);
    });

    it('searches on a substring', async () => {
        const res = await request(app).get('/api/businesses').query({ q: 'fix' });
        const slugs = slugsOf(res);
        assert.deepEqual(slugs, ['quick-fix-garage']);
    });

    it('does not treat a LIKE wildcard as a search term', async () => {
        // Without escaping, '%' matches every row.
        const res = await request(app).get('/api/businesses').query({ q: '%' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data, [], 'a literal % finds nothing');
    });

    it('filters to featured businesses only when asked', async () => {
        const featured = await request(app).get('/api/businesses').query({ featured: 'true' });
        const slugs = slugsOf(featured);
        assert.deepEqual(slugs, ['featured-care-point']);

        const all = await request(app).get('/api/businesses').query({ featured: 'false' });
        const allSlugs = slugsOf(all);
        assert.ok(!allSlugs.includes('featured-care-point'));
    });

    it('combines filters', async () => {
        const res = await request(app)
            .get('/api/businesses')
            .query({ city: 'Mogadishu', category: 'healthcare' });
        const slugs = slugsOf(res).sort();

        assert.deepEqual(slugs, ['bright-smile-clinic', 'featured-care-point']);
    });
});

describe('GET /api/businesses: sorting', () => {
    it('sorts by newest by default', async () => {
        const res = await request(app).get('/api/businesses');
        const ids = res.body.data.map((b: { business_id: string }) => Number(b.business_id));
        const sorted = [...ids].sort((a, b) => b - a);
        assert.deepEqual(ids, sorted);
    });

    it('sorts by rating, highest first', async () => {
        const res = await request(app).get('/api/businesses').query({ sort: 'rating' });
        const slugs = slugsOf(res);

        assert.equal(slugs[0], 'featured-care-point', 'the two five star reviews win');
        assert.ok(
            slugs.indexOf('quick-fix-garage') < slugs.indexOf('bright-smile-clinic'),
            '4.5 sorts above 3',
        );
    });

    it('sorts featured businesses first when asked', async () => {
        const res = await request(app).get('/api/businesses').query({ sort: 'featured' });
        assert.equal(res.body.data[0]['business_slug'], 'featured-care-point');
    });

    it('puts a business with no reviews last rather than first', async () => {
        const res = await request(app).get('/api/businesses').query({ sort: 'rating' });
        const slugs = slugsOf(res);
        assert.equal(slugs[slugs.length - 1], 'harbour-grill', 'no rating sorts last');
    });

    it('reports the rating average and the published review count', async () => {
        const res = await request(app).get('/api/businesses').query({ category: 'healthcare' });
        const card = res.body.data.find((b: Fixture) => b['business_slug'] === 'bright-smile-clinic');

        assert.equal(Number(card.average_rating), 3);
        assert.equal(card.review_count, 1, 'the pending and hidden reviews are not counted');
    });
});

describe('GET /api/businesses: pagination', () => {
    it('defaults to a bounded page size', async () => {
        const res = await request(app).get('/api/businesses');
        assert.equal(res.body.meta.page, 1);
        assert.equal(res.body.meta.limit, 20);
        assert.equal(res.body.meta.hasPrevious, false);
    });

    it('splits results across pages without repeating or dropping a row', async () => {
        const all = await request(app).get('/api/businesses').query({ limit: 50 });
        const expected = slugsOf(all);
        const total = all.body.meta.total;

        const walked: string[] = [];
        const lastPage = Math.ceil(total / 2);
        for (let page = 1; page <= lastPage; page += 1) {
            const res = await request(app).get('/api/businesses').query({ limit: 2, page });
            walked.push(...slugsOf(res));

            assert.equal(res.body.meta.page, page);
            assert.equal(res.body.meta.hasPrevious, page > 1);
            assert.equal(res.body.meta.hasNext, page < lastPage, `page ${page} of ${lastPage}`);
        }

        assert.deepEqual(walked, expected, 'paging is a partition of the full list');
        assert.equal(new Set(walked).size, walked.length, 'no row is served twice');
    });

    it('reports a total that ignores the page size', async () => {
        const res = await request(app).get('/api/businesses').query({ limit: 2 });
        const all = await request(app).get('/api/businesses').query({ limit: 50 });

        assert.equal(res.body.meta.total, all.body.meta.total);
        assert.equal(res.body.meta.totalPages, Math.ceil(all.body.meta.total / 2));
    });

    it('returns an empty page past the end rather than an error', async () => {
        const res = await request(app).get('/api/businesses').query({ page: 999 });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data, []);
    });

    it('caps the page size at 50', async () => {
        const res = await request(app).get('/api/businesses').query({ limit: 500 });
        assert.equal(res.status, 400, 'an uncapped limit is rejected rather than clamped');
    });

    it('rejects a limit of zero and a negative page', async () => {
        assert.equal((await request(app).get('/api/businesses').query({ limit: 0 })).status, 400);
        assert.equal((await request(app).get('/api/businesses').query({ page: 0 })).status, 400);
    });

    it('rejects a non-numeric id or an unknown sort value', async () => {
        assert.equal((await request(app).get('/api/businesses').query({ sort: 'popularity' })).status, 400);
        assert.equal((await request(app).get('/api/businesses').query({ categoryId: 'clinic' })).status, 400);
    });
});

describe('GET /api/businesses/:businessId: the public profile', () => {
    it('returns the full profile without authentication', async () => {
        const res = await request(app).get(`/api/businesses/${clinic.id}`);

        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.business_name, 'Bright Smile Clinic');
        assert.equal(res.body.data.business_slug, 'bright-smile-clinic');
        assert.equal(res.body.data.address, '1 Test Street');
        assert.equal(res.body.data.city, 'Mogadishu');
        assert.equal(res.body.data.phone, '+252610000000');
        assert.ok('business_description' in res.body.data);
    });

    it('includes the WhatsApp number when the business has one', async () => {
        const withIt = await request(app).get(`/api/businesses/${grill.id}`);
        assert.equal(withIt.body.data.whatsapp_number, '+252610000999');

        const without = await request(app).get(`/api/businesses/${clinic.id}`);
        assert.equal(without.body.data.whatsapp_number, null, 'absent, not omitted, so the shape is stable');
    });

    it('returns opening hours for all seven weekdays', async () => {
        const res = await request(app).get(`/api/businesses/${clinic.id}`);
        const hours = res.body.data.opening_hours;

        assert.equal(hours.length, 7, 'a client can render the week without a missing-day branch');
        assert.deepEqual(hours.map((h: { day_of_week: number }) => h.day_of_week), [0, 1, 2, 3, 4, 5, 6]);
        assert.equal(hours[0].is_closed, true, 'Sunday was stated as closed');
        assert.equal(hours[1].opens_at, '08:00:00');
        assert.equal(hours[1].closes_at, '17:00:00');
        assert.equal(hours[3].is_closed, true, 'a day with no row reads as closed');
    });

    it('returns the rating average and count', async () => {
        const res = await request(app).get(`/api/businesses/${clinic.id}`);
        assert.equal(Number(res.body.data.average_rating), 3);
        assert.equal(res.body.data.review_count, 1);
    });

    it('returns a rating distribution with a key for every star', async () => {
        const res = await request(app).get(`/api/businesses/${garage.id}`);
        const distribution = res.body.data.rating_distribution;

        assert.deepEqual(Object.keys(distribution).sort(), ['1', '2', '3', '4', '5']);
        assert.equal(distribution['5'], 1);
        assert.equal(distribution['4'], 1);
        assert.equal(distribution['1'], 0, 'an unused star is zero, not missing');
    });

    it('carries no private field', async () => {
        const res = await request(app).get(`/api/businesses/${clinic.id}`);
        const raw = JSON.stringify(res.body);

        for (const key of FORBIDDEN_KEYS) {
            assert.ok(!(key in res.body.data), `the profile leaked ${key}`);
        }
        assert.ok(!raw.includes('directory-owner@hq.test'));
    });

    it('returns 404 for a suspended business', async () => {
        const res = await request(app).get(`/api/businesses/${suspended.id}`);
        assert.equal(res.status, 404);
    });

    it('returns 404 for an unverified business', async () => {
        const res = await request(app).get(`/api/businesses/${unverified.id}`);
        assert.equal(res.status, 404);
    });

    it('returns 404 for a soft-deleted business and for an id that never existed', async () => {
        assert.equal((await request(app).get(`/api/businesses/${softDeleted.id}`)).status, 404);
        assert.equal((await request(app).get('/api/businesses/99999999')).status, 404);
    });

    it('does not distinguish "not public" from "does not exist"', async () => {
        const hidden = await request(app).get(`/api/businesses/${unverified.id}`);
        const missing = await request(app).get('/api/businesses/99999999');

        assert.equal(hidden.status, missing.status);
        assert.deepEqual(hidden.body.error, missing.body.error, 'the responses are identical');
    });

    it('rejects a non-numeric id', async () => {
        assert.equal((await request(app).get('/api/businesses/not-a-number')).status, 400);
    });
});

describe('GET /api/businesses/slug/:businessSlug: the public profile by slug', () => {
    /**
     * The whole point of the endpoint is that a URL holding a slug resolves
     * without the caller first having to find the numeric id. So the
     * assertions are about parity with the by-id route, not just about a
     * 200: if the two routes ever drift, a client that switched over would
     * quietly start rendering a different payload.
     */
    it('returns the same profile as the by-id route for the same business', async () => {
        const bySlug = await request(app).get('/api/businesses/slug/bright-smile-clinic');
        const byId = await request(app).get(`/api/businesses/${clinic.id}`);

        assert.equal(bySlug.status, 200, JSON.stringify(bySlug.body));
        assert.equal(byId.status, 200, JSON.stringify(byId.body));
        assert.deepEqual(bySlug.body, byId.body, 'the slug route is a different address, not a different payload');
    });

    it('resolves a slug to a verified active business without authentication', async () => {
        const res = await request(app).get('/api/businesses/slug/quick-fix-garage');

        assert.equal(res.status, 200);
        assert.equal(res.body.data.business_name, 'Quick Fix Garage');
        assert.equal(res.body.data.business_slug, 'quick-fix-garage');
        assert.equal(String(res.body.data.business_id), String(garage.id), 'it found the same row');
    });

    it('includes opening hours and the rating aggregates', async () => {
        const res = await request(app).get('/api/businesses/slug/bright-smile-clinic');

        assert.equal(res.body.data.opening_hours.length, 7);
        assert.equal(res.body.data.opening_hours[1].opens_at, '08:00:00');
        assert.equal(Number(res.body.data.average_rating), 3);
        assert.equal(res.body.data.review_count, 1);
        assert.deepEqual(Object.keys(res.body.data.rating_distribution).sort(), ['1', '2', '3', '4', '5']);
    });

    it('carries no private field', async () => {
        const res = await request(app).get('/api/businesses/slug/bright-smile-clinic');
        const raw = JSON.stringify(res.body);

        for (const key of FORBIDDEN_KEYS) {
            assert.ok(!(key in res.body.data), `the profile leaked ${key}`);
        }
        assert.ok(!raw.includes('directory-owner@hq.test'));
    });

    it('exposes the rate limit, so the public limiter is provably in the path', async () => {
        const res = await request(app).get('/api/businesses/slug/bright-smile-clinic');
        const policy = res.headers['ratelimit-policy'] ?? res.headers['x-ratelimit-policy'];

        assert.equal(res.status, 200);
        assert.equal(typeof policy, 'string', 'a rate limit policy header means the limiter ran');
    });

    it('returns 404 for a slug that does not exist', async () => {
        const res = await request(app).get('/api/businesses/slug/no-such-business');
        assert.equal(res.status, 404);
    });

    it('returns 404 for a suspended business', async () => {
        const res = await request(app).get('/api/businesses/slug/suspended-shop');
        assert.equal(res.status, 404);
    });

    it('returns 404 for an active but unverified business', async () => {
        // RLS alone would let this through, exactly as in the listing.
        const res = await request(app).get('/api/businesses/slug/unverified-clinic');
        assert.equal(res.status, 404);
    });

    it('returns 404 for a soft-deleted business', async () => {
        const res = await request(app).get('/api/businesses/slug/removed-shop');
        assert.equal(res.status, 404);
    });

    it('does not distinguish "not public" from "does not exist"', async () => {
        const hidden = await request(app).get('/api/businesses/slug/unverified-clinic');
        const missing = await request(app).get('/api/businesses/slug/no-such-business');

        assert.equal(hidden.status, missing.status);
        assert.deepEqual(hidden.body.error, missing.body.error, 'the responses are identical');
    });

    it('rejects a slug the database could never have stored', async () => {
        // These all violate businesses_slug_format, so answering 400 keeps the
        // constraint check out of the query and states the rule to the caller.
        for (const bad of ['Bright-Smile', 'bright--smile', '-bright', 'bright-', 'bright_smile', 'a'.repeat(121)]) {
            const res = await request(app).get(`/api/businesses/slug/${encodeURIComponent(bad)}`);
            assert.equal(res.status, 400, `"${bad}" is not a slug and must not reach the database`);
        }
    });

    it('does not shadow the by-id route', async () => {
        // `slug` is two segments in, so /businesses/:businessId still owns the
        // one-segment path and a numeric id is not read as a slug.
        const res = await request(app).get(`/api/businesses/${clinic.id}`);
        assert.equal(res.status, 200);
        assert.equal(res.body.data.business_slug, 'bright-smile-clinic');
    });
});

describe('GET /api/categories and /api/cities', () => {
    it('lists categories with their public business counts', async () => {
        const res = await request(app).get('/api/categories');

        assert.equal(res.status, 200);
        const garageCategory = res.body.data.find((c: { category_slug: string }) => c.category_slug === 'transportation');
        const clinicCategory = res.body.data.find((c: { category_slug: string }) => c.category_slug === 'healthcare');
        const emptyCategory = res.body.data.find((c: { category_slug: string }) => c.category_slug === 'clinics-laboratories');

        assert.equal(garageCategory.business_count, 1);
        assert.equal(clinicCategory.business_count, 2, 'the featured clinic counts too');
        assert.equal(emptyCategory.business_count, 0, 'active categories without public businesses remain visible');
    });

    it('excludes suspended and unverified businesses from the counts', async () => {
        const res = await request(app).get('/api/categories');
        const listed = await request(app).get('/api/businesses').query({ limit: 50 });

        const categorised = listed.body.data.filter((b: { category_slug: string | null }) => b.category_slug);
        const sum = res.body.data.reduce(
            (acc: number, c: { business_count: number }) => acc + c.business_count,
            0,
        );

        // Not equal to the listing total: a business with no category is public
        // but appears under no bucket, so the sum can only match the subset.
        assert.equal(sum, categorised.length, 'the counts and the listing agree');
        assert.ok(sum <= listed.body.meta.total);
    });

    it('lists cities with their public business counts', async () => {
        const res = await request(app).get('/api/cities');
        const mogadishu = res.body.data.find((c: { city: string }) => c.city === 'Mogadishu');

        assert.equal(mogadishu.business_count, 3, 'clinic, garage and featured clinic');
        const hargeisa = res.body.data.find((c: { city: string }) => c.city === 'Hargeisa');
        assert.equal(hargeisa.business_count, 1);
    });

    it('does not list a city that only a suspended business is in', async () => {
        // Suspended, not merely present: an active verified business in Ghost
        // Town would be public, and the filter would be correct to include it.
        await insertBusiness({
            name: 'Ghost Town Shop',
            slug: 'ghost-town-shop',
            city: 'Ghost Town',
            status: 'suspended',
            verified: false,
        });
        const res = await request(app).get('/api/cities');
        const cities = res.body.data.map((c: { city: string }) => c.city);

        assert.ok(!cities.includes('Ghost Town'), 'a city with nothing public is not offered as a filter');
    });
});

describe('GET /api/businesses/:businessId/reviews: public reviews only', () => {
    it('lists published reviews without authentication', async () => {
        const res = await request(app).get(`/api/businesses/${garage.id}/reviews`);

        assert.equal(res.status, 200);
        assert.equal(res.body.data.length, 2);
        assert.equal(res.body.meta.total, 2);
    });

    it('excludes pending and hidden reviews', async () => {
        const res = await request(app).get(`/api/businesses/${clinic.id}/reviews`);
        const texts = res.body.data.map((r: { review_text: string }) => r.review_text);

        assert.deepEqual(texts, ['Fine, a long wait']);
        assert.equal(res.body.meta.total, 1, 'the count matches the visible rows');
    });

    it('sorts newest first', async () => {
        const res = await request(app).get(`/api/businesses/${garage.id}/reviews`);
        const times = res.body.data.map((r: { created_at: string }) => new Date(r.created_at).getTime());

        assert.deepEqual(times, [...times].sort((a, b) => b - a));
    });

    it('shows the author display name but not the account', async () => {
        const res = await request(app).get(`/api/businesses/${garage.id}/reviews`);
        const names = res.body.data.map((r: { author_name: string }) => r.author_name).sort();

        assert.deepEqual(names, ['Amina Warsame', 'Hassan Ali']);
        for (const review of res.body.data) {
            assert.ok(!('user_id' in review), 'the reviewer account id is not published');
        }
        assert.ok(
            !JSON.stringify(res.body).includes('reviewer-'),
            'no reviewer email address reaches the public payload',
        );
    });

    it('paginates', async () => {
        const first = await request(app).get(`/api/businesses/${garage.id}/reviews`).query({ limit: 1, page: 1 });
        const second = await request(app).get(`/api/businesses/${garage.id}/reviews`).query({ limit: 1, page: 2 });

        assert.equal(first.body.data.length, 1);
        assert.equal(first.body.meta.hasNext, true);
        assert.equal(second.body.data.length, 1);
        assert.equal(second.body.meta.hasNext, false);
        assert.notEqual(first.body.data[0].review_id, second.body.data[0].review_id);
    });

    it('caps the page size at 50', async () => {
        assert.equal(
            (await request(app).get(`/api/businesses/${garage.id}/reviews`).query({ limit: 500 })).status,
            400,
        );
    });

    it('does not show reviews of a suspended business', async () => {
        const res = await request(app).get(`/api/businesses/${suspended.id}/reviews`);

        assert.equal(res.status, 404);
        assert.equal(res.body.data, undefined, 'the five star review on a suspended business is not served');
    });

    it('returns 404 for a business that does not exist', async () => {
        assert.equal((await request(app).get('/api/businesses/99999999/reviews')).status, 404);
    });
});

describe('The directory is rate limited', () => {
    it('exposes the rate limit, so the middleware is provably in the path', async () => {
        const res = await request(app).get('/api/businesses');
        const policy = res.headers['ratelimit-policy'] ?? res.headers['x-ratelimit-policy'];

        assert.equal(res.status, 200);
        assert.equal(
            typeof policy,
            'string',
            'a rate limit policy header is present, which only happens when the limiter ran',
        );
    });
});
