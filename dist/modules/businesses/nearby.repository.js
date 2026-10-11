// Nearby search repository: the SQL the route runs.
import { distanceSql, boundingBox } from './nearby-query.js';
export async function findNearby(client, input) {
    const box = boundingBox(input);
    const distance = distanceSql(input.lat, input.lng);
    const offset = (input.page - 1) * input.limit;
    // $1..$5: radius and bounding box. Optional filters continue the
    // numbering; LIMIT/OFFSET are last in the page query only.
    const params = [input.radiusKm, box.minLat, box.maxLat, box.minLng, box.maxLng];
    const filters = [];
    if (input.city) {
        filters.push(`AND lower(bl.city) = lower($${params.length + 1})`);
        params.push(input.city);
    }
    if (input.categoryId) {
        filters.push(`AND b.business_category_id = $${params.length + 1}`);
        params.push(input.categoryId);
    }
    if (input.q) {
        filters.push(`AND lower(b.business_name) LIKE '%' || lower($${params.length + 1}) || '%'`);
        params.push(input.q);
    }
    const countParams = [...params];
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    params.push(input.limit, offset);
    // Active branches of public businesses within box and radius.
    // Visibility is answered twice: here by app_business_is_public, and
    // again by row level security for a memberless context.
    const from = `
           FROM businesses b
           JOIN business_locations bl
             ON bl.business_id = b.business_id
            AND bl.is_active = TRUE
            AND bl.latitude IS NOT NULL
            AND bl.longitude IS NOT NULL
          WHERE app_business_is_public(b.business_id)
            AND bl.latitude BETWEEN $2 AND $3
            AND bl.longitude BETWEEN $4 AND $5
            AND ${distance} <= $1
            ${filters.join('\n')}`;
    // A business with several branches is listed once, at its closest
    // branch — a customer drives to the near branch, not to the centroid.
    const listed = await client.query(`SELECT b.business_id, b.business_slug, b.business_name, bl.city,
                MIN(${distance}) AS distance_km${from}
         GROUP BY b.business_id, b.business_slug, b.business_name, bl.city
         ORDER BY distance_km ASC, b.business_id
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`, params);
    const counted = await client.query(`SELECT COUNT(*) AS total FROM (
             SELECT b.business_id${from}
             GROUP BY b.business_id
         ) matched`, countParams);
    return { rows: listed.rows, total: Number(counted.rows[0]?.total ?? 0) };
}
//# sourceMappingURL=nearby.repository.js.map