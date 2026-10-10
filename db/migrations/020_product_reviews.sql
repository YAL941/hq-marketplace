CREATE TABLE product_reviews (
    product_review_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_id       BIGINT        NOT NULL REFERENCES businesses (business_id) ON DELETE RESTRICT,
    product_id        BIGINT        NOT NULL,
    user_id           BIGINT        NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
    order_id          BIGINT        NOT NULL,
    rating            SMALLINT      NOT NULL,
    review_text       TEXT,
    business_response TEXT,
    responded_at      TIMESTAMPTZ,
    status            review_status NOT NULL DEFAULT 'pending',
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT product_reviews_product_user_unique UNIQUE (product_id, user_id),
    CONSTRAINT product_reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT product_reviews_text_len CHECK (review_text IS NULL OR char_length(review_text) <= 4000),
    CONSTRAINT product_reviews_response_requires_text CHECK (responded_at IS NULL OR business_response IS NOT NULL),
    CONSTRAINT product_reviews_product_business_fk FOREIGN KEY (product_id, business_id)
        REFERENCES products (product_id, business_id) ON DELETE RESTRICT,
    CONSTRAINT product_reviews_order_business_fk FOREIGN KEY (order_id, business_id)
        REFERENCES orders (order_id, business_id) ON DELETE RESTRICT
);

CREATE INDEX ix_product_reviews_product_status
    ON product_reviews (product_id, status, created_at DESC);
CREATE INDEX ix_product_reviews_business_status
    ON product_reviews (business_id, status, created_at DESC);
CREATE INDEX ix_product_reviews_user
    ON product_reviews (user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_product_reviews_updated_at ON product_reviews;
CREATE TRIGGER trg_product_reviews_updated_at BEFORE UPDATE ON product_reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_reviews_public_read ON product_reviews
    FOR SELECT USING (
        status = 'published'
        AND app_business_is_public(business_id)
        AND EXISTS (
            SELECT 1 FROM products p
             WHERE p.product_id = product_reviews.product_id
               AND p.status = 'active'
               AND p.deleted_at IS NULL
        )
    );
CREATE POLICY product_reviews_staff_read ON product_reviews
    FOR SELECT USING (app_is_business_member(business_id) OR app_is_platform_admin());
CREATE POLICY product_reviews_author_read ON product_reviews
    FOR SELECT USING (user_id = app_user_id());
CREATE POLICY product_reviews_customer_insert ON product_reviews
    FOR INSERT WITH CHECK (
        user_id = app_user_id()
        AND status = 'pending'
        AND NOT app_is_business_member(business_id)
        AND EXISTS (
            SELECT 1
              FROM orders o
              JOIN order_items oi ON oi.order_id = o.order_id
             WHERE o.order_id = product_reviews.order_id
               AND o.business_id = product_reviews.business_id
               AND o.customer_id = app_user_id()
               AND o.order_status = 'completed'
               AND oi.product_id = product_reviews.product_id
        )
    );
CREATE POLICY product_reviews_staff_update ON product_reviews
    FOR UPDATE USING (app_is_business_member(business_id) OR app_is_platform_admin())
    WITH CHECK (
        app_has_business_permission(business_id, 'reviews.respond')
        OR app_has_business_permission(business_id, 'reviews.moderate')
        OR app_is_platform_admin()
    );
CREATE POLICY product_reviews_no_delete ON product_reviews
    FOR DELETE USING (app_is_platform_admin());
