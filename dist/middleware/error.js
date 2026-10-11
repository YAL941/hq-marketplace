import { ZodError } from 'zod';
import { AppError, forbidden, unauthorized } from '../db/errors.js';
import { hasBusinessPermission, isBusinessMember } from '../db/tenant.js';
import { contextFor } from './auth.js';
/**
 * Resolves the business the request acts on and proves, in the database,
 * that the caller actually belongs to it.
 *
 * The business id is NEVER trusted from the client: even a guessed id only
 * reaches the query layer after a membership check, and RLS rejects it
 * afterwards if the check is wrong.
 */
export async function resolveBusiness(req, _res, next) {
    try {
        const raw = req.params['businessId'] ??
            req.header('x-business-id');
        if (!raw) {
            next(new AppError(400, 'BUSINESS_CONTEXT_REQUIRED', 'Provide X-Business-Id header or /businesses/:businessId'));
            return;
        }
        const businessId = Number(raw);
        if (!Number.isInteger(businessId) || businessId <= 0) {
            next(new AppError(400, 'BUSINESS_CONTEXT_INVALID', 'Invalid business id'));
            return;
        }
        if (!req.user) {
            next(unauthorized('A business workspace requires authentication'));
            return;
        }
        const ctx = contextFor(req, businessId);
        const allowed = await isBusinessMember(ctx, businessId);
        if (!allowed) {
            // Same response as a non-existent business would be even better;
            // the membership check is the real gate.
            next(forbidden('You are not a member of this business'));
            return;
        }
        req.businessId = businessId;
        next();
    }
    catch (error) {
        next(error);
    }
}
/** Requires a business-scoped permission, checked by the database. */
export function requireBusinessPermission(permissionKey) {
    return async (req, _res, next) => {
        try {
            const businessId = req.businessId;
            if (!businessId || !req.user) {
                next(unauthorized());
                return;
            }
            const ctx = contextFor(req, businessId);
            const allowed = await hasBusinessPermission(ctx, businessId, permissionKey);
            if (!allowed) {
                next(forbidden(`Missing permission: ${permissionKey}`));
                return;
            }
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
export function errorHandler(error, _req, res, _next) {
    if (error instanceof ZodError) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues } });
        return;
    }
    if (error instanceof AppError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
        return;
    }
    const pg = error;
    if (pg?.code === '23505') {
        res.status(409).json({ error: { code: 'DUPLICATE', message: 'Value already exists', details: pg.constraint } });
        return;
    }
    if (pg?.code === '23503') {
        res.status(409).json({ error: { code: 'FK_VIOLATION', message: 'Referenced record does not exist', details: pg.constraint } });
        return;
    }
    if (pg?.code === '23514') {
        res.status(400).json({ error: { code: 'CHECK_VIOLATION', message: 'Value violates a data rule', details: pg.constraint } });
        return;
    }
    // never leak SQL to a client
    console.error('[hq] unhandled error', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
}
export function notFoundHandler(_req, res) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}
//# sourceMappingURL=error.js.map