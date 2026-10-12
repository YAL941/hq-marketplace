import { Router } from 'express';
import { z } from 'zod';
import { badRequest, forbidden, notFound, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { managedImageUrlSchema } from '../media/stored-image-url.js';
import { httpUrlSchema } from '../../validation/http-url.js';
// The phone normaliser lives in the auth module because signup needed it first.
// It is imported rather than copied on purpose: `businesses.phone` and
// `businesses.whatsapp_number` are both CHECK-constrained to `^\+?[0-9]{7,15}$`,
// so a second definition of "a valid number" here would be a second chance to
// disagree with the first about what to store.
import { normalisePhone, PhoneValidationError } from '../auth/phone.js';
import {
    getOpeningHours,
    getRatingDistribution,
    getPublicBusinessProfile,
    getPublicBusinessProfileBySlug,
    getStaffBusiness,
    getStaffOpeningHours,
    incrementProfileView,
    listCategories,
    listCities,
    listPublicBusinesses,
    listPublicReviews,
    replaceOpeningHours,
} from './business.repository.js';
import {
    businessIdParamSchema,
    businessSlugParamSchema,
    directoryQuerySchema,
    pageMeta,
    reviewsQuerySchema,
} from './public-query.js';

export interface BusinessRow {
    business_id: string;
    business_name: string;
    business_slug: string;
    business_description: string | null;
    business_category_id: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    city: string | null;
    district: string | null;
    logo_url: string | null;
    cover_image_url: string | null;
    status: string;
    is_verified: boolean;
    verification_status: string;
    created_at: Date;
    updated_at: Date;
}

/**
 * The profile PATCH schema.
 *
 * Built per request rather than module-level because `logoUrl` and
 * `coverImageUrl` are checked against the business the route resolved: a managed
 * path is only legal under `/uploads/<that id>/`, so the schema cannot exist
 * before the id is known. See `modules/media/stored-image-url.ts`.
 */
function updateSchema(businessId: number) {
    return z
        .object({
            businessName: z.string().min(2).max(200).optional(),
            businessDescription: z.string().max(5000).nullish(),
            businessCategoryId: z.number().int().positive().nullish(),
            phone: z.string().max(20).nullish(),
            whatsapp: z.string().max(20).nullish(),
            email: z.string().email().nullish(),
            website: httpUrlSchema.nullish(),
            address: z.string().max(500).nullish(),
            city: z.string().max(120).nullish(),
            district: z.string().max(120).nullish(),
            latitude: z.number().min(-90).max(90).nullish(),
            longitude: z.number().min(-180).max(180).nullish(),
            deliveryEnabled: z.boolean().optional(),
            deliveryFee: z.number().min(0).max(100000).optional(),
            logoUrl: managedImageUrlSchema(businessId),
            coverImageUrl: managedImageUrlSchema(businessId),
        })
        .refine((v) => Object.keys(v).length > 0, { message: 'Empty patch' });
}

const openingHoursSchema = z
    .array(
        z.object({
            day_of_week: z.number().int().min(0).max(6),
            opens_at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
            closes_at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
            is_closed: z.boolean(),
        }).superRefine((day, ctx) => {
            if (day.is_closed) {
                if (day.opens_at !== null || day.closes_at !== null) {
                    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Closed days cannot have opening times' });
                }
            } else if (!day.opens_at || !day.closes_at || day.closes_at <= day.opens_at) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Opening and closing times must be valid and ordered' });
            }
        }),
    )
    .length(7)
    .superRefine((days, ctx) => {
        if (new Set(days.map((day) => day.day_of_week)).size !== 7) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Each weekday must appear exactly once' });
        }
    });

/**
 * Reduces a submitted number to E.164, or to null when the field is cleared.
 *
 * Both number columns carry a CHECK constraint, so an un-normalised value is not
 * a stored oddity but a rejected statement: without this the caller would get a
 * 500 for typing a number the way everyone types one. Blank means "remove it",
 * which is why null is passed through instead of being normalised.
 */
function normaliseOptionalNumber(value: unknown, field: 'phone' | 'whatsapp'): string | null {
    if (value === null) return null;
    if (typeof value !== 'string') {
        throw badRequest(`${field} must be a string`, { field });
    }
    if (value.trim() === '') return null;
    try {
        return normalisePhone(value);
    } catch (error) {
        if (error instanceof PhoneValidationError) {
            throw badRequest(error.message, { field, reason: error.reason });
        }
        throw error;
    }
}

export const businessRoutes: Router = Router();

/**
 * Public directory listing. No authentication: this is the storefront.
 *
 * The limiter sits on the public read profile rather than being left off,
 * because an unauthenticated endpoint is exactly the one a scraper will find
 * first.
 */
const publicReadLimiter = rateLimiter('public');

businessRoutes.get('/businesses', publicReadLimiter, async (req, res, next) => {
    try {
        const q = directoryQuerySchema.parse(req.query);
        const { items, total } = await withTenant(contextFor(req), (client) =>
            listPublicBusinesses(client, {
                city: q.city,
                categoryId: q.categoryId,
                categorySlug: q.category,
                q: q.q,
                sort: q.sort,
                featured: q.featured,
                page: q.page,
                limit: q.limit,
            }),
        );

        res.json({ data: items, meta: pageMeta(total, q.page, q.limit) });
    } catch (error) {
        next(error);
    }
});

/** The public profile of one business. 404 for anything not publicly visible. */
businessRoutes.get('/businesses/:businessId', publicReadLimiter, async (req, res, next) => {
    try {
        const businessId = businessIdParamSchema.parse(req.params['businessId']);

        const { profile, openingHours } = await withTenant(contextFor(req), async (client) => {
            const profile = await getPublicBusinessProfile(client, businessId);
            if (!profile) throw notFound('Business not found');
            await incrementProfileView(client, businessId);
            const openingHours = await getOpeningHours(client, businessId);
            return { profile, openingHours };
        });

        res.json({ data: { ...profile, opening_hours: openingHours } });
    } catch (error) {
        next(error);
    }
});

/**
 * The public profile addressed by slug.
 *
 * This is the same response as `GET /businesses/:businessId` under the same
 * visibility rule and the same 404, because it calls the same repository
 * function through the same `PUBLIC_BUSINESS_PREDICATE`. A slug in a URL is
 * the handle a visitor actually holds, so it has to resolve without first
 * finding the numeric id.
 *
 * Two segments deep, so it never collides with `/businesses/:businessId`.
 */
businessRoutes.get('/businesses/slug/:businessSlug', publicReadLimiter, async (req, res, next) => {
    try {
        const businessSlug = businessSlugParamSchema.parse(req.params['businessSlug']);

        const { profile, openingHours } = await withTenant(contextFor(req), async (client) => {
            const profile = await getPublicBusinessProfileBySlug(client, businessSlug);
            // Same body as the by-id lookup, for a missing slug and for a slug
            // that exists but is not public. Distinguishing the two would turn
            // this into a way to discover which businesses are suspended.
            if (!profile) throw notFound('Business not found');
            const businessId = Number(profile.business_id);
            await incrementProfileView(client, businessId);
            const openingHours = await getOpeningHours(client, businessId);
            return { profile, openingHours };
        });

        res.json({ data: { ...profile, opening_hours: openingHours } });
    } catch (error) {
        next(error);
    }
});

/** Published reviews of a public business, newest first. */
businessRoutes.get('/businesses/:businessId/reviews', publicReadLimiter, async (req, res, next) => {
    try {
        const businessId = businessIdParamSchema.parse(req.params['businessId']);
        const q = reviewsQuerySchema.parse(req.query);

        const { items, total } = await withTenant(contextFor(req), (client) =>
            listPublicReviews(client, businessId, q.page, q.limit),
        );

        if (total === 0 && !(await publicBusinessExists(contextFor(req), businessId))) {
            // A business that exists but is not public must be indistinguishable
            // from one that does not exist, or the endpoint becomes a way to
            // probe which ids are real.
            throw notFound('Business not found');
        }

        res.json({ data: items, meta: pageMeta(total, q.page, q.limit) });
    } catch (error) {
        next(error);
    }
});

/** Categories with the number of public businesses in each. */
businessRoutes.get('/categories', publicReadLimiter, async (req, res, next) => {
    try {
        const categories = await withTenant(contextFor(req), (client) => listCategories(client));
        res.json({ data: categories, meta: { count: categories.length } });
    } catch (error) {
        next(error);
    }
});

/** Cities that have at least one public business, with their counts. */
businessRoutes.get('/cities', publicReadLimiter, async (req, res, next) => {
    try {
        const cities = await withTenant(contextFor(req), (client) => listCities(client));
        res.json({ data: cities, meta: { count: cities.length } });
    } catch (error) {
        next(error);
    }
});

/** Exists and is publicly visible. Used to keep a 404 from leaking an id. */
async function publicBusinessExists(
    ctx: ReturnType<typeof contextFor>,
    businessId: number,
): Promise<boolean> {
    return withTenant(ctx, async (client) => {
        const { rows } = await client.query<{ exists: boolean }>(
            'SELECT EXISTS (SELECT 1 FROM businesses b WHERE b.business_id = $1) AS exists',
            [businessId],
        );
        return rows[0]?.exists === true;
    });
}

/**
 * Business profile update.
 *
 * The business id comes from the resolved business context, never from the
 * body, and the permission is checked by the database. A business owner
 * therefore cannot touch another business even by sending its id.
 */
businessRoutes.patch('/business/:businessId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const patch = updateSchema(businessId).parse(req.body) as Record<string, unknown>;

        // Normalised before the column map is walked, so the value that reaches
        // SQL is the one that satisfies the CHECK constraint.
        if (patch['phone'] !== undefined) patch['phone'] = normaliseOptionalNumber(patch['phone'], 'phone');
        if (patch['whatsapp'] !== undefined) patch['whatsapp'] = normaliseOptionalNumber(patch['whatsapp'], 'whatsapp');

        const columns: Record<string, string> = {
            businessName: 'business_name',
            businessDescription: 'business_description',
            businessCategoryId: 'business_category_id',
            phone: 'phone',
            whatsapp: 'whatsapp_number',
            email: 'email',
            website: 'website',
            address: 'address',
            city: 'city',
            district: 'district',
            latitude: 'latitude',
            longitude: 'longitude',
            deliveryEnabled: 'delivery_enabled',
            deliveryFee: 'delivery_fee',
            logoUrl: 'logo_url',
            coverImageUrl: 'cover_image_url',
        };
        const sets: string[] = [];
        const params: unknown[] = [businessId];
        for (const [key, column] of Object.entries(columns)) {
            const value = patch[key];
            if (value !== undefined) {
                params.push(value);
                sets.push(`${column} = $${params.length}`);
            }
        }

        const business = await withTenant(contextFor(req, businessId), async (client) => {
            const { rows: allowed } = await client.query<{ allowed: boolean }>(
                `SELECT (app_has_business_permission($1, 'business.edit') OR app_is_platform_admin()) AS allowed`,
                [businessId],
            );
            if (allowed[0]?.allowed !== true) throw forbidden('Missing permission: business.edit');
            if (sets.length === 0) {
                const { rows } = await client.query<BusinessRow>('SELECT * FROM businesses WHERE business_id = $1', [
                    businessId,
                ]);
                if (!rows[0]) throw notFound('Business not found');
                return rows[0];
            }
            const { rows } = await client.query<BusinessRow>(
                `UPDATE businesses SET ${sets.join(', ')} WHERE business_id = $1 RETURNING *`,
                params,
            );
            if (!rows[0]) throw notFound('Business not found');
            return rows[0];
        });

        res.json({ data: business });
    } catch (error) {
        next(error);
    }
});

/**
 * The business as its own staff sees it.
 *
 * `GET /businesses/:businessId` answers 404 for a business that is not public
 * yet, which is correct for a visitor and useless for the owner of a business
 * that was registered five minutes ago and is still pending. This route is that
 * missing read: same authentication and same membership check as every other
 * `/business/:businessId` route, but no visibility predicate, so `pending` and
 * `rejected` businesses come back with the reason attached.
 *
 * It is a GET on the same path as the PATCH below and carries the same tenant
 * context, so what it returns is bounded twice: `resolveBusiness` refuses a
 * caller who is not a member, and the `businesses_staff_read` policy returns
 * nothing at all for one.
 */
businessRoutes.get('/business/:businessId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const business = await withTenant(contextFor(req, businessId), (client) => getStaffBusiness(client, businessId));
        if (!business) throw notFound('Business not found');
        res.json({ data: business });
    } catch (error) {
        next(error);
    }
});

/** Analytics for the current business only, read from the statistics cache. */
businessRoutes.get('/business/:businessId/statistics', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const period = z.enum(['7d', '30d', 'this_year']).default('7d').parse(req.query['period']);
        const stats = await withTenant(contextFor(req, businessId), async (client) => {
            await client.query('SELECT refresh_business_statistics($1)', [businessId]);
            const { rows } = await client.query(
                'SELECT * FROM business_statistics WHERE business_id = $1',
                [businessId],
            );
            if (!rows[0]) return null;
            const { rows: viewRows } = await client.query<{ total_views: string }>(
                'SELECT total_views::text FROM business_profile_views WHERE business_id = $1',
                [businessId],
            );
            const { rows: listingRows } = await client.query<{
                active_products: number;
                active_services: number;
            }>(
                `SELECT
                    (SELECT count(*)::int FROM products
                      WHERE business_id = $1 AND status = 'active' AND deleted_at IS NULL) AS active_products,
                    (SELECT count(*)::int FROM services
                      WHERE business_id = $1 AND status = 'active' AND deleted_at IS NULL) AS active_services`,
                [businessId],
            );
            const { rows: weeklyViewRows } = await client.query<{ date: string; views: number }>(
                `SELECT to_char(days.view_date, 'YYYY-MM-DD') AS date,
                        COALESCE(daily.total_views, 0)::int AS views
                   FROM generate_series(
                            CURRENT_DATE - 6,
                            CURRENT_DATE,
                            INTERVAL '1 day'
                        ) AS days(view_date)
                   LEFT JOIN business_profile_daily_views daily
                     ON daily.business_id = $1
                    AND daily.view_date = days.view_date::date
                  ORDER BY days.view_date`,
                [businessId],
            );
            const ratingDistribution = await getRatingDistribution(client, businessId);
            const { rows: periodRows } = await client.query<{
                from_date: string;
                to_date: string;
                profile_views: string;
                total_orders: number;
                completed_orders: number;
                cancelled_orders: number;
                pending_orders: number;
                total_customers: number;
                total_reviews: number;
                average_rating: string;
                rating_distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
                daily_views: Array<{ date: string; views: number }>;
            }>(
                `WITH bounds AS (
                    SELECT CASE $2::text
                               WHEN '7d' THEN CURRENT_DATE - 6
                               WHEN '30d' THEN CURRENT_DATE - 29
                               ELSE date_trunc('year', CURRENT_DATE)::date
                           END AS from_date,
                           CURRENT_DATE AS to_date
                ),
                daily_views AS (
                    SELECT days.view_date::date AS view_date,
                           COALESCE(daily.total_views, 0)::int AS views
                      FROM bounds
                      CROSS JOIN LATERAL generate_series(
                          bounds.from_date,
                          bounds.to_date,
                          INTERVAL '1 day'
                      ) AS days(view_date)
                      LEFT JOIN business_profile_daily_views daily
                        ON daily.business_id = $1
                       AND daily.view_date = days.view_date::date
                ),
                order_totals AS (
                    SELECT count(*)::int AS total_orders,
                           count(*) FILTER (WHERE o.order_status = 'completed')::int AS completed_orders,
                           count(*) FILTER (WHERE o.order_status IN ('cancelled', 'rejected'))::int AS cancelled_orders,
                           count(*) FILTER (WHERE o.order_status = 'pending')::int AS pending_orders,
                           count(DISTINCT o.customer_id)::int AS total_customers
                      FROM orders o
                      CROSS JOIN bounds
                     WHERE o.business_id = $1
                       AND o.created_at >= bounds.from_date
                       AND o.created_at < bounds.to_date + INTERVAL '1 day'
                ),
                review_totals AS (
                    SELECT count(*)::int AS total_reviews,
                           COALESCE(round(avg(rv.rating), 2), 0)::text AS average_rating
                      FROM reviews rv
                      CROSS JOIN bounds
                     WHERE rv.business_id = $1
                       AND rv.status = 'published'
                       AND rv.created_at >= bounds.from_date
                       AND rv.created_at < bounds.to_date + INTERVAL '1 day'
                ),
                rating_counts AS (
                    SELECT stars.rating,
                           count(rv.review_id)::int AS review_count
                      FROM generate_series(1, 5) AS stars(rating)
                      LEFT JOIN bounds ON TRUE
                      LEFT JOIN reviews rv
                        ON rv.business_id = $1
                       AND rv.status = 'published'
                       AND rv.rating = stars.rating
                       AND rv.created_at >= bounds.from_date
                       AND rv.created_at < bounds.to_date + INTERVAL '1 day'
                     GROUP BY stars.rating
                )
                SELECT bounds.from_date::text AS from_date,
                       bounds.to_date::text AS to_date,
                       COALESCE((SELECT sum(views) FROM daily_views), 0)::text AS profile_views,
                       order_totals.total_orders,
                       order_totals.completed_orders,
                       order_totals.cancelled_orders,
                       order_totals.pending_orders,
                       order_totals.total_customers,
                       review_totals.total_reviews,
                       review_totals.average_rating,
                       (SELECT jsonb_object_agg(rating::text, review_count ORDER BY rating)
                          FROM rating_counts) AS rating_distribution,
                       (SELECT jsonb_agg(
                           jsonb_build_object(
                               'date', to_char(view_date, 'YYYY-MM-DD'),
                               'views', views
                           ) ORDER BY view_date
                        ) FROM daily_views) AS daily_views
                  FROM bounds
                  CROSS JOIN order_totals
                  CROSS JOIN review_totals`,
                [businessId, period],
            );
            const activeListings = listingRows[0]!;
            const periodStats = periodRows[0]!;
            return {
                ...rows[0],
                profile_views: viewRows[0]?.total_views ?? '0',
                ...activeListings,
                active_listings: activeListings.active_products + activeListings.active_services,
                weekly_views: weeklyViewRows,
                rating_distribution: ratingDistribution,
                period_stats: {
                    period,
                    from_date: periodStats.from_date,
                    to_date: periodStats.to_date,
                    profile_views: periodStats.profile_views,
                    total_orders: periodStats.total_orders,
                    completed_orders: periodStats.completed_orders,
                    cancelled_orders: periodStats.cancelled_orders,
                    pending_orders: periodStats.pending_orders,
                    total_customers: periodStats.total_customers,
                    total_reviews: periodStats.total_reviews,
                    average_rating: periodStats.average_rating,
                    rating_distribution: periodStats.rating_distribution,
                    daily_views: periodStats.daily_views,
                },
            };
        });
        res.json({ data: stats, meta: { businessId } });
    } catch (error) {
        next(error);
    }
});

/** The owner-facing editor for the business's public weekly schedule. */
businessRoutes.get('/business/:businessId/opening-hours', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const hours = await withTenant(contextFor(req, businessId), (client) =>
            getStaffOpeningHours(client, businessId),
        );
        res.json({ data: hours, meta: { count: hours.length } });
    } catch (error) {
        next(error);
    }
});

businessRoutes.put('/business/:businessId/opening-hours', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const hours = openingHoursSchema.parse(req.body);
        const saved = await withTenant(contextFor(req, businessId), async (client) => {
            const { rows } = await client.query<{ allowed: boolean }>(
                `SELECT (app_has_business_permission($1, 'business.edit') OR app_is_platform_admin()) AS allowed`,
                [businessId],
            );
            if (rows[0]?.allowed !== true) throw forbidden('Missing permission: business.edit');
            return replaceOpeningHours(client, businessId, hours);
        });
        res.json({ data: saved, meta: { count: saved.length, businessId } });
    } catch (error) {
        next(error);
    }
});

/** Business staff directory: members of THIS business only. */
businessRoutes.get('/business/:businessId/members', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const members = await withTenant(contextFor(req, businessId), async (client) => {
            const { rows } = await client.query(
                `SELECT bu.business_user_id, bu.user_id, u.full_name, u.email, r.role_key, r.role_name, bu.status, bu.joined_at
                   FROM business_users bu
                   JOIN users u ON u.user_id = bu.user_id
                   JOIN roles r ON r.role_id = bu.role_id
                  WHERE bu.business_id = $1
                  ORDER BY r.rank DESC, bu.created_at`,
                [businessId],
            );
            return rows;
        });
        res.json({ data: members, meta: { count: members.length, businessId } });
    } catch (error) {
        next(error);
    }
});

/** Invite or add a member. One user may belong to several businesses. */
businessRoutes.post('/business/:businessId/members', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const { userId, roleKey } = z
            .object({ userId: z.number().int().positive(), roleKey: z.enum(['business_owner', 'business_manager', 'business_employee']) })
            .parse(req.body);

        const member = await withTenant(contextFor(req, businessId), async (client) => {
            const { rows: allowed } = await client.query<{ allowed: boolean }>(
                `SELECT (app_has_business_permission($1, 'employees.manage') OR app_is_platform_admin()) AS allowed`,
                [businessId],
            );
            if (allowed[0]?.allowed !== true) throw forbidden('Missing permission: employees.manage');

            const { rows: roleRows } = await client.query<{ role_id: string }>(
                `SELECT role_id FROM roles WHERE role_key = $1 AND scope = 'business' AND is_active`,
                [roleKey],
            );
            const role = roleRows[0];
            if (!role) throw notFound('Role not found');

            const { rows } = await client.query(
                `INSERT INTO business_users (business_id, user_id, role_id, status, invited_by, joined_at)
                 VALUES ($1, $2, $3, 'active', $4, now())
                 RETURNING business_user_id, business_id, user_id, role_id, status, joined_at`,
                [businessId, userId, role.role_id, req.user!.id],
            );
            return rows[0];
        });
        res.status(201).json({ data: member });
    } catch (error) {
        next(error);
    }
});
