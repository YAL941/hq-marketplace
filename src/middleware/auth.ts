import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized } from '../db/errors.js';
import { appPool } from '../db/pool.js';
import { withTenant } from '../db/tenant.js';
import type { TenantContext } from '../db/tenant.js';

export interface AuthenticatedUser {
    id: number;
    /** Null for an account that registered with a phone number only. */
    email: string | null;
    isPlatformAdmin: boolean;
    token_version: number;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
            /** The business this request acts on, resolved by the auth layer. */
            businessId?: number;
        }
    }
}

interface TokenPayload {
    sub: string;
    /** Null for a phone-only account; the token still identifies the user by sub. */
    email: string | null;
    pa: boolean;
    /** Binds the JWT to the user's token_version at issuance, enabling revocation. */
    token_version: number;
}

export function signAccessToken(user: AuthenticatedUser): string {
    const payload: TokenPayload = {
        sub: String(user.id),
        email: user.email,
        pa: user.isPlatformAdmin,
        token_version: user.token_version,
    };
    return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

interface CurrentSession {
    tokenVersionMatches: boolean;
    authorized: boolean;
}

/**
 * One indexed SELECT per authenticated request verifies both session
 * revocation and account authorization. No status comes from JWT claims.
 */
async function currentSessionMatches(userId: number, tokenVersion: number): Promise<CurrentSession> {
    const { rows } = await withTenant(
        { userId, isPlatformAdmin: false, businessId: null },
        (client) =>
            client.query<{ token_version: number; status: string }>(
                'SELECT token_version, status FROM users WHERE user_id = $1',
                [userId],
            ),
    );
    const user = rows[0];
    if (!user) return { tokenVersionMatches: false, authorized: false };
    return {
        tokenVersionMatches: Number(user.token_version) === tokenVersion,
        authorized: user.status === 'active',
    };
}

/**
 * Bearer token authentication. The token only proves WHO the user is;
 * what they may touch is decided by the database (RLS + membership).
 */
async function hasPlatformAdminRole(userId: number): Promise<boolean> {
    const { rows } = await appPool.query<{ allowed: boolean }>(
        `SELECT EXISTS (
             SELECT 1
               FROM user_platform_roles upr
               JOIN roles r ON r.role_id = upr.role_id
              WHERE upr.user_id = $1
                AND r.role_key = 'platform_admin'
                AND r.scope = 'platform'
                AND r.is_active
         ) AS allowed`,
        [userId],
    );
    return rows[0]?.allowed === true;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        next(unauthorized());
        return;
    }

    let decoded: TokenPayload;
    try {
        decoded = jwt.verify(header.slice(7), config.JWT_SECRET) as TokenPayload;
    } catch {
        next(unauthorized('Invalid or expired token'));
        return;
    }

    try {
        const id = Number(decoded.sub);
        if (!Number.isSafeInteger(id) || id <= 0) {
            next(unauthorized('Session revoked'));
            return;
        }
        const session = await currentSessionMatches(id, decoded.token_version ?? 0);
        if (!session.tokenVersionMatches || !session.authorized) {
            next(unauthorized('Session revoked'));
            return;
        }
        req.user = {
            id,
            email: decoded.email,
            isPlatformAdmin: decoded.pa === true && await hasPlatformAdminRole(id),
            token_version: decoded.token_version ?? 0,
        };
        next();
    } catch (error) {
        next(error);
    }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        next();
        return;
    }

    let decoded: TokenPayload;
    try {
        decoded = jwt.verify(header.slice(7), config.JWT_SECRET) as TokenPayload;
    } catch {
        // an invalid token is treated as an anonymous visitor
        next();
        return;
    }

    try {
        const id = Number(decoded.sub);
        if (!Number.isSafeInteger(id) || id <= 0) {
            next();
            return;
        }
        const session = await currentSessionMatches(id, decoded.token_version ?? 0);
        if (session.tokenVersionMatches && session.authorized) {
            req.user = {
                id,
                email: decoded.email,
                isPlatformAdmin: decoded.pa === true && await hasPlatformAdminRole(id),
                token_version: decoded.token_version ?? 0,
            };
        }
        // token_version mismatch: treat as anonymous visitor
        next();
    } catch (error) {
        next(error);
    }
}

/** Builds the tenant context for the current request. */
export function contextFor(req: Request, businessId?: number): TenantContext {
    if (!req.user) {
        return { userId: null, isPlatformAdmin: false, businessId: businessId ?? null };
    }
    return {
        userId: req.user.id,
        isPlatformAdmin: req.user.isPlatformAdmin,
        businessId: businessId ?? null,
    };
}
