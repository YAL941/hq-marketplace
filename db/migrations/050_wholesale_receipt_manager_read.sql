CREATE POLICY wholesale_receipts_manage_read ON wholesale_receipts
    FOR SELECT USING (
        app_has_business_permission(buyer_business_id, 'wholesale.manage')
        OR app_is_platform_admin()
    );
