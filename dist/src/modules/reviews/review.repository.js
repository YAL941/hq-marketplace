import { forbidden, notFound } from '../../db/errors.js';
export async function createReview(client, userId, input) {
    const { rows } = await client.query(`INSERT INTO reviews (business_id, user_id, order_id, rating, review_text, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING *`, [input.businessId, userId, input.orderId ?? null, input.rating, input.reviewText ?? null]);
    return rows[0];
}
export async function listReviewsForBusiness(client, businessId, q) {
    const conditions = ['r.business_id = $1'];
    const params = [businessId];
    if (q.status) {
        params.push(q.status);
        conditions.push(`r.status = $${params.length}`);
    }
    if (q.minRating !== undefined) {
        params.push(q.minRating);
        conditions.push(`r.rating >= $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, 100));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;
    const { rows } = await client.query(`SELECT r.* FROM reviews r
          WHERE ${conditions.join(' AND ')}
          ORDER BY r.created_at DESC, r.review_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    return rows;
}
export async function listPublicReviews(client, q) {
    const conditions = ["r.status = 'published'"];
    const params = [];
    if (q.businessId !== undefined) {
        params.push(q.businessId);
        conditions.push(`r.business_id = $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, 100));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;
    const { rows } = await client.query(`SELECT r.* FROM reviews r
          WHERE ${conditions.join(' AND ')}
          ORDER BY r.created_at DESC, r.review_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    return rows;
}
export async function respondToReview(client, businessId, reviewId, response) {
    const { rows } = await client.query(`SELECT (app_has_business_permission($1, 'reviews.respond') OR app_is_platform_admin()) AS allowed`, [businessId]);
    if (rows[0]?.allowed !== true)
        throw forbidden('Missing permission: reviews.respond');
    const { rows: updated } = await client.query(`UPDATE reviews
            SET business_response = $3, responded_at = now()
          WHERE review_id = $1 AND business_id = $2
          RETURNING *`, [reviewId, businessId, response]);
    if (!updated[0])
        throw notFound('Review not found in this business');
    return updated[0];
}
export async function moderateReview(client, businessId, reviewId, status) {
    const { rows } = await client.query(`SELECT (app_has_business_permission($1, 'reviews.moderate') OR app_is_platform_admin()) AS allowed`, [businessId]);
    if (rows[0]?.allowed !== true)
        throw forbidden('Missing permission: reviews.moderate');
    const { rows: updated } = await client.query(`UPDATE reviews SET status = $3 WHERE review_id = $1 AND business_id = $2 RETURNING *`, [reviewId, businessId, status]);
    if (!updated[0])
        throw notFound('Review not found in this business');
    return updated[0];
}
//# sourceMappingURL=review.repository.js.map