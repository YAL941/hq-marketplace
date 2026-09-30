-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 010_public_review_authors.sql
-- Lets the public reviews endpoint show who wrote a review.
--
-- The problem: a review is public but its author is not. `users` has row level
-- security with no policy for anonymous visitors, so the obvious query
--
--     SELECT ... FROM reviews rv JOIN users u ON u.user_id = rv.user_id
--
-- silently returns zero rows for every anonymous caller. Not an error, just an
-- empty page, which is the worst kind of bug to notice.
--
-- Three ways out were considered:
--   1. add a policy letting everyone read users - rejected: that publishes
--      every email address and password hash row in the table;
--   2. denormalise the author name onto reviews - correct long term, since the
--      name a reviewer had when they wrote is arguably the right thing to
--      show, but it is a data migration on an existing table and out of scope
--      here;
--   3. one SECURITY DEFINER function that returns the display names and
--      nothing else. This file does 3.
--
-- The function is deliberately narrow: it takes a business id, it returns
-- nothing unless the business is publicly visible, and the only user column
-- it can ever reach is full_name.
-- =====================================================================

CREATE OR REPLACE FUNCTION app_public_reviews(
    p_business_id BIGINT,
    p_limit       INTEGER DEFAULT 20,
    p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE (
    review_id         BIGINT,
    rating            SMALLINT,
    review_text       TEXT,
    business_response TEXT,
    responded_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ,
    author_name       TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
    SELECT
        rv.review_id,
        rv.rating,
        rv.review_text,
        rv.business_response,
        rv.responded_at,
        rv.created_at,
        -- A reviewer who has since deleted their account, or whose row the
        -- platform removed, still has a review that is still on the page. The
        -- review is not hidden for that, so the name falls back rather than
        -- the row disappearing.
        COALESCE(u.full_name, 'Deleted user')
    FROM reviews rv
    JOIN businesses b ON b.business_id = rv.business_id
    LEFT JOIN users u ON u.user_id = rv.user_id
    WHERE rv.business_id = p_business_id
      AND rv.status = 'published'
      -- Same predicate the directory uses, checked here as well so the function
      -- cannot be called directly for a business that is not public.
      AND b.status = 'active'
      AND b.is_verified = TRUE
      AND b.verification_status = 'verified'
      AND b.deleted_at IS NULL
    ORDER BY rv.created_at DESC, rv.review_id DESC
    LIMIT LEAST(GREATEST(p_limit, 0), 50)
    OFFSET GREATEST(p_offset, 0);
$$;

COMMENT ON FUNCTION app_public_reviews(BIGINT, INTEGER, INTEGER) IS
    'Published reviews of a publicly visible business, each with the author display '
    'name. SECURITY DEFINER because users has no anonymous read policy; the only '
    'user column reachable from here is full_name. The limit is clamped to 50 in SQL '
    'as well, so calling the function directly cannot bypass the API cap.';

-- Granted to the application role and nobody else. Without this the function
-- would inherit EXECUTE from PUBLIC, which would let any database role read
-- every account display name.
REVOKE ALL ON FUNCTION app_public_reviews(BIGINT, INTEGER, INTEGER) FROM PUBLIC;
