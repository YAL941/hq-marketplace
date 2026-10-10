DROP POLICY IF EXISTS reviews_customer_insert ON reviews;
CREATE POLICY reviews_customer_insert ON reviews
    FOR INSERT WITH CHECK (
        user_id = app_user_id()
        AND status = 'pending'
        AND app_business_is_public(business_id)
    );
