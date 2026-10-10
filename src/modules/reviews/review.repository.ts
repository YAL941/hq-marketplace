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
    is_member: boolean;
}

export interface ProductReviewRow {
    product_review_id: string;
    business_id: string;
    product_id: string;
    product_name?: string;
    author_name?: string;
    user_id: string;
    order_id: string;
    rating: number;
    review_text: string | null;
    business_response: string | null;
    status: string;
    created_at: Date;
    updated_at: Date;
}

export interface PublicProductReviewRow {
    product_review_id: string;
    rating: number;
    review_text: string | null;
    business_response: string | null;
    created_at: Date;
    author_name: string;
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
        is_member: eligibility.is_member,
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

export async function getProductReviewEligibility(
    client: PoolClient,
    userId: number,
    productId: number,
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
                   JOIN order_items oi ON oi.order_id = o.order_id
                  WHERE oi.product_id = $2
                    AND o.customer_id = $1
                    AND o.order_status = 'completed'
                  ORDER BY o.completed_at DESC NULLS LAST, o.order_id DESC
                  LIMIT 1
             ) AS order_id,
             EXISTS (
                 SELECT 1 FROM product_reviews r
                  WHERE r.product_id = $2 AND r.user_id = $1
             ) AS already_reviewed,
             app_is_business_member(p.business_id) AS is_member
           FROM products p
          WHERE p.product_id = $2 AND p.status = 'active' AND p.deleted_at IS NULL`,
        [userId, productId],
    );
    const eligibility = rows[0];
    if (!eligibility) throw notFound('Product not found');
    const allowed = !eligibility.is_member && !eligibility.already_reviewed && eligibility.order_id !== null;
    return {
        eligible: allowed,
        order_id: allowed ? eligibility.order_id : null,
        already_reviewed: eligibility.already_reviewed,
        is_member: eligibility.is_member,
    };
}

export async function createProductReview(
    client: PoolClient,
    userId: number,
    input: { productId: number; orderId: number; rating: number; reviewText?: string | null },
): Promise<ProductReviewRow> {
    const { rows: eligibleRows } = await client.query<{ allowed: boolean }>(
        `SELECT EXISTS (
             SELECT 1
               FROM products p
               JOIN orders o ON o.business_id = p.business_id
               JOIN order_items oi ON oi.order_id = o.order_id AND oi.product_id = p.product_id
              WHERE p.product_id = $1
                AND p.status = 'active'
                AND p.deleted_at IS NULL
                AND o.order_id = $2
                AND o.customer_id = $3
                AND o.order_status = 'completed'
         ) AND NOT app_is_business_member(
             (SELECT business_id FROM products WHERE product_id = $1)
         ) AS allowed`,
        [input.productId, input.orderId, userId],
    );
    if (eligibleRows[0]?.allowed !== true) {
        throw badRequest('A completed order containing this product is required to write a review');
    }

    const { rows } = await client.query<ProductReviewRow>(
        `INSERT INTO product_reviews (product_id, business_id, user_id, order_id, rating, review_text, status)
         SELECT p.product_id, p.business_id, $2, $3, $4, $5, 'pending'
           FROM products p
          WHERE p.product_id = $1
         ON CONFLICT (product_id, user_id) DO NOTHING
         RETURNING *`,
        [input.productId, userId, input.orderId, input.rating, input.reviewText ?? null],
    );
    if (!rows[0]) throw conflict('You have already reviewed this product');
    return rows[0]!;
}

export async function listPublicProductReviews(
    client: PoolClient,
    productId: number,
    limit = 50,
    offset = 0,
): Promise<PublicProductReviewRow[]> {
    const { rows } = await client.query<PublicProductReviewRow>(
        `SELECT product_review_id, rating, review_text, business_response, created_at, author_name
           FROM app_public_product_reviews($1, $2, $3)`,
        [productId, Math.min(limit, 100), Math.max(offset, 0)],
    );
    return rows;
}

export async function listProductReviewsForBusiness(
    client: PoolClient,
    businessId: number,
    q: { status?: string; limit?: number; offset?: number },
): Promise<ProductReviewRow[]> {
    const conditions: string[] = ['r.business_id = $1'];
    const params: unknown[] = [businessId];
    if (q.status) {
        params.push(q.status);
        conditions.push(`r.status = $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, 100));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;
    const { rows } = await client.query<ProductReviewRow>(
        `SELECT r.*, p.product_name FROM product_reviews r
          JOIN products p ON p.product_id = r.product_id AND p.business_id = r.business_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY r.created_at DESC, r.product_review_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
    );
    return rows;
}

export async function moderateProductReview(
    client: PoolClient,
    businessId: number,
    productReviewId: number,
    status: 'published' | 'hidden',
): Promise<ProductReviewRow> {
    const { rows: permissionRows } = await client.query<{ allowed: boolean }>(
        `SELECT (app_has_business_permission($1, 'reviews.moderate') OR app_is_platform_admin()) AS allowed`,
        [businessId],
    );
    if (permissionRows[0]?.allowed !== true) throw forbidden('Missing permission: reviews.moderate');

    const { rows } = await client.query<ProductReviewRow>(
        `UPDATE product_reviews SET status = $3
          WHERE product_review_id = $1 AND business_id = $2
          RETURNING *`,
        [productReviewId, businessId, status],
    );
    if (!rows[0]) throw notFound('Product review not found in this business');
    await client.query(
        `UPDATE products p
            SET rating_count = ratings.review_count,
                rating_avg = ratings.average_rating
           FROM (
               SELECT product_id, count(*)::integer AS review_count, coalesce(avg(rating), 0) AS average_rating
                 FROM product_reviews
                WHERE product_id = $1 AND status = 'published'
                GROUP BY product_id
           ) ratings
          WHERE p.product_id = ratings.product_id`,
        [rows[0].product_id],
    );
    if (status === 'hidden') {
        await client.query(
            `UPDATE products
                SET rating_count = 0, rating_avg = 0
              WHERE product_id = $1
                AND NOT EXISTS (
                    SELECT 1 FROM product_reviews
                     WHERE product_id = $1 AND status = 'published'
                )`,
            [rows[0].product_id],
        );
    }
    return rows[0];
}

export async function respondToProductReview(
    client: PoolClient,
    businessId: number,
    productReviewId: number,
    response: string,
): Promise<ProductReviewRow> {
    const { rows: permissionRows } = await client.query<{ allowed: boolean }>(
        `SELECT (app_has_business_permission($1, 'reviews.respond') OR app_is_platform_admin()) AS allowed`,
        [businessId],
    );
    if (permissionRows[0]?.allowed !== true) throw forbidden('Missing permission: reviews.respond');

    const { rows } = await client.query<ProductReviewRow>(
        `UPDATE product_reviews
            SET business_response = $3, responded_at = now()
          WHERE product_review_id = $1 AND business_id = $2
          RETURNING *`,
        [productReviewId, businessId, response],
    );
    if (!rows[0]) throw notFound('Product review not found in this business');
    return rows[0];
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
