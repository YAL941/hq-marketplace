-- A customer review is verified by a completed order from the same customer
-- and business. Business members cannot review their own listing.
DROP POLICY IF EXISTS reviews_customer_insert ON reviews;
CREATE POLICY reviews_customer_insert ON reviews
    FOR INSERT WITH CHECK (
        user_id = app_user_id()
        AND order_id IS NOT NULL
        AND status = 'pending'
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
