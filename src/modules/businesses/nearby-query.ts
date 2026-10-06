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

/** Max radius. Above ~100 km the nearest ordering stops being useful. */
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

/**
 * Law-of-cosines distance in km as an SQL expression. One string shared
 * by count and page queries so distance logic cannot drift between them.
 * Coordinates embedded have passed zod number validation.
 */
export function distanceSql(lat: number, lng: number): string {
    return `${EARTH_RADIUS_KM} * acos(least(1, greatest(-1,
        cos(radians(${lat})) * cos(radians(bl.latitude))
            * cos(radians(bl.longitude) - radians(${lng}))
        + sin(radians(${lat})) * sin(radians(bl.latitude))
    )))`;
}

/**
 * Bounding box around the caller, a prefilter before exact distances.
 * Longitude delta is widened by 1/cos(lat) because longitude degrees
 * shrink towards the poles, and clamped at 180.
 */
export function boundingBox(input: NearbyQueryInput): {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
} {
    const latDelta = input.radiusKm / KM_PER_DEGREE_LAT;
    const lngDelta = Math.min(
        180,
        input.radiusKm / (KM_PER_DEGREE_LAT * Math.max(Math.cos((input.lat * Math.PI) / 180), 0.01)),
    );
    return {
        minLat: input.lat - latDelta,
        maxLat: input.lat + latDelta,
        minLng: input.lng - lngDelta,
        maxLng: input.lng + lngDelta,
    };
}
