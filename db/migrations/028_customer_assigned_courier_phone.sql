CREATE POLICY users_customer_assigned_courier_read ON users
    FOR SELECT USING (
        EXISTS (
            SELECT 1
              FROM orders o
             WHERE o.customer_id = app_user_id()
               AND o.delivery_courier_id = users.user_id
               AND o.delivery_status IN ('assigned', 'picked_up', 'on_the_way', 'delivered')
        )
    );
