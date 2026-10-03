/**
 * Read-only queries behind the public directory.
 *
 * Two rules govern every statement in this file.
 *
 * 1. **Explicit column list, never `SELECT *`.** The businesses table carries
 *    `created_by`, `verified_by`, `rejection_reason` and an internal
 *    `status`; a `SELECT *` here would publish all of them. Requirement: a
 *    public payload contains only what a visitor is meant to see.
 *
 * 2. **The visibility predicate is written out, not inherited.**
 *    `app_business_is_public()`, which the RLS policies use, treats
 *    `status = 'active'` as enough. A business can be active and still be
 *    unverified, and an unverified business must not be listed, so
 *    PUBLIC_BUSINESS_PREDICATE adds the verification half explicitly. RLS still
 *    runs on top; this filter is strictly narrower, never wider.
 */

import type { PoolClient } from 'pg';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './public-query.js';

/** The columns a directory card is allowed to contain. */
const DIRECTORY_COLUMNS = `
    b.business_id,
    b.business_name,
    b.business_slug,
    c.category_name,
    c.category_slug,
    b.city,
    b.district,
    b.logo_url,
    b.cover_image_url,
    b.business_description,
    b.is_featured,
    b.created_at
`;

export interface PublicBusinessCard {
    business_id: string;
    business_name: string;
    business_slug: string;
    category_name: string | null;
    category_slug: string | null;
    city: string | null;
    district: string | null;
    logo_url: string | null;
    cover_image_url: string | null;
    business_description: string | null;
    is_featured: boolean;
    created_at: Date;
    average_rating: string | null;
    review_count: number;
    is_open_now?: boolean;
}

export interface PublicBusinessProfile extends PublicBusinessCard {
    business_description: string | null;
    address: string | null;
    phone: string | null;
    whatsapp_number: string | null;
    website: string | null;
    latitude: number | null;
    longitude: number | null;
    rating_distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface OpeningHoursRow {
    day_of_week: number;
    opens_at: string | null;
    closes_at: string | null;
    is_closed: boolean;
}

export interface PublicReview {
    review_id: string;
    rating: number;
    review_text: string | null;
    business_response: string | null;
    responded_at: Date | null;
    created_at: Date;
    /** Display name only. The reviewer's own account is never published. */
    author_name: string;
}

/**
 * A business is public when it is active, verified and not soft-deleted.
 *
 * The soft delete and the active flag are also what RLS checks, so this
 * predicate cannot be used to widen visibility; it exists to apply the
 * verification half, which RLS deliberately leaves to the application.
 */
export const PUBLIC_BUSINESS_PREDICATE = `
    b.status = 'active'
    AND b.is_verified = TRUE
    AND b.verification_status = 'verified'
    AND b.deleted_at IS NULL
`;

/** Published review aggregates, reused by the list, the card and the profile. */
const REVIEW_AGGREGATE = `
    LEFT JOIN LATERAL (
        SELECT count(*)::int AS review_count,
               round(avg(rv.rating), 2) AS average_rating
          FROM reviews rv
         WHERE rv.business_id = b.business_id
           AND rv.status = 'published'
    ) rv ON TRUE
`;

export interface DirectoryQuery {
    city?: string;
    categoryId?: number;
    categorySlug?: string;
    q?: string;
    sort: 'newest' | 'rating' | 'featured';
    featured?: boolean;
    page: number;
    limit: number;
}

/**
 * The directory listing, plus a total count for the pager.
 *
 * Rating is aggregated live from published reviews rather than read from
 * `business_statistics`, because that table is a cache refreshed by
 * `refresh_business_statistics()` and would sort a public page by a number
 * that may be hours stale.
 */
export async function listPublicBusinesses(
    client: PoolClient,
    query: DirectoryQuery,
): Promise<{ items: PublicBusinessCard[]; total: number }> {
    const conditions = [PUBLIC_BUSINESS_PREDICATE];
    const params: unknown[] = [];

    if (query.city !== undefined) {
        params.push(query.city);
        conditions.push(`b.city = $${params.length}`);
    }
    if (query.categoryId !== undefined) {
        params.push(query.categoryId);
        conditions.push(`b.business_category_id = $${params.length}`);
    }
    if (query.categorySlug !== undefined) {
        params.push(query.categorySlug);
        conditions.push(`c.category_slug = $${params.length}`);
    }
    if (query.q !== undefined) {
        // Case-insensitive substring, parameterised. The index
        // ix_businesses_name_lower exists for the equality form; a substring
        // cannot use it, which is why `q` is capped in the query schema.
        params.push(`%${escapeLike(query.q.toLowerCase())}%`);
        conditions.push(`lower(b.business_name) LIKE $${params.length} ESCAPE '\\'`);
    }
    if (query.featured !== undefined) {
        params.push(query.featured);
        conditions.push(`b.is_featured = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const orderBy = {
        // Featured is a promotion, so it outranks everything, and rating
        // breaks the tie rather than created_at: a promoted business nobody
        // reviewed should not sit above a promoted business everyone did.
        featured: 'b.is_featured DESC, rv.average_rating DESC NULLS LAST, b.created_at DESC',
        rating: 'rv.average_rating DESC NULLS LAST, rv.review_count DESC, b.created_at DESC',
        newest: 'b.created_at DESC',
    }[query.sort];

    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    const pageParams = [...params, query.limit, (query.page - 1) * query.limit];

    const { rows } = await client.query<PublicBusinessCard>(
        `SELECT ${DIRECTORY_COLUMNS},
                rv.review_count,
                rv.average_rating
           FROM businesses b
           LEFT JOIN business_categories c ON c.category_id = b.business_category_id
           ${REVIEW_AGGREGATE}
          WHERE ${where}
          ORDER BY ${orderBy}
          LIMIT $${limitParam} OFFSET $${offsetParam}`,
        pageParams,
    );

    const { rows: countRows } = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM businesses b
           LEFT JOIN business_categories c ON c.category_id = b.business_category_id
          WHERE ${where}`,
        params,
    );

    return { items: rows, total: countRows[0]?.total ?? 0 };
}

/**
 * The public profile.
 *
 * `phone`, `whatsapp_number` and `website` are the business's own contact
 * details and are meant to be public; the account that owns the business is
 * not, and is not joined here.
 */
export async function getPublicBusinessProfile(
    client: PoolClient,
    businessId: number,
): Promise<PublicBusinessProfile | null> {
    return getPublicBusinessProfileWhere(client, 'b.business_id = $1', [businessId]);
}

/**
 * The same profile, addressed by the slug a public URL carries.
 *
 * This deliberately goes through `getPublicBusinessProfileWhere` rather than
 * repeating the statement. The column list *is* the privacy boundary here, so a
 * second copy of the query is a second chance to forget that `created_by`,
 * `verified_by` and the internal `status` are not on it.
 */
export async function getPublicBusinessProfileBySlug(
    client: PoolClient,
    businessSlug: string,
): Promise<PublicBusinessProfile | null> {
    return getPublicBusinessProfileWhere(client, 'b.business_slug = $1', [businessSlug]);
}

/**
 * One visibility rule and one column list, whatever identifies the business.
 *
 * @param locator a SQL predicate over the `businesses` alias `b`, with one
 * positional placeholder for the parameter
 */
async function getPublicBusinessProfileWhere(
    client: PoolClient,
    locator: string,
    params: unknown[],
): Promise<PublicBusinessProfile | null> {
    const { rows } = await client.query<PublicBusinessProfile>(
        `SELECT ${DIRECTORY_COLUMNS},
                b.business_description,
                b.address,
                b.phone,
                b.whatsapp_number,
                b.website,
                b.latitude,
                b.longitude,
                rv.review_count,
                rv.average_rating
           FROM businesses b
           LEFT JOIN business_categories c ON c.category_id = b.business_category_id
           ${REVIEW_AGGREGATE}
          WHERE ${PUBLIC_BUSINESS_PREDICATE}
            AND ${locator}`,
        params,
    );
    const profile = rows[0];
    if (!profile) return null;

    // Resolved from the row rather than the locator parameter, so the rating
    // counts are read with the same id the profile was selected by.
    return {
        ...profile,
        rating_distribution: await getRatingDistribution(client, Number(profile.business_id)),
    };
}

/** Counts of 1..5 stars over published reviews. Always five keys, never sparse. */
export async function getRatingDistribution(
    client: PoolClient,
    businessId: number,
): Promise<Record<'1' | '2' | '3' | '4' | '5', number>> {
    const { rows } = await client.query<{ rating: number; count: number }>(
        `SELECT rv.rating, count(*)::int AS count
           FROM reviews rv
          WHERE rv.business_id = $1
            AND rv.status = 'published'
          GROUP BY rv.rating`,
        [businessId],
    );

    // Seeded with zeroes so the client can render a bar chart without first
    // checking which stars happen to have been used.
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<'1' | '2' | '3' | '4' | '5', number>;
    for (const row of rows) {
        const key = String(row.rating) as '1' | '2' | '3' | '4' | '5';
        if (key in distribution) distribution[key] = row.count;
    }
    return distribution;
}

/**
 * Opening hours for every weekday.
 *
 * Always returns seven entries: a business that stated nothing still has to be
 * renderable by the same code path as one that stated all seven, so the client
 * never has to handle a missing day.
 */
export async function getOpeningHours(client: PoolClient, businessId: number): Promise<OpeningHoursRow[]> {
    const { rows } = await client.query<OpeningHoursRow>(
        `SELECT oh.day_of_week, oh.opens_at::text, oh.closes_at::text, oh.is_closed
           FROM business_opening_hours oh
           JOIN businesses b ON b.business_id = oh.business_id
          WHERE oh.business_id = $1
            AND ${PUBLIC_BUSINESS_PREDICATE}`,
        [businessId],
    );

    const byDay = new Map(rows.map((row) => [row.day_of_week, row]));
    return Array.from({ length: 7 }, (_unused, day) =>
        byDay.get(day) ?? { day_of_week: day, opens_at: null, closes_at: null, is_closed: true });
}

export interface PublicReviewPage {
    items: PublicReview[];
    total: number;
}

/**
 * Published reviews for one public business, newest first.
 *
 * The rows come from `app_public_reviews()` (migration 010) rather than a join
 * written here. That is not a style choice: `users` has no anonymous read
 * policy, so a plain `JOIN users` in this file returns zero rows for every
 * anonymous caller, with no error to notice.
 *
 * The count is still a normal query because it touches neither users nor any
 * column that needs elevated rights.
 */
export async function listPublicReviews(
    client: PoolClient,
    businessId: number,
    page: number,
    limit: number,
): Promise<PublicReviewPage> {
    const { rows } = await client.query<PublicReview>(
        'SELECT * FROM app_public_reviews($1, $2, $3)',
        [businessId, limit, (page - 1) * limit],
    );

    const { rows: countRows } = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM reviews rv
           JOIN businesses b ON b.business_id = rv.business_id
          WHERE rv.business_id = $1
            AND rv.status = 'published'
            AND ${PUBLIC_BUSINESS_PREDICATE}`,
        [businessId],
    );

    return { items: rows, total: countRows[0]?.total ?? 0 };
}

export interface CategoryWithCount {
    category_id: string;
    category_name: string;
    category_slug: string;
    description: string | null;
    business_count: number;
}

/** Active categories, each with the number of public businesses in it. */
export async function listCategories(client: PoolClient): Promise<CategoryWithCount[]> {
    const { rows } = await client.query<CategoryWithCount>(
        `SELECT c.category_id,
                c.category_name,
                c.category_slug,
                c.description,
                count(b.business_id)::int AS business_count
           FROM business_categories c
           LEFT JOIN businesses b
                  ON b.business_category_id = c.category_id
                 AND ${PUBLIC_BUSINESS_PREDICATE}
          WHERE c.is_active
          GROUP BY c.category_id, c.category_name, c.category_slug, c.description, c.sort_order
          ORDER BY c.sort_order, c.category_name`,
        [],
    );
    return rows;
}

export interface CityWithCount {
    city: string;
    business_count: number;
}

/**
 * Cities that actually have at least one public business.
 *
 * Derived from the businesses table rather than a city dimension table, so it
 * cannot drift out of step with the businesses that exist. A city with a
 * trailing space or a different capitalisation would split into two entries,
 * so the comparison is on the trimmed value.
 */
export async function listCities(client: PoolClient): Promise<CityWithCount[]> {
    const { rows } = await client.query<CityWithCount>(
        `SELECT btrim(b.city) AS city, count(*)::int AS business_count
           FROM businesses b
          WHERE b.city IS NOT NULL
            AND btrim(b.city) <> ''
            AND ${PUBLIC_BUSINESS_PREDICATE}
          GROUP BY btrim(b.city)
          ORDER BY count(*) DESC, btrim(b.city)`,
        [],
    );
    return rows;
}

/**
 * The business as its own staff sees it, whatever state it is in.
 *
 * This is the read the owner dashboard needs and the public profile cannot
 * provide: a business that is still `pending`, or that was `rejected`, is
 * invisible to `getPublicBusinessProfile` by design, yet its owner has to be
 * able to open it, edit it and be told why it is not listed.
 *
 * So the verification columns come back here, and PUBLIC_BUSINESS_PREDICATE is
 * deliberately absent. What replaces it is the `businesses_staff_read` RLS
 * policy, which allows the read only to a member of that business or a platform
 * admin — so dropping the predicate here cannot widen anything: a caller who is
 * neither gets zero rows from the database rather than a row from here.
 *
 * `created_by` and `verified_by` stay out. The owner does not need the internal
 * account ids, and `verified_by` belongs to the admin surface, which has its
 * own endpoint.
 */
export interface StaffBusinessProfile {
    business_id: string;
    business_name: string;
    business_slug: string;
    business_description: string | null;
    business_category_id: string | null;
    category_name: string | null;
    category_slug: string | null;
    phone: string | null;
    whatsapp_number: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    city: string | null;
    district: string | null;
    logo_url: string | null;
    cover_image_url: string | null;
    /** Internal lifecycle state: pending, active, suspended, closed, rejected. */
    status: string;
    /** Verification decision: pending, verified, rejected. */
    verification_status: string;
    is_verified: boolean;
    /** Why it was rejected. Null until a decision says otherwise. */
    rejection_reason: string | null;
    verified_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export async function getStaffBusiness(client: PoolClient, businessId: number): Promise<StaffBusinessProfile | null> {
    const { rows } = await client.query<StaffBusinessProfile>(
        `SELECT b.business_id,
                b.business_name,
                b.business_slug,
                b.business_description,
                b.business_category_id,
                c.category_name,
                c.category_slug,
                b.phone,
                b.whatsapp_number,
                b.email,
                b.website,
                b.address,
                b.city,
                b.district,
                b.logo_url,
                b.cover_image_url,
                b.status,
                b.verification_status,
                b.is_verified,
                b.rejection_reason,
                b.verified_at,
                b.created_at,
                b.updated_at
           FROM businesses b
           LEFT JOIN business_categories c ON c.category_id = b.business_category_id
          WHERE b.business_id = $1`,
        [businessId],
    );
    return rows[0] ?? null;
}

/**
 * Escapes the LIKE wildcards so a search for "50%" looks for that text instead
 * of matching everything.
 */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
