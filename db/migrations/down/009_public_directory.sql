-- Rollback of 009_public_directory.sql
-- Removes the two columns and the opening-hours table added by 009, along with
-- their indexes, trigger and policies.
--
-- Order matters: the policies and the trigger have to go before the table, and
-- the table before the constraints that reference it.
--
-- This DROPS business_opening_hours together with any opening hours written
-- since the migration was applied. They are re-enterable by hand, but they are
-- real data, which is why the migrator asks for --allow-data-loss.
-- destructive: true

-- DROP TRIGGER is a statement of its own; it is not an ALTER TABLE subcommand.
DROP TRIGGER IF EXISTS trg_business_opening_hours_updated_at ON business_opening_hours;
DROP POLICY IF EXISTS business_opening_hours_staff_write ON business_opening_hours;
DROP POLICY IF EXISTS business_opening_hours_staff_read ON business_opening_hours;
DROP POLICY IF EXISTS business_opening_hours_public_read ON business_opening_hours;
DROP TABLE IF EXISTS business_opening_hours;

DROP INDEX IF EXISTS ix_businesses_featured;

ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_whatsapp_format;
ALTER TABLE businesses DROP COLUMN IF EXISTS whatsapp_number;
ALTER TABLE businesses DROP COLUMN IF EXISTS is_featured;
