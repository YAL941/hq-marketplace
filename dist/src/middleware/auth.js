import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized } from '../db/errors.js';
import { appPool } from '../db/pool.js';
export function signAccessToken(user) {
    const payload = { sub: String(user.id), email: user.email, pa: user.isPlatformAdmin };
    return jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
}
/**
 * Bearer token authentication. The token only proves WHO the user is;
 * what they may touch is decided by the database (RLS + membership).
 */
async function hasPlatformAdminRole(userId) {
    const { rows } = await appPool.query(`SELECT EXISTS (
             SELECT 1
               FROM user_platform_roles upr
               JOIN roles r ON r.role_id = upr.role_id
              WHERE upr.user_id = $1
                AND r.role_key = 'platform_admin'
                AND r.scope = 'platform'
                AND r.is_active
         ) AS allowed`, [userId]);
    return rows[0]?.allowed === true;
}
export async function authenticate(req, _res, next) {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        next(unauthorized());
        return;
    }
    let decoded;
    try {
        decoded = jwt.verify(header.slice(7), config.JWT_SECRET);
    }
    catch {
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
    }
    catch (error) {
        next(error);
    }
}
export async function optionalAuth(req, _res, next) {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
        next();
        return;
    }
    let decoded;
    try {
        decoded = jwt.verify(header.slice(7), config.JWT_SECRET);
    }
    catch {
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
    }
    catch (error) {
        next(error);
    }
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