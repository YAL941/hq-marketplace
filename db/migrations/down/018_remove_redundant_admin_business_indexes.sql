-- destructive: false
CREATE INDEX IF NOT EXISTS ix_businesses_admin_status_created
    ON businesses (status, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_businesses_admin_name_lower
    ON businesses (lower(business_name));
