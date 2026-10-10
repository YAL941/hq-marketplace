import type { PoolClient } from 'pg';
import { badRequest, conflict, forbidden, notFound } from '../../db/errors.js';

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

export interface ReviewEligibility {
    eligible: boolean;
    order_id: string | null;
    already_reviewed: boolean;
}

export async function getReviewEligibility(
    client: PoolClient,
    userId: number,
    businessId: number,
): Promise<ReviewEligibility> {
    const { rows } = await client.query<{
        order_id: string | null;
        already_reviewed: boolean;
        is_member: boolean;
    }>(
        `SELECT
             (
                 SELECT o.order_id
                   FROM orders o
                  WHERE o.business_id = $2
                    AND o.customer_id = $1
                    AND o.order_status = 'completed'
                  ORDER BY o.completed_at DESC NULLS LAST, o.order_id DESC
                  LIMIT 1
             ) AS order_id,
             EXISTS (
                 SELECT 1 FROM reviews r
                  WHERE r.business_id = $2 AND r.user_id = $1
             ) AS already_reviewed,
             app_is_business_member($2) AS is_member`,
        [userId, businessId],
    );
    const eligibility = rows[0];
    if (!eligibility) throw notFound('Business not found');
    const allowed = !eligibility.is_member && !eligibility.already_reviewed && eligibility.order_id !== null;
    return {
        eligible: allowed,
        order_id: allowed ? eligibility.order_id : null,
        already_reviewed: eligibility.already_reviewed,
    };
}

export async function createReview(
    client: PoolClient,
    userId: number,
    input: { businessId: number; orderId: number; rating: number; reviewText?: string | null },
): Promise<ReviewRow> {
    const { rows: eligibleRows } = await client.query<{ allowed: boolean }>(
        `SELECT EXISTS (
             SELECT 1
               FROM orders o
              WHERE o.order_id = $1
                AND o.business_id = $2
                AND o.customer_id = $3
                AND o.order_status = 'completed'
         ) AND NOT app_is_business_member($2) AS allowed`,
        [input.orderId, input.businessId, userId],
    );
    if (eligibleRows[0]?.allowed !== true) {
        throw badRequest('A completed order for this business is required to write a review');
    }

    const { rows } = await client.query<ReviewRow>(
        `INSERT INTO reviews (business_id, user_id, order_id, rating, review_text, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (business_id, user_id) DO NOTHING
         RETURNING *`,
        [input.businessId, userId, input.orderId, input.rating, input.reviewText ?? null],
    );
    if (!rows[0]) throw conflict('You have already reviewed this business');
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
