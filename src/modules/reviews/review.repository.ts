import type { PoolClient } from 'pg';
import { forbidden, notFound } from '../../db/errors.js';

export interface ReviewRow {
    review_id: string;
    business_id: string;
    user_id: string;
    order_id: string | null;
    rating: number;
    review_text: string | null;
    business_response: string | null;
    status: string;
    created_at: Date;
    updated_at: Date;
}

export async function createReview(
    client: PoolClient,
    userId: number,
    input: { businessId: number; orderId?: number | null; rating: number; reviewText?: string | null },
): Promise<ReviewRow> {
    const { rows } = await client.query<ReviewRow>(
        `INSERT INTO reviews (business_id, user_id, order_id, rating, review_text, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING *`,
        [input.businessId, userId, input.orderId ?? null, input.rating, input.reviewText ?? null],
    );
    return rows[0]!;
}

export async function listReviewsForBusiness(
    client: PoolClient,
    businessId: number,
    q: { status?: string; minRating?: number; limit?: number; offset?: number },
): Promise<ReviewRow[]> {
    const conditions: string[] = ['r.business_id = $1'];
    const params: unknown[] = [businessId];

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

    const { rows } = await client.query<ReviewRow>(
        `SELECT r.* FROM reviews r
          WHERE ${conditions.join(' AND ')}
          ORDER BY r.created_at DESC, r.review_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
    );
    return rows;
}

export async function listPublicReviews(
    client: PoolClient,
    q: { businessId?: number; limit?: number; offset?: number },
): Promise<ReviewRow[]> {
    const conditions: string[] = ["r.status = 'published'"];
    const params: unknown[] = [];
    if (q.businessId !== undefined) {
        params.push(q.businessId);
        conditions.push(`r.business_id = $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, 100));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;

    const { rows } = await client.query<ReviewRow>(
        `SELECT r.* FROM reviews r
          WHERE ${conditions.join(' AND ')}
          ORDER BY r.created_at DESC, r.review_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
    );
    return rows;
}

export async function respondToReview(
    client: PoolClient,
    businessId: number,
    reviewId: number,
    response: string,
): Promise<ReviewRow> {
    const { rows } = await client.query<{ allowed: boolean }>(
        `SELECT (app_has_business_permission($1, 'reviews.respond') OR app_is_platform_admin()) AS allowed`,
        [businessId],
    );
    if (rows[0]?.allowed !== true) throw forbidden('Missing permission: reviews.respond');

    const { rows: updated } = await client.query<ReviewRow>(
        `UPDATE reviews
            SET business_response = $3, responded_at = now()
          WHERE review_id = $1 AND business_id = $2
          RETURNING *`,
        [reviewId, businessId, response],
    );
    if (!updated[0]) throw notFound('Review not found in this business');
    return updated[0];
}

export async function moderateReview(
    client: PoolClient,
    businessId: number,
    reviewId: number,
    status: 'published' | 'hidden',
): Promise<ReviewRow> {
    const { rows } = await client.query<{ allowed: boolean }>(
        `SELECT (app_has_business_permission($1, 'reviews.moderate') OR app_is_platform_admin()) AS allowed`,
        [businessId],
    );
    if (rows[0]?.allowed !== true) throw forbidden('Missing permission: reviews.moderate');

    const { rows: updated } = await client.query<ReviewRow>(
        `UPDATE reviews SET status = $3 WHERE review_id = $1 AND business_id = $2 RETURNING *`,
        [reviewId, businessId, status],
    );
    if (!updated[0]) throw notFound('Review not found in this business');
    return updated[0];
}
