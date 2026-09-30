-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 009_public_directory.sql
-- Columns and the opening-hours table the public directory needs.
--
-- Everything here is additive. No existing column is retyped, no existing
-- policy is widened, and no data is rewritten, so a rollback of this file
-- leaves the schema exactly as 008 left it.
--
-- Why anything is needed at all:
--   * businesses has no WhatsApp column, and a directory entry without it is
--     missing the contact channel a Somali customer is most likely to use;
--   * "featured=true" needs a flag to sort on, not a boolean assembled from
--     is_verified;
--   * opening hours are genuinely per weekday, so seven fixed columns would
--     be seven NULLs to migrate later. A child table keeps "closed on
--     Sunday" expressible without a magic value in a time column.
--
-- logo_url and cover_image_url already exist on businesses from 001, so the
-- directory returns those as they are and needs no column for them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WhatsApp
-- ---------------------------------------------------------------------
-- Same shape as businesses.phone: digits with an optional leading +. The API
-- normalises before it writes; the constraint is the backstop for a second
-- writer, not the parser.
ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

ALTER TABLE businesses
    DROP CONSTRAINT IF EXISTS businesses_whatsapp_format;
ALTER TABLE businesses
    ADD CONSTRAINT businesses_whatsapp_format
    CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^\+?[0-9]{7,15}$');

COMMENT ON COLUMN businesses.whatsapp_number IS
    'Optional WhatsApp contact. Public: shown on the business profile so a '
    'customer can reach the business on the channel it actually uses.';

-- ---------------------------------------------------------------------
-- 2. Featured
-- ---------------------------------------------------------------------
-- Separate from is_verified on purpose. is_verified is an answer to "did the
-- platform check this business"; is_featured is an editorial answer to "should
-- this be pushed at the top of the list". Conflating them would make every
-- verified business featured, which is not a decision anyone made.
ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN businesses.is_featured IS
    'Editorial flag for the public directory sort. Not an approval: a business '
    'still has to be active and verified to appear publicly at all.';

-- Partial index, because the directory always filters on active + verified +
-- not deleted first, and a featured query is a subset of that.
CREATE INDEX IF NOT EXISTS ix_businesses_featured
    ON businesses (created_at DESC)
    WHERE is_featured AND deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 3. Opening hours
-- ---------------------------------------------------------------------
-- day_of_week follows JavaScript Date#getDay(): 0 = Sunday .. 6 = Saturday.
-- Chosen over ISO numbering because the API serialises straight to the day
-- names a calendar widget expects, and a silent 0/1 shift is the kind of bug
-- that shows up as "the clinic is closed on Saturday".
--
-- A missing row means "not stated yet", which is different from
-- is_closed = TRUE ("stated, and closed"), and the API reports them
-- differently.
CREATE TABLE IF NOT EXISTS business_opening_hours (
    business_id   BIGINT      NOT NULL
                              REFERENCES businesses (business_id) ON DELETE CASCADE,
    day_of_week   SMALLINT    NOT NULL,
    opens_at      TIME,
    closes_at     TIME,
    is_closed     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT business_opening_hours_pk PRIMARY KEY (business_id, day_of_week),
    CONSTRAINT opening_hours_day_range CHECK (day_of_week BETWEEN 0 AND 6),
    -- A day either has hours or is marked closed; half a day is not a state
    -- the directory can render.
    CONSTRAINT opening_hours_pair CHECK (
        (is_closed AND opens_at IS NULL AND closes_at IS NULL)
        OR (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL)
    ),
    -- A shop that closes at 01:00 is open past midnight, which is legal; a day
    -- that opens after it closes without wrapping is not.
    CONSTRAINT opening_hours_order CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at)
);

COMMENT ON TABLE business_opening_hours IS
    'Per weekday opening hours for the public profile. day_of_week is 0=Sunday '
    '.. 6=Saturday, matching Date#getDay(). A missing row means the business '
    'has not stated its hours; is_closed = TRUE means it stated that it is shut.';

COMMENT ON CONSTRAINT opening_hours_pair ON business_opening_hours IS
    'Either the day is closed, or both ends of the interval are present. There '
    'is no third state, so the UI never has to guess which it is looking at.';

-- The directory reads all seven rows of one business in one go.
CREATE INDEX IF NOT EXISTS ix_business_opening_hours_business
    ON business_opening_hours (business_id);

DROP TRIGGER IF EXISTS trg_business_opening_hours_updated_at ON business_opening_hours;
CREATE TRIGGER trg_business_opening_hours_updated_at
    BEFORE UPDATE ON business_opening_hours
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Isolation for the new table
-- ---------------------------------------------------------------------
-- The child rows of a business carry no business-scoped policy of their own,
-- because a business id that is not public must not be readable "because its
-- hours are harmless". Public visibility is delegated to the parent, exactly
-- the way the catalogue and commerce tables do it, so a suspended business
-- cannot leak its schedule.
ALTER TABLE business_opening_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_opening_hours_public_read ON business_opening_hours;
CREATE POLICY business_opening_hours_public_read ON business_opening_hours
    FOR SELECT USING (app_business_is_public(business_id));

DROP POLICY IF EXISTS business_opening_hours_staff_read ON business_opening_hours;
CREATE POLICY business_opening_hours_staff_read ON business_opening_hours
    FOR SELECT USING (app_is_business_member(business_id) OR app_is_platform_admin());

DROP POLICY IF EXISTS business_opening_hours_staff_write ON business_opening_hours;
CREATE POLICY business_opening_hours_staff_write ON business_opening_hours
    FOR ALL
    USING (app_is_business_member(business_id) OR app_is_platform_admin())
    WITH CHECK (app_is_business_member(business_id) OR app_is_platform_admin());
