/**
 * Platform administration.
 *
 * The verification queue is the only admin surface that exists, and it exists
 * because without it a business registered through `POST /businesses/register`
 * can never leave `pending`: the onboarding policy in migration 004 forces every
 * self-registered business into that state, and the public directory hides
 * anything that is not active and verified. Somebody has to be able to decide.
 *
 * Two guards, in this order:
 *
 *   1. `requirePlatformAdmin` — a middleware, so an unauthenticated caller gets
 *      401 and an authenticated non-admin gets 403 before any query runs.
 *   2. `business.verify` — checked in the database for the decision itself. That
 *      permission is seeded and granted to `platform_admin` only, so it is the
 *      same rule expressed where the rest of the project's rules live. An owner
 *      cannot approve their own business: they do not hold it.
 *
 * Migration 017 adds review metadata and notification state. Existing
 * verification fields and their consistency constraint remain authoritative
 * for whether a business is publicly listed.
 */

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { sendBusinessDecisionEmail } from './mailer.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMeta } from '../businesses/public-query.js';

export const adminRoutes: Router = Router();

/**
 * 403 for anyone who is not a platform admin.
 *
 * `isPlatformAdmin` is resolved once at login from `user_platform_roles` and
 * travels in the verified token, so this is a claim check rather than a lookup —
 * the database check that actually matters happens in the handler.
 */
const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
    if (!req.user) {
        next(unauthorized());
        return;
    }
    if (!req.user.isPlatformAdmin) {
        next(forbidden('Platform administration required'));
        return;
    }
    next();
};

/**
 * The states a business can be in that an admin has to act on or look at.
 *
 * `suspended` and `closed` are deliberately absent: they are lifecycle states
 * that nothing currently sets, and offering a filter for them would imply an
 * action this API cannot perform.
 */
const ADMIN_STATUSES = ['pending', 'active', 'rejected'] as const;

const listQuerySchema = z.object({
    status: z.enum(['all', ...ADMIN_STATUSES]).default('all'),
    search: z.string().trim().max(120).default(''),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

const decisionSchema = z.object({
    decision: z.enum(['approve', 'reject']),
    /** Rejection reasons are optional, but always bounded. */
    reason: z.string().max(500).nullish(),
});

const statusDecisionSchema = z.object({
    status: z.enum(['active', 'rejected']),
    reason: z.string().max(500).nullish(),
});

const searchPattern = (search: string): string | null => {
    const trimmed = search.trim();
    return trimmed ? `%${trimmed.replace(/[\\%_]/g, '\\$&')}%` : null;
};

export interface AdminBusinessRow {
    business_id: string;
    business_name: string;
    business_slug: string;
    business_description: string | null;
    category_name: string | null;
    category_slug: string | null;
    address: string | null;
    city: string | null;
    district: string | null;
    phone: string | null;
    whatsapp_number: string | null;
    email: string | null;
    status: string;
    verification_status: string;
    is_verified: boolean;
    rejection_reason: string | null;
    verified_at: Date | null;
    reviewed_by?: string | null;
    reviewed_at?: Date | null;
    seen_by_admin?: boolean;
    created_at: Date;
    /** The account that registered it. Enough to contact, nothing more. */
    owner_user_id: string | null;
    owner_full_name: string | null;
    owner_email: string | null;
}

/**
 * The verification queue.
 *
 * `status` filters on the internal `businesses.status`, which is what decides
 * whether a business is listed, so an admin asking for `pending` gets the ones
 * nobody has looked at yet. The owner columns come along because the first
 * question about an application is who is behind it.
 *
 * Paged with `page`/`limit` rather than `offset`, capped at 50 by the shared
 * schema, so this cannot become a way to pull the table.
 */
adminRoutes.get(
    '/admin/businesses',
    authenticate,
    requirePlatformAdmin,
    rateLimiter('public'),
    async (req, res, next) => {
        try {
            const query = listQuerySchema.parse(req.query);
            const offset = (query.page - 1) * query.limit;
            const pattern = searchPattern(query.search);

            const { data, total, counts } = await withTenant(contextFor(req), async (client) => {
                const { rows } = await client.query<AdminBusinessRow>(
                    `SELECT b.business_id,
                            b.business_name,
                            b.business_slug,
                            b.business_description,
                            c.category_name,
                            c.category_slug,
                            b.address,
                            b.city,
                            b.district,
                            b.phone,
                            b.whatsapp_number,
                            b.email,
                            b.status,
                            b.verification_status,
                            b.is_verified,
                            b.rejection_reason,
                            b.verified_at,
                            b.reviewed_by,
                            b.reviewed_at,
                            b.seen_by_admin,
                            b.created_at,
                            b.created_by AS owner_user_id,
                            u.full_name AS owner_full_name,
                            u.email AS owner_email
                       FROM businesses b
                       LEFT JOIN business_categories c ON c.category_id = b.business_category_id
                       LEFT JOIN users u ON u.user_id = b.created_by
                      WHERE ($1 = 'all' OR b.status::text = $1)
                        AND b.deleted_at IS NULL
                        AND ($2::text IS NULL
                             OR b.business_name ILIKE $2 ESCAPE '\\'
                             OR COALESCE(b.email::text, '') ILIKE $2 ESCAPE '\\'
                             OR COALESCE(u.email::text, '') ILIKE $2 ESCAPE '\\')
                      ORDER BY b.created_at DESC, b.business_id DESC
                      LIMIT $3 OFFSET $4`,
                    [query.status, pattern, query.limit, offset],
                );

                const { rows: countRows } = await client.query<{ total: number }>(
                    `SELECT count(*)::int AS total
                       FROM businesses b
                       LEFT JOIN users u ON u.user_id = b.created_by
                      WHERE ($1 = 'all' OR b.status::text = $1)
                        AND b.deleted_at IS NULL
                        AND ($2::text IS NULL
                             OR b.business_name ILIKE $2 ESCAPE '\\'
                             OR COALESCE(b.email::text, '') ILIKE $2 ESCAPE '\\'
                             OR COALESCE(u.email::text, '') ILIKE $2 ESCAPE '\\')`,
                    [query.status, pattern],
                );

                const { rows: countByStatus } = await client.query<{
                    all: number;
                    pending: number;
                    active: number;
                    rejected: number;
                }>(
                    `SELECT count(*)::int AS all,
                            count(*) FILTER (WHERE b.status = 'pending')::int AS pending,
                            count(*) FILTER (WHERE b.status = 'active')::int AS active,
                            count(*) FILTER (WHERE b.status = 'rejected')::int AS rejected
                       FROM businesses b
                       LEFT JOIN users u ON u.user_id = b.created_by
                      WHERE b.deleted_at IS NULL
                        AND ($1::text IS NULL
                             OR b.business_name ILIKE $1 ESCAPE '\\'
                             OR COALESCE(b.email::text, '') ILIKE $1 ESCAPE '\\'
                             OR COALESCE(u.email::text, '') ILIKE $1 ESCAPE '\\')`,
                    [pattern],
                );

                return {
                    data: rows,
                    total: countRows[0]?.total ?? 0,
                    counts: countByStatus[0] ?? { all: 0, pending: 0, active: 0, rejected: 0 },
                };
            });

            res.json({ data, counts, meta: pageMeta(total, query.page, query.limit) });
        } catch (error) {
            next(error);
        }
    },
);

adminRoutes.get(
    '/admin/businesses/notifications',
    authenticate,
    requirePlatformAdmin,
    rateLimiter('public'),
    async (req, res, next) => {
        try {
            const notifications = await withTenant(contextFor(req), async (client) => {
                const { rows: countRows } = await client.query<{ unread_count: number }>(
                    `SELECT count(*)::int AS unread_count
                       FROM businesses
                      WHERE status = 'pending'
                        AND deleted_at IS NULL
                        AND seen_by_admin = FALSE`,
                );
                const { rows } = await client.query(
                    `SELECT business_id, business_name, status, created_at,
                            (status = 'pending' AND NOT seen_by_admin) AS is_new
                       FROM businesses
                      WHERE deleted_at IS NULL
                      ORDER BY created_at DESC, business_id DESC
                      LIMIT 10`,
                );
                return { unreadCount: countRows[0]?.unread_count ?? 0, recent: rows };
            });
            res.json({ data: notifications });
        } catch (error) {
            next(error);
        }
    },
);

adminRoutes.post(
    '/admin/businesses/notifications/mark-seen',
    authenticate,
    requirePlatformAdmin,
    rateLimiter('write'),
    async (req, res, next) => {
        try {
            await withTenant(contextFor(req), async (client) => {
                await client.query(
                    `UPDATE businesses
                        SET seen_by_admin = TRUE
                      WHERE status = 'pending'
                        AND deleted_at IS NULL
                        AND seen_by_admin = FALSE`,
                );
            });
            res.json({ data: { success: true } });
        } catch (error) {
            next(error);
        }
    },
);

/**
 * Approve or reject one business.
 *
 * Verification and reviewer fields are written together, preserving
 * `businesses_verified_flag_consistent` while recording every decision:
 *
 *   approve -> status 'active', verification_status 'verified', is_verified true,
 *              verified_at now(), verified_by/reviewed_by and reviewed_at
 *   reject  -> status 'rejected', verification_status 'rejected', is_verified
 *              false, verified_at null, reviewer and optional reason stored
 *
 * A rejected business keeps `verified_at` null and `is_verified` false, which is
 * what the CHECK requires for anything that is not `verified`.
 */
const reviewBusiness: RequestHandler = async (req, res, next) => {
    try {
        const adminId = req.user!.id;
        const businessId = z.coerce.number().int().positive().parse(req.params['businessId']);
        const isStatusApi = req.path.endsWith('/status');
        let nextStatus: 'active' | 'rejected';
        let reason: string;
        if (isStatusApi) {
            const decision = statusDecisionSchema.parse(req.body);
            nextStatus = decision.status;
            reason = (decision.reason ?? '').trim();
        } else {
            const decision = decisionSchema.parse(req.body);
            nextStatus = decision.decision === 'approve' ? 'active' : 'rejected';
            reason = (decision.reason ?? '').trim();
        }

        const business = await withTenant(contextFor(req), async (client) => {
            const { rows: allowed } = await client.query<{ allowed: boolean }>(
                `SELECT (app_has_business_permission($1, 'business.verify') OR app_is_platform_admin()) AS allowed`,
                [businessId],
            );
            if (allowed[0]?.allowed !== true) throw forbidden('Missing permission: business.verify');

            const { rows } = await client.query<AdminBusinessRow>(
                `UPDATE businesses
                    SET status = $2::business_status,
                        is_verified = ($2 = 'active'),
                        verification_status = CASE
                            WHEN $2 = 'active' THEN 'verified'::verification_status
                            ELSE 'rejected'::verification_status
                        END,
                        verified_at = CASE WHEN $2 = 'active' THEN now() ELSE NULL END,
                        verified_by = $3,
                        rejection_reason = CASE WHEN $2 = 'rejected' THEN NULLIF($4, '') ELSE NULL END,
                        reviewed_by = $3,
                        reviewed_at = now()
                  WHERE business_id = $1
                    AND status = 'pending'
                    AND deleted_at IS NULL
                  RETURNING business_id, business_name, business_slug, status,
                            verification_status, is_verified, verified_at, rejection_reason,
                            reviewed_by, reviewed_at,
                            COALESCE(
                                (SELECT u.email FROM users u WHERE u.user_id = businesses.created_by),
                                businesses.email::text
                            ) AS owner_email`,
                [businessId, nextStatus, adminId, reason],
            );
            const updated = rows[0];
            if (updated) return updated;

            const { rows: current } = await client.query<{ status: string }>(
                'SELECT status FROM businesses WHERE business_id = $1 AND deleted_at IS NULL',
                [businessId],
            );
            if (!current[0]) throw notFound('Business not found');
            throw conflict('This business has already been reviewed', {
                field: 'status',
                current_status: current[0].status,
            });
        });

        let email: { sent: boolean; reason?: string };
        try {
            email = await sendBusinessDecisionEmail({
                businessName: business.business_name,
                recipient: business.owner_email ?? null,
                status: nextStatus,
                reason,
            });
        } catch (error) {
            console.error(`[admin] decision email failed for business ${businessId}:`, error);
            email = { sent: false, reason: 'SMTP delivery failed' };
        }
        if (!email.sent) {
            console.warn(`[admin] decision saved; email not sent for business ${businessId}: ${email.reason}`);
        }
        res.json({ data: business, email });
    } catch (error) {
        if (error instanceof z.ZodError) {
            const issue = error.issues[0];
            if (issue) {
                next(badRequest(issue.message, { field: issue.path.join('.') || 'body' }));
                return;
            }
        }
        next(error);
    }
};

adminRoutes.patch(
    '/admin/businesses/:businessId/status',
    authenticate,
    requirePlatformAdmin,
    rateLimiter('write'),
    reviewBusiness,
);

adminRoutes.patch(
    '/admin/businesses/:businessId/verification',
    authenticate,
    requirePlatformAdmin,
    rateLimiter('write'),
    reviewBusiness,
);
