import { badRequest, conflict, forbidden, notFound } from '../../db/errors.js';
export async function getReviewEligibility(client, userId, businessId) {
    const { rows } = await client.query(`SELECT
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
             app_is_business_member($2) AS is_member`, [userId, businessId]);
    const eligibility = rows[0];
    if (!eligibility)
        throw notFound('Business not found');
    const allowed = !eligibility.is_member && !eligibility.already_reviewed && eligibility.order_id !== null;
    return {
        eligible: allowed,
        order_id: allowed ? eligibility.order_id : null,
        already_reviewed: eligibility.already_reviewed,
        is_member: eligibility.is_member,
    };
}
export async function createReview(client, userId, input) {
    const { rows: eligibleRows } = await client.query(`SELECT EXISTS (
             SELECT 1
               FROM orders o
              WHERE o.order_id = $1
                AND o.business_id = $2
                AND o.customer_id = $3
                AND o.order_status = 'completed'
         ) AND NOT app_is_business_member($2) AS allowed`, [input.orderId, input.businessId, userId]);
    if (eligibleRows[0]?.allowed !== true) {
        throw badRequest('A completed order for this business is required to write a review');
    }
    const { rows } = await client.query(`INSERT INTO reviews (business_id, user_id, order_id, rating, review_text, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (business_id, user_id) DO NOTHING
         RETURNING *`, [input.businessId, userId, input.orderId, input.rating, input.reviewText ?? null]);
    if (!rows[0])
        throw conflict('You have already reviewed this business');
    return rows[0];
}
export async function getProductReviewEligibility(client, userId, productId) {
    const { rows } = await client.query(`SELECT
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
          WHERE p.product_id = $2 AND p.status = 'active' AND p.deleted_at IS NULL`, [userId, productId]);
    const eligibility = rows[0];
    if (!eligibility)
        throw notFound('Product not found');
    const allowed = !eligibility.is_member && !eligibility.already_reviewed && eligibility.order_id !== null;
    return {
        eligible: allowed,
        order_id: allowed ? eligibility.order_id : null,
        already_reviewed: eligibility.already_reviewed,
        is_member: eligibility.is_member,
    };
}
export async function createProductReview(client, userId, input) {
    const { rows: eligibleRows } = await client.query(`SELECT EXISTS (
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
         ) AS allowed`, [input.productId, input.orderId, userId]);
    if (eligibleRows[0]?.allowed !== true) {
        throw badRequest('A completed order containing this product is required to write a review');
    }
    const { rows } = await client.query(`INSERT INTO product_reviews (product_id, business_id, user_id, order_id, rating, review_text, status)
         SELECT p.product_id, p.business_id, $2, $3, $4, $5, 'pending'
           FROM products p
          WHERE p.product_id = $1
         ON CONFLICT (product_id, user_id) DO NOTHING
         RETURNING *`, [input.productId, userId, input.orderId, input.rating, input.reviewText ?? null]);
    if (!rows[0])
        throw conflict('You have already reviewed this product');
    return rows[0];
}
export async function listPublicProductReviews(client, productId, limit = 50, offset = 0) {
    const { rows } = await client.query(`SELECT product_review_id, rating, review_text, business_response, created_at, author_name
           FROM app_public_product_reviews($1, $2, $3)`, [productId, Math.min(limit, 100), Math.max(offset, 0)]);
    return rows;
}
export async function listProductReviewsForBusiness(client, businessId, q) {
    const conditions = ['r.business_id = $1'];
    const params = [businessId];
    if (q.status) {
        params.push(q.status);
        conditions.push(`r.status = $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 50, 100));
    const limitIdx = params.length;
    params.push(Math.max(q.offset ?? 0, 0));
    const offsetIdx = params.length;
    const { rows } = await client.query(`SELECT r.*, p.product_name FROM product_reviews r
          JOIN products p ON p.product_id = r.product_id AND p.business_id = r.business_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY r.created_at DESC, r.product_review_id DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
    return rows;
}
export async function moderateProductReview(client, businessId, productReviewId, status) {
    const { rows: permissionRows } = await client.query(`SELECT (app_has_business_permission($1, 'reviews.moderate') OR app_is_platform_admin()) AS allowed`, [businessId]);
    if (permissionRows[0]?.allowed !== true)
        throw forbidden('Missing permission: reviews.moderate');
    const { rows } = await client.query(`UPDATE product_reviews SET status = $3
          WHERE product_review_id = $1 AND business_id = $2
          RETURNING *`, [productReviewId, businessId, status]);
    if (!rows[0])
        throw notFound('Product review not found in this business');
    await client.query(`UPDATE products p
            SET rating_count = ratings.review_count,
                rating_avg = ratings.average_rating
           FROM (
               SELECT product_id, count(*)::integer AS review_count, coalesce(avg(rating), 0) AS average_rating
                 FROM product_reviews
                WHERE product_id = $1 AND status = 'published'
                GROUP BY product_id
           ) ratings
          WHERE p.product_id = ratings.product_id`, [rows[0].product_id]);
    if (status === 'hidden') {
        await client.query(`UPDATE products
                SET rating_count = 0, rating_avg = 0
              WHERE product_id = $1
                AND NOT EXISTS (
                    SELECT 1 FROM product_reviews
                     WHERE product_id = $1 AND status = 'published'
                )`, [rows[0].product_id]);
    }
    return rows[0];
}
export async function respondToProductReview(client, businessId, productReviewId, response) {
    const { rows: permissionRows } = await client.query(`SELECT (app_has_business_permission($1, 'reviews.respond') OR app_is_platform_admin()) AS allowed`, [businessId]);
    if (permissionRows[0]?.allowed !== true)
        throw forbidden('Missing permission: reviews.respond');
    const { rows } = await client.query(`UPDATE product_reviews
            SET business_response = $3, responded_at = now()
          WHERE product_review_id = $1 AND business_id = $2
          RETURNING *`, [productReviewId, businessId, response]);
    if (!rows[0])
        throw notFound('Product review not found in this business');
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