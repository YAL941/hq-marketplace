-- destructive: false
DROP INDEX IF EXISTS ix_businesses_admin_seen;
DROP INDEX IF EXISTS ix_businesses_admin_email_lower;
DROP INDEX IF EXISTS ix_businesses_admin_name_lower;
DROP INDEX IF EXISTS ix_businesses_admin_status_created;
ALTER TABLE businesses
    DROP COLUMN IF EXISTS seen_by_admin,
    DROP COLUMN IF EXISTS reviewed_at,
    DROP COLUMN IF EXISTS reviewed_by;
