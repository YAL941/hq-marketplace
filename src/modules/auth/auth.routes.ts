import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { conflict, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor, signAccessToken } from '../../middleware/auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    fullName: z.string().min(2).max(200),
    phone: z
        .string()
        .regex(/^\+?[0-9]{7,15}$/)
        .optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

const authLimiter = rateLimiter('auth');

export const authRoutes: Router = Router();

/** Registration always starts as a customer; business roles come later. */
authRoutes.post('/auth/register', authLimiter, async (req, res, next) => {
    try {
        const input = registerSchema.parse(req.body);
        const passwordHash = await bcrypt.hash(input.password, 12);

        const result = await withTenant(contextFor(req), async (client) => {
            // lets the row created below be read back in this transaction
            await client.query('SELECT set_config($1, $2, true)', ['app.registering_email', input.email]);
            const { rows } = await client.query<{ user_id: string; email: string; full_name: string }>(
                `INSERT INTO users (email, password_hash, full_name, phone, status)
                 VALUES ($1, $2, $3, $4, 'active')
                 RETURNING user_id, email, full_name`,
                [input.email, passwordHash, input.fullName, input.phone ?? null],
            );
            const user = rows[0]!;
            const { rows: roleRows } = await client.query<{ role_id: string }>(
                `SELECT role_id FROM roles WHERE role_key = 'customer' AND scope = 'platform'`,
            );
            if (roleRows[0]) {
                await client.query('INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2)', [
                    user.user_id,
                    roleRows[0].role_id,
                ]);
            }
            return user;
        });

        const token = signAccessToken({
            id: Number(result.user_id),
            email: result.email,
            isPlatformAdmin: false,
        });
        res.status(201).json({ data: { user: result, token } });
    } catch (error) {
        next(error);
    }
});

authRoutes.post('/auth/login', authLimiter, async (req, res, next) => {
    try {
        const input = loginSchema.parse(req.body);
        const { rows } = await withTenant(contextFor(req), async (client) =>
            client.query<{
                user_id: string;
                email: string;
                password_hash: string;
                status: string;
                full_name: string;
                is_platform_admin: boolean;
            }>('SELECT * FROM app_user_for_login($1)', [input.email]),
        );

        const user = rows[0];
        const passwordOk = user ? await bcrypt.compare(input.password, user.password_hash) : false;
        if (!user || !passwordOk) {
            next(unauthorized('Invalid email or password'));
            return;
        }
        if (user.status !== 'active') {
            next(unauthorized('Account is not active'));
            return;
        }

        const token = signAccessToken({
            id: Number(user.user_id),
            email: user.email,
            isPlatformAdmin: user.is_platform_admin,
        });
        res.json({ data: { user: { user_id: user.user_id, email: user.email, full_name: user.full_name }, token } });
    } catch (error) {
        next(error);
    }
});

/** The caller's profile plus every business they belong to. */
authRoutes.get('/auth/me', authenticate, async (req, res, next) => {
    try {
        const userId = req.user!.id;
        const payload = await withTenant(contextFor(req), async (client) => {
            const { rows: userRows } = await client.query<{ user_id: string; email: string; full_name: string }>(
                'SELECT user_id, email, full_name FROM users WHERE user_id = $1',
                [userId],
            );
            const { rows: roles } = await client.query(
                `SELECT r.role_key, r.role_name, r.scope
                   FROM user_platform_roles upr
                   JOIN roles r ON r.role_id = upr.role_id
                  WHERE upr.user_id = $1`,
                [userId],
            );
            const { rows: businesses } = await client.query(
                `SELECT bu.business_id, b.business_name, b.business_slug, b.status,
                        r.role_key, r.role_name
                   FROM business_users bu
                   JOIN businesses b ON b.business_id = bu.business_id
                   JOIN roles r ON r.role_id = bu.role_id
                  WHERE bu.user_id = $1 AND bu.status = 'active'
                  ORDER BY b.business_name`,
                [userId],
            );
            return { user: userRows[0] ?? null, platformRoles: roles, businesses };
        });
        res.json({ data: payload });
    } catch (error) {
        next(error);
    }
});

/** Business onboarding: creates the business and its first (owning) member. */
authRoutes.post('/businesses/register', authenticate, async (req, res, next) => {
    try {
        const userId = req.user!.id;
        const input = z
            .object({
                businessName: z.string().min(2).max(200),
                businessCategoryId: z.number().int().positive().nullish(),
                description: z.string().max(5000).nullish(),
                phone: z.string().max(20).nullish(),
                email: z.string().email().nullish(),
                address: z.string().max(500).nullish(),
                city: z.string().max(120).nullish(),
                district: z.string().max(120).nullish(),
            })
            .parse(req.body);

        const slugBase = input.businessName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
        const slug = `${slugBase || 'business'}-${Date.now().toString(36)}`;

        const result = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query<{ business_id: string; business_name: string; business_slug: string; status: string }>(
                `INSERT INTO businesses
                    (business_name, business_slug, business_description, business_category_id, phone, email,
                     address, city, district, created_by)
                 VALUES ($1, $2, $3, $4, COALESCE($5, $6), $6, $7, $8, $9, $10)
                 RETURNING business_id, business_name, business_slug, status`,
                [
                    input.businessName,
                    slug,
                    input.description ?? null,
                    input.businessCategoryId ?? null,
                    input.phone ?? null,
                    input.email ?? req.user!.email,
                    input.address ?? null,
                    input.city ?? null,
                    input.district ?? null,
                    userId,
                ],
            );
            const business = rows[0]!;

            const { rows: roleRows } = await client.query<{ role_id: string }>(
                `SELECT role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business'`,
            );
            await client.query(
                `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
                 VALUES ($1, $2, $3, 'active', now())`,
                [business.business_id, userId, roleRows[0]!.role_id],
            );

            return business;
        });

        res.status(201).json({ data: result });
    } catch (error) {
        if ((error as { code?: string }).code === '23505') {
            next(conflict('A business with this slug already exists'));
            return;
        }
        next(error);
    }
});
