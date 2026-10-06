/**
 * Query parsing and distance math for the nearby-business search.
 *
 * Split from the route for the same reason public-query.ts exists: every
 * public parameter is validated in one place with its caps, so a handler
 * cannot forget a cap, and the SQL fragments both queries share live next
 * to the limits they depend on.
 */

import { z } from 'zod';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from './public-query.js';

export interface NearbyBusinessRow {
    business_id: number;
    business_slug: string;
    business_name: string;
    city: string | null;
    distance_km: number;
}

/** Mean Earth radius in kilometres (IUGG mean radius). */
const EARTH_RADIUS_KM = 6371.0088;

/** Kilometres per degree of latitude, constant to well under 1% everywhere. */
const KM_PER_DEGREE_LAT = 110.574;

/**
 * Maximum radius a caller may ask for. A city directory is not a
 * country-wide search; above ~100 km the nearest ordering stops
 * meaning anything and the bounding box stops prefiltering.
 */
export const MAX_RADIUS_KM = 100;

export const nearbyQuerySchema = z
    .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radiusKm: z.coerce.number().min(0.1).max(MAX_RADIUS_KM).default(5),
        city: z.string().trim().min(1).max(120).optional(),
        categoryId: z.coerce.number().int().positive().optional(),
        q: z.string().trim().min(1).max(80).optional(),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    })
    .strict();

export type NearbyQueryInput = z.infer<typeof nearbyQuerySchema>;
