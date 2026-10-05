import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized } from '../db/errors.js';
export function signAccessToken(user) {
    const payload = { sub: String(user.id), email: user.email, pa: user.isPlatformAdmin };
    return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
}
/**
 * Bearer token authentication. The token only proves WHO the user is;
 * what they may touch is decided by the database (RLS + membership).
 */
export function authenticate(req, _res, next) {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        next(unauthorized());
        return;
    }
    try {
        const decoded = jwt.verify(header.slice(7), config.JWT_SECRET);
        req.user = {
            id: Number(decoded.sub),
            email: decoded.email,
            isPlatformAdmin: decoded.pa === true,
        };
        next();
    }
    catch {
        next(unauthorized('Invalid or expired token'));
    }
}
export function optionalAuth(req, _res, next) {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        next();
        return;
    }
    try {
        const decoded = jwt.verify(header.slice(7), config.JWT_SECRET);
        req.user = { id: Number(decoded.sub), email: decoded.email, isPlatformAdmin: decoded.pa === true };
    }
    catch {
        // an invalid token is treated as an anonymous visitor
    }
    next();
}
/** Builds the tenant context for the current request. */
export function contextFor(req, businessId) {
    if (!req.user) {
        return { userId: null, isPlatformAdmin: false, businessId: businessId ?? null };
    }
    return {
        userId: req.user.id,
        isPlatformAdmin: req.user.isPlatformAdmin,
        businessId: businessId ?? null,
    };
}
//# sourceMappingURL=auth.js.map