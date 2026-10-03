import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { badRequest, conflict, unauthorized } from '../../db/errors.js';
import { ANONYMOUS, withTenant } from '../../db/tenant.js';
import { authenticate, contextFor, signAccessToken } from '../../middleware/auth.js';
import { rateLimiter } from '../../middleware/rate-limit.js';
import { isEmailLike, normalisePhone, PhoneValidationError } from './phone.js';

/**
 * Identity at signup: an email, a phone, or both.
 *
 * Exactly one of the two is required, because a caller who supplies neither has
 * no way back into the account, and one who supplies both is almost always
 * copying a form twice. `password` and `fullName` stay mandatory.
 */
const registerSchema = z.object({
    email: z.string().email().optional(),
    phone: z.string().optional(),
    password: z.string().min(8).max(128),
    fullName: z.string().min(2).max(200),
    /**
     * Where the account starts. `customer` is the default and the only safe
     * one; `business_owner` additionally creates a business, which is a bigger
     * promise than a signup form can make on its own, so it goes through the
     * same path as the dedicated business onboarding endpoint.
     */
    role: z.enum(['customer', 'business_owner']).default('customer'),
    /** Required when `role` is `business_owner`: the owner's own business. */
    businessName: z.string().min(2).max(200).optional(),
}).refine((v) => v.email !== undefined || v.phone !== undefined, {
    message: 'Provide an email address, a phone number, or both',
    path: ['email'],
});

/**
 * Login takes one field that is either an email or a phone number. Normalising
 * it here rather than in the route body means the caller can type the number
 * any way they like and still reach the right account.
 *
 * `email` is accepted as an alias for `identifier` so clients written against
 * the earlier contract keep working; new callers should send `identifier`.
 */
const loginSchema = z.object({
    identifier: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    password: z.string().min(1),
}).refine((v) => v.identifier !== undefined || v.email !== undefined, {
    message: 'Provide an identifier: an email address or a phone number',
    path: ['identifier'],
});

/** Runs a normaliser, turning its validation error into a 400. */
function asBadRequest<T>(run: () => T): T {
    try {
        return run();
    } catch (error) {
        if (error instanceof PhoneValidationError) {
            throw badRequest(error.message, { field: 'phone', reason: error.reason });
        }
        throw error;
    }
}

/**
 * Normalises an optional phone field to E.164, or leaves it absent.
 *
 * A blank box and a missing key mean the same thing here — the business simply
 * has no number on that channel yet — so both become null instead of failing.
 * Anything that is present but unusable is a 400 carrying the field name, which
 * is what lets a form with two number boxes point at the right one.
 */
function optionalPhone(value: string | null | undefined, field: 'phone' | 'whatsapp'): string | null {
    if (value === undefined || value === null || value.trim() === '') return null;
    try {
        return normalisePhone(value);
    } catch (error) {
        if (error instanceof PhoneValidationError) {
            throw badRequest(error.message, { field, reason: error.reason });
        }
        throw error;
    }
}

const authLimiter = rateLimiter('auth');
const writeLimiter = rateLimiter('write');

export const authRoutes: Router = Router();

/** Registration starts as a customer unless the caller asked to own a business. */
authRoutes.post('/auth/register', authLimiter, async (req, res, next) => {
    try {
        const input = registerSchema.parse(req.body);

        // Normalise before anything touches the database, so a bad number is a
        // 400 with a readable reason rather than a constraint violation.
        const phone = input.phone === undefined ? null : asBadRequest(() => normalisePhone(input.phone!));
        const email = input.email === undefined ? null : input.email.toLowerCase();

        if (input.role === 'business_owner' && !input.businessName) {
            next(badRequest('businessName is required when role is business_owner', { field: 'businessName' }));
            return;
        }

        const passwordHash = await bcrypt.hash(input.password, 12);

        const result = await withTenant(ANONYMOUS, async (client) => {
            // The RLS policies read these two settings back when the row being
            // created is fetched again by RETURNING.
            await client.query('SELECT set_config($1, $2, true)', ['app.registering_email', email ?? '']);
            await client.query('SELECT set_config($1, $2, true)', ['app.registering_phone', phone ?? '']);

            const { rows } = await client.query<{ user_id: string; email: string | null; full_name: string; phone: string | null }>(
                `INSERT INTO users (email, phone, password_hash, full_name, status)
                 VALUES ($1, $2, $3, $4, 'active')
                 RETURNING user_id, email, phone, full_name`,
                [email, phone, passwordHash, input.fullName],
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

            // An owner is also a member of the business they just created. The
            // 004 onboarding policy checks `app_user_id()`, and this
            // transaction is still running as an anonymous visitor because the
            // account did not exist when it started. The context is therefore
            // re-pointed at the new user, in the same transaction, before the
            // business row is written.
            //
            // This is safe to do after the user insert: the registration-read
            // policy is keyed on app.registering_email / app.registering_phone
            // rather than on app.user_id, so the row is still readable.
            const business = input.role === 'business_owner'
                ? await (async () => {
                    await client.query('SELECT set_config($1, $2, true)', [
                        'app.user_id',
                        String(user.user_id),
                    ]);
                    return createBusinessWithOwner(client, {
                        userId: Number(user.user_id),
                        businessName: input.businessName!,
                        contactEmail: user.email,
                        contactPhone: user.phone,
                    });
                })()
                : null;

            return { user, business };
        });

        const token = signAccessToken({
            id: Number(result.user.user_id),
            email: result.user.email,
            isPlatformAdmin: false,
        });
        res.status(201).json({ data: { user: result.user, business: result.business, token } });
    } catch (error) {
        // 23505 is a unique violation: the email or the phone is taken.
        if ((error as { code?: string }).code === '23505') {
            const constraint = (error as { constraint?: string }).constraint ?? '';
            const field = constraint.includes('phone') ? 'phone' : 'email';
            next(conflict(
                field === 'phone'
                    ? 'This phone number is already registered'
                    : 'An account with this email address already exists',
                { field },
            ));
            return;
        }
        next(error);
    }
});

authRoutes.post('/auth/login', authLimiter, async (req, res, next) => {
    try {
        const input = loginSchema.parse(req.body);
        // A caller may type the number in any form, so it is normalised to the
        // same E.164 value the account was stored with. A malformed number is
        // reported as a bad request rather than as a wrong password: telling
        // someone their number is malformed is what they need, and it reveals
        // nothing, because it happens before any account is looked up.
        const rawIdentifier = input.identifier ?? input.email!;
        const identifier = isEmailLike(rawIdentifier)
            ? rawIdentifier.toLowerCase()
            : asBadRequest(() => normalisePhone(rawIdentifier));

        const { rows } = await withTenant(contextFor(req), async (client) =>
            client.query<{
                user_id: string;
                email: string | null;
                password_hash: string;
                status: string;
                full_name: string;
                is_platform_admin: boolean;
            }>('SELECT * FROM app_user_for_login($1)', [identifier]),
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

/**
 * Creates a business and makes its owner the first member.
 *
 * Shared by `POST /businesses/register` and by the `business_owner` branch of
 * `POST /auth/register`, so onboarding has exactly one implementation. Both
 * callers already run inside a transaction whose tenant context points at the
 * owner, which is what the 004 onboarding policy checks.
 */
async function createBusinessWithOwner(
    client: PoolClient,
    input: {
        userId: number;
        businessName: string;
        businessCategoryId?: number | null;
        description?: string | null;
        address?: string | null;
        city?: string | null;
        district?: string | null;
        contactPhone?: string | null;
        contactEmail?: string | null;
        whatsappNumber?: string | null;
    },
): Promise<{ business_id: string; business_name: string; business_slug: string; status: string }> {
    const slugBase = input.businessName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    const slug = `${slugBase || 'business'}-${Date.now().toString(36)}`;

    const { rows } = await client.query<{ business_id: string; business_name: string; business_slug: string; status: string }>(
        `INSERT INTO businesses
            (business_name, business_slug, business_description, business_category_id, phone, email,
             address, city, district, whatsapp_number, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING business_id, business_name, business_slug, status`,
        [
            input.businessName,
            slug,
            input.description ?? null,
            input.businessCategoryId ?? null,
            input.contactPhone ?? null,
            input.contactEmail ?? null,
            input.address ?? null,
            input.city ?? null,
            input.district ?? null,
            input.whatsappNumber ?? null,
            input.userId,
        ],
    );
    const business = rows[0]!;

    const { rows: roleRows } = await client.query<{ role_id: string }>(
        `SELECT role_id FROM roles WHERE role_key = 'business_owner' AND scope = 'business'`,
    );
    await client.query(
        `INSERT INTO business_users (business_id, user_id, role_id, status, joined_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [business.business_id, input.userId, roleRows[0]!.role_id],
    );

    return business;
}

/**
 * Business onboarding: creates the business and its first (owning) member.
 *
 * The `write` limiter is on this route for the same reason it is on order and
 * review creation: it is authenticated, so it cannot be brute-forced, but it
 * inserts two rows and mints a membership, and an unbounded loop of it from one
 * account is a way to fill the businesses table.
 *
 * Phones are reduced to E.164 here rather than in the schema, because the
 * database CHECK constraints expect that shape (`+?[0-9]{7,15}`) and a number
 * stored any other way can never be dialled back. An unusable number is rejected
 * with `details.field` so the form can put the message next to the box that
 * caused it instead of showing one banner for the whole submission.
 */
authRoutes.post('/businesses/register', writeLimiter, authenticate, async (req, res, next) => {
    try {
        const userId = req.user!.id;
        const input = z
            .object({
                businessName: z.string().min(2).max(200),
                businessCategoryId: z.number().int().positive().nullish(),
                description: z.string().max(5000).nullish(),
                phone: z.string().max(20).nullish(),
                whatsapp: z.string().max(20).nullish(),
                email: z.string().email().nullish(),
                address: z.string().max(500).nullish(),
                city: z.string().max(120).nullish(),
                district: z.string().max(120).nullish(),
            })
            .parse(req.body);

        const contactPhone = optionalPhone(input.phone, 'phone');
        const whatsappNumber = optionalPhone(input.whatsapp, 'whatsapp');

        const result = await withTenant(contextFor(req), (client) =>
            createBusinessWithOwner(client, {
                userId,
                businessName: input.businessName,
                businessCategoryId: input.businessCategoryId,
                description: input.description,
                address: input.address,
                city: input.city,
                district: input.district,
                contactPhone,
                whatsappNumber,
                // An account registered by phone has no email, so the owner's
                // phone is the only contact detail available here.
                contactEmail: input.email ?? req.user!.email,
            }),
        );

        // `status` is returned because it is the one field that tells the caller
        // what happens next: a business created here is `pending`, and nothing
        // in this response may suggest otherwise.
        res.status(201).json({ data: result });
    } catch (error) {
        if ((error as { code?: string }).code === '23505') {
            next(conflict('A business with this slug already exists'));
            return;
        }
        next(error);
    }
});
