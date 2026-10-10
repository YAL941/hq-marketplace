ALTER TABLE businesses
    ADD COLUMN reviewed_by BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
    ADD COLUMN reviewed_at TIMESTAMPTZ,
    ADD COLUMN seen_by_admin BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE businesses
   SET reviewed_by = verified_by,
       reviewed_at = COALESCE(verified_at, updated_at)
 WHERE status IN ('active', 'rejected');

ALTER TABLE businesses
    ALTER COLUMN seen_by_admin SET DEFAULT FALSE;

CREATE INDEX ix_businesses_admin_status_created
    ON businesses (status, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX ix_businesses_admin_name_lower
    ON businesses (lower(business_name));
CREATE INDEX ix_businesses_admin_email_lower
    ON businesses (lower(email::text))
    WHERE email IS NOT NULL;
CREATE INDEX ix_businesses_admin_seen
    ON businesses (seen_by_admin, created_at DESC)
    WHERE status = 'pending' AND deleted_at IS NULL;
