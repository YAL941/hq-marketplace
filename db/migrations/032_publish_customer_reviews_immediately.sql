-- Customer reviews still require a completed order and cannot be written by
-- business members, but valid reviews are visible publicly as soon as they
-- are submitted.
DROP POLICY IF EXISTS reviews_customer_insert ON reviews;
CREATE POLICY reviews_customer_insert ON reviews
    FOR INSERT WITH CHECK (
        user_id = app_user_id()
        AND order_id IS NOT NULL
        AND status = 'published'
        AND app_business_is_public(business_id)
        AND NOT app_is_business_member(business_id)
        AND EXISTS (
            SELECT 1
              FROM orders o
             WHERE o.order_id = reviews.order_id
               AND o.business_id = reviews.business_id
               AND o.customer_id = app_user_id()
               AND o.order_status = 'completed'
        )
    );

DROP POLICY IF EXISTS product_reviews_customer_insert ON product_reviews;
CREATE POLICY product_reviews_customer_insert ON product_reviews
    FOR INSERT WITH CHECK (
        user_id = app_user_id()
        AND status = 'published'
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
