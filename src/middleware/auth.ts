import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized } from '../db/errors.js';
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
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        next(unauthorized());
        return;
    }
    try {
        const decoded = jwt.verify(header.slice(7), config.JWT_SECRET) as TokenPayload;
        req.user = {
            id: Number(decoded.sub),
            email: decoded.email,
            isPlatformAdmin: decoded.pa === true,
        };
        next();
    } catch {
        next(unauthorized('Invalid or expired token'));
    }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        next();
        return;
    }
    try {
        const decoded = jwt.verify(header.slice(7), config.JWT_SECRET) as TokenPayload;
        req.user = { id: Number(decoded.sub), email: decoded.email, isPlatformAdmin: decoded.pa === true };
    } catch {
        // an invalid token is treated as an anonymous visitor
    }
    next();
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
