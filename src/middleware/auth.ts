import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized } from '../db/errors.js';
import { appPool } from '../db/pool.js';
import type { TenantContext } from '../db/tenant.js';

export interface AuthenticatedUser {
    id: number;
    /** Null for an account that registered with a phone number only. */
    email: string | null;
    isPlatformAdmin: boolean;
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
}

export function signAccessToken(user: AuthenticatedUser): string {
    const payload: TokenPayload = { sub: String(user.id), email: user.email, pa: user.isPlatformAdmin };
    return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
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
        req.user = {
            id,
            email: decoded.email,
            isPlatformAdmin: decoded.pa === true && await hasPlatformAdminRole(id),
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
        req.user = {
            id,
            email: decoded.email,
            isPlatformAdmin: decoded.pa === true && await hasPlatformAdminRole(id),
        };
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
