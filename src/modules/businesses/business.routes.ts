import { Router } from 'express';
import { z } from 'zod';
import { forbidden, notFound, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';

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

const updateSchema = z
    .object({
        businessName: z.string().min(2).max(200).optional(),
        businessDescription: z.string().max(5000).nullish(),
        businessCategoryId: z.number().int().positive().nullish(),
        phone: z.string().max(20).nullish(),
        email: z.string().email().nullish(),
        website: z.string().url().max(300).nullish(),
        address: z.string().max(500).nullish(),
        city: z.string().max(120).nullish(),
        district: z.string().max(120).nullish(),
        latitude: z.number().min(-90).max(90).nullish(),
        longitude: z.number().min(-180).max(180).nullish(),
        logoUrl: z.string().url().max(500).nullish(),
        coverImageUrl: z.string().url().max(500).nullish(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Empty patch' });

export const businessRoutes: Router = Router();

const directoryQuerySchema = z.object({
    categoryId: z.coerce.number().int().positive().optional(),
    city: z.string().max(120).optional(),
    search: z.string().max(120).optional(),
    verifiedOnly: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === 'true')),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

/** Public directory. RLS limits the result to active, non-deleted businesses. */
businessRoutes.get('/businesses', async (req, res, next) => {
    try {
        const q = directoryQuerySchema.parse(req.query);
        const conditions: string[] = ['b.deleted_at IS NULL'];
        const params: unknown[] = [];

        if (q.categoryId !== undefined) {
            params.push(q.categoryId);
            conditions.push(`b.business_category_id = $${params.length}`);
        }
        if (q.city) {
            params.push(q.city);
            conditions.push(`b.city = $${params.length}`);
        }
        if (q.search) {
            params.push(`%${q.search.toLowerCase()}%`);
            conditions.push(`lower(b.business_name) LIKE $${params.length}`);
        }
        if (q.verifiedOnly) {
            conditions.push('b.verification_status = \'verified\'');
        }
        params.push(Math.min(q.limit ?? 50, 100));
        const limitIdx = params.length;
        params.push(Math.max(q.offset ?? 0, 0));
        const offsetIdx = params.length;

        const businesses = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query<BusinessRow & { category_name: string | null }>(
                `SELECT b.*, c.category_name
                   FROM businesses b
                   LEFT JOIN business_categories c ON c.category_id = b.business_category_id
                  WHERE ${conditions.join(' AND ')}
                  ORDER BY b.is_verified DESC, b.created_at DESC
                  LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
                params,
            );
            return rows;
        });

        res.json({ data: businesses, meta: { count: businesses.length } });
    } catch (error) {
        next(error);
    }
});

businessRoutes.get('/businesses/:businessId', async (req, res, next) => {
    try {
        const businessId = Number(req.params['businessId']);
        const business = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query<BusinessRow & { category_name: string | null }>(
                `SELECT b.*, c.category_name
                   FROM businesses b
                   LEFT JOIN business_categories c ON c.category_id = b.business_category_id
                  WHERE b.business_id = $1 AND b.deleted_at IS NULL`,
                [businessId],
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
        const patch = updateSchema.parse(req.body) as Record<string, unknown>;

        const columns: Record<string, string> = {
            businessName: 'business_name',
            businessDescription: 'business_description',
            businessCategoryId: 'business_category_id',
            phone: 'phone',
            email: 'email',
            website: 'website',
            address: 'address',
            city: 'city',
            district: 'district',
            latitude: 'latitude',
            longitude: 'longitude',
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

/** Analytics for the current business only, read from the statistics cache. */
businessRoutes.get('/business/:businessId/statistics', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const stats = await withTenant(contextFor(req, businessId), async (client) => {
            await client.query('SELECT refresh_business_statistics($1)', [businessId]);
            const { rows } = await client.query(
                'SELECT * FROM business_statistics WHERE business_id = $1',
                [businessId],
            );
            return rows[0] ?? null;
        });
        res.json({ data: stats, meta: { businessId } });
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
