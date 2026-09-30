import { Router } from 'express';
import { z } from 'zod';
import { forbidden, notFound, unauthorized } from '../../db/errors.js';
import { withTenant } from '../../db/tenant.js';
import { authenticate, contextFor } from '../../middleware/auth.js';
import { resolveBusiness } from '../../middleware/error.js';

export interface LocationRow {
    location_id: string;
    business_id: string;
    location_name: string;
    address: string | null;
    city: string | null;
    district: string | null;
    latitude: number | null;
    longitude: number | null;
    phone: string | null;
    is_primary: boolean;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

const createSchema = z.object({
    locationName: z.string().min(2).max(150),
    address: z.string().max(500).nullish(),
    city: z.string().max(120).nullish(),
    district: z.string().max(120).nullish(),
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    phone: z.string().max(20).nullish(),
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional(),
    workingHours: z.record(z.array(z.string())).nullish(),
});

const updateSchema = createSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'Empty patch' });

export const locationRoutes: Router = Router();

async function assertPermission(client: import('pg').PoolClient, businessId: number, permission: string): Promise<void> {
    const { rows } = await client.query<{ allowed: boolean }>(
        'SELECT (app_has_business_permission($1, $2) OR app_is_platform_admin()) AS allowed',
        [businessId, permission],
    );
    if (rows[0]?.allowed !== true) throw forbidden(`Missing permission: ${permission}`);
}

locationRoutes.get('/business/:businessId/locations', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const locations = await withTenant(contextFor(req, businessId), async (client) => {
            const { rows } = await client.query<LocationRow>(
                `SELECT * FROM business_locations WHERE business_id = $1 ORDER BY is_primary DESC, created_at`,
                [businessId],
            );
            return rows;
        });
        res.json({ data: locations, meta: { count: locations.length, businessId } });
    } catch (error) {
        next(error);
    }
});

locationRoutes.post('/business/:businessId/locations', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const input = createSchema.parse(req.body);
        const location = await withTenant(contextFor(req, businessId), async (client) => {
            await assertPermission(client, businessId, 'locations.manage');
            if (input.isPrimary) {
                await client.query('UPDATE business_locations SET is_primary = FALSE WHERE business_id = $1', [businessId]);
            }
            const { rows } = await client.query<LocationRow>(
                `INSERT INTO business_locations
                    (business_id, location_name, address, city, district, latitude, longitude, phone,
                     is_primary, is_active, working_hours)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, FALSE), COALESCE($10, TRUE), $11)
                 RETURNING *`,
                [
                    businessId,
                    input.locationName,
                    input.address ?? null,
                    input.city ?? null,
                    input.district ?? null,
                    input.latitude ?? null,
                    input.longitude ?? null,
                    input.phone ?? null,
                    input.isPrimary ?? null,
                    input.isActive ?? null,
                    input.workingHours ? JSON.stringify(input.workingHours) : null,
                ],
            );
            return rows[0]!;
        });
        res.status(201).json({ data: location });
    } catch (error) {
        next(error);
    }
});

locationRoutes.patch('/business/:businessId/locations/:locationId', authenticate, resolveBusiness, async (req, res, next) => {
    try {
        if (!req.user) throw unauthorized();
        const businessId = req.businessId!;
        const locationId = Number(req.params['locationId']);
        const patch = updateSchema.parse(req.body) as Record<string, unknown>;
        const location = await withTenant(contextFor(req, businessId), async (client) => {
            await assertPermission(client, businessId, 'locations.manage');
            if (patch['isPrimary'] === true) {
                await client.query('UPDATE business_locations SET is_primary = FALSE WHERE business_id = $1', [businessId]);
            }
            const columns: Record<string, string> = {
                locationName: 'location_name',
                address: 'address',
                city: 'city',
                district: 'district',
                latitude: 'latitude',
                longitude: 'longitude',
                phone: 'phone',
                isPrimary: 'is_primary',
                isActive: 'is_active',
                workingHours: 'working_hours',
            };
            const sets: string[] = [];
            const params: unknown[] = [locationId, businessId];
            for (const [key, column] of Object.entries(columns)) {
                const value = patch[key];
                if (value !== undefined) {
                    params.push(key === 'workingHours' && value !== null ? JSON.stringify(value) : value);
                    sets.push(`${column} = $${params.length}`);
                }
            }
            const { rows } = await client.query<LocationRow>(
                `UPDATE business_locations SET ${sets.join(', ')}
                  WHERE location_id = $1 AND business_id = $2
                  RETURNING *`,
                params,
            );
            if (!rows[0]) throw notFound('Location not found in this business');
            return rows[0];
        });
        res.json({ data: location });
    } catch (error) {
        next(error);
    }
});

/** Public: active branches of active businesses. */
locationRoutes.get('/businesses/:businessId/locations', async (req, res, next) => {
    try {
        const businessId = Number(req.params['businessId']);
        const locations = await withTenant(contextFor(req), async (client) => {
            const { rows } = await client.query<LocationRow>(
                `SELECT * FROM business_locations
                  WHERE business_id = $1 AND is_active = TRUE
                  ORDER BY is_primary DESC, created_at`,
                [businessId],
            );
            return rows;
        });
        res.json({ data: locations, meta: { count: locations.length, businessId } });
    } catch (error) {
        next(error);
    }
});
