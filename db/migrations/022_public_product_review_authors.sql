CREATE OR REPLACE FUNCTION app_public_product_reviews(
    p_product_id BIGINT,
    p_limit      INTEGER DEFAULT 20,
    p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE (
    product_review_id BIGINT,
    business_id       BIGINT,
    product_id        BIGINT,
    user_id           BIGINT,
    order_id          BIGINT,
    rating            SMALLINT,
    review_text       TEXT,
    business_response TEXT,
    status            review_status,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ,
    author_name       TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT
        r.product_review_id,
        r.business_id,
        r.product_id,
        r.user_id,
        r.order_id,
        r.rating,
        r.review_text,
        r.business_response,
        r.status,
        r.created_at,
        r.updated_at,
        COALESCE(u.full_name, 'Deleted user')
    FROM product_reviews r
    JOIN products p ON p.product_id = r.product_id AND p.business_id = r.business_id
    JOIN businesses b ON b.business_id = r.business_id
    LEFT JOIN users u ON u.user_id = r.user_id
    WHERE r.product_id = p_product_id
      AND r.status = 'published'
      AND p.status = 'active'
      AND p.deleted_at IS NULL
      AND b.status = 'active'
      AND b.is_verified = TRUE
      AND b.verification_status = 'verified'
      AND b.deleted_at IS NULL
    ORDER BY r.created_at DESC, r.product_review_id DESC
    LIMIT LEAST(GREATEST(p_limit, 0), 50)
    OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION app_public_product_reviews(BIGINT, INTEGER, INTEGER) IS
    'Published reviews for a publicly visible product. Exposes the reviewer display name only; '
    'SECURITY DEFINER is required because anonymous users cannot read users.';

REVOKE ALL ON FUNCTION app_public_product_reviews(BIGINT, INTEGER, INTEGER) FROM PUBLIC;
