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
 * The write needs no migration. `businesses_admin_write` already allows a
 * platform admin to UPDATE, the columns exist (`verification_status`,
 * `verified_at`, `verified_by`, `rejection_reason`), and the
 * `businesses_verified_flag_consistent` CHECK is what forces the four fields to
 * move together — which is why the UPDATE below always sets all of them, even
 * the ones that do not change.
 */
import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageMeta } from '../businesses/public-query.js';
export const adminRoutes = Router();
/**
 * 403 for anyone who is not a platform admin.
 *
 * `isPlatformAdmin` is resolved once at login from `user_platform_roles` and
 * travels in the verified token, so this is a claim check rather than a lookup —
 * the database check that actually matters happens in the handler.
 */
const requirePlatformAdmin = (req, _res, next) => {
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
const ADMIN_STATUSES = ['pending', 'active', 'rejected'];
const listQuerySchema = z.object({
    status: z.enum(ADMIN_STATUSES).default('pending'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
/**
 * A rejection without a reason is not a decision, it is a shrug: the owner sees
 * the reason on their dashboard and has nothing to act on. Five characters is
 * the floor that keeps "no" from qualifying.
 */
const MIN_REASON_LENGTH = 5;
const decisionSchema = z
    .object({
    decision: z.enum(['approve', 'reject']),
    /** Required when rejecting, ignored when approving. */
    reason: z.string().max(500).nullish(),
    /**
     * Re-deciding a business that already carries this decision is a no-op,
     * and silently accepting it would make a queue that never drains look
     * like it is being worked. `force: true` is how an admin says "yes, I
     * meant to do that again".
     */
    force: z.boolean().default(false),
})
    .refine((v) => v.decision !== 'reject' || (v.reason ?? '').trim().length >= MIN_REASON_LENGTH, {
    message: `A rejection needs a reason of at least ${MIN_REASON_LENGTH} characters`,
    path: ['reason'],
});
/** True when the business already sits in the state this decision asks for. */
function isNoop(current, decision) {
    if (decision === 'approve') {
        return current.verification_status === 'verified' && current.is_verified && current.status === 'active';
    }
    return current.verification_status === 'rejected';
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
adminRoutes.get('/admin/businesses', authenticate, requirePlatformAdmin, rateLimiter('public'), async (req, res, next) => {
    try {
        const query = listQuerySchema.parse(req.query);
        const offset = (query.page - 1) * query.limit;
        const { data, total } = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query(`SELECT b.business_id,
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
                            b.created_at,
                            b.created_by AS owner_user_id,
                            u.full_name AS owner_full_name,
                            u.email AS owner_email
                       FROM businesses b
                       LEFT JOIN business_categories c ON c.category_id = b.business_category_id
                       LEFT JOIN users u ON u.user_id = b.created_by
                      WHERE b.status = $1
                        AND b.deleted_at IS NULL
                      ORDER BY b.created_at ASC, b.business_id ASC
                      LIMIT $2 OFFSET $3`, [query.status, query.limit, offset]);
            const { rows: countRows } = await client.query(`SELECT count(*)::int AS total
                       FROM businesses b
                      WHERE b.status = $1
                        AND b.deleted_at IS NULL`, [query.status]);
            return { data: rows, total: countRows[0]?.total ?? 0 };
        });
        res.json({ data, meta: pageMeta(total, query.page, query.limit) });
    }
    catch (error) {
        next(error);
    }
});
/**
 * Approve or reject one business.
 *
 * All four verification fields are written on every decision, which is what
 * satisfies `businesses_verified_flag_consistent` without the caller having to
 * know that constraint exists:
 *
 *   approve -> status 'active', verification_status 'verified', is_verified true,
 *              verified_at now(), verified_by the admin, rejection_reason null
 *   reject  -> status 'rejected', verification_status 'rejected', is_verified
 *              false, verified_at null, verified_by the admin, reason stored
 *
 * A rejected business keeps `verified_at` null and `is_verified` false, which is
 * what the CHECK requires for anything that is not `verified`.
 */
adminRoutes.patch('/admin/businesses/:businessId/verification', authenticate, requirePlatformAdmin, rateLimiter('write'), async (req, res, next) => {
    try {
        const adminId = req.user.id;
        const businessId = z.coerce.number().int().positive().parse(req.params['businessId']);
        const body = decisionSchema.parse(req.body);
        const business = await withTenant(contextFor(req), async (client) => {
            const { rows: allowed } = await client.query(`SELECT (app_has_business_permission($1, 'business.verify') OR app_is_platform_admin()) AS allowed`, [businessId]);
            if (allowed[0]?.allowed !== true) {
                throw forbidden('Missing permission: business.verify');
            }
            const { rows: currentRows } = await client.query(`SELECT status, verification_status, is_verified
                       FROM businesses
                      WHERE business_id = $1
                      FOR UPDATE`, [businessId]);
            const current = currentRows[0];
            if (!current)
                throw notFound('Business not found');
            if (isNoop(current, body.decision) && !body.force) {
                throw conflict(`This business is already ${body.decision === 'approve' ? 'verified' : 'rejected'}`, {
                    field: 'decision',
                    reason: body.decision,
                    current_status: current.status,
                    current_verification_status: current.verification_status,
                });
            }
            const { rows } = body.decision === 'approve'
                ? await client.query(`UPDATE businesses
                            SET status = 'active',
                                is_verified = TRUE,
                                verification_status = 'verified',
                                verified_at = now(),
                                verified_by = $2,
                                rejection_reason = NULL
                          WHERE business_id = $1
                          RETURNING business_id, business_name, business_slug, status,
                                    verification_status, is_verified, verified_at, rejection_reason`, [businessId, adminId])
                : await client.query(`UPDATE businesses
                            SET status = 'rejected',
                                is_verified = FALSE,
                                verification_status = 'rejected',
                                verified_at = NULL,
                                verified_by = $2,
                                rejection_reason = $3
                          WHERE business_id = $1
                          RETURNING business_id, business_name, business_slug, status,
                                    verification_status, is_verified, verified_at, rejection_reason`, [businessId, adminId, (body.reason ?? '').trim()]);
            return rows[0];
        });
        res.json({ data: business });
    }
    catch (error) {
        // A reason that failed the refine above must say which field it was,
        // or a form cannot point at the textarea that needs filling in.
        if (error instanceof z.ZodError) {
            const issue = error.issues[0];
            if (issue) {
                next(badRequest(issue.message, { field: issue.path.join('.') || 'body' }));
                return;
            }
        }
        next(error);
    }
});
//# sourceMappingURL=admin.routes.js.map