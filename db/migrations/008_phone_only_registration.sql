-- =====================================================================
-- HQ Marketplace — Phase 1 / Database Architecture
-- 008_phone_only_registration.sql
-- Lets an account exist with a phone number and no email address.
--
-- 007 made users.phone unique and gave it a real lookup, but two pieces of
-- the schema still assumed every account has an email:
--
--   1. users.email was declared NOT NULL in 001;
--   2. the 005 registration-read policy matches the row being created by
--      comparing it to app.registering_email.
--
-- Without this migration a signup that supplies only a phone fails twice:
-- the INSERT is rejected by the NOT NULL constraint, and even if it were not,
-- the RETURNING clause would be filtered away by the SELECT policy and the
-- API would come back with no user at all.
--
-- This is a follow-up to 007 rather than an edit of it, because 007 is
-- already in the ledger. Rollback restores the NOT NULL constraint, which
-- fails loudly if any phone-only account exists: those rows have to be
-- resolved by hand rather than deleted by a rollback.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Email becomes optional
-- ---------------------------------------------------------------------
-- users_email_unique is already a UNIQUE constraint, and UNIQUE treats every
-- NULL as distinct, so "no email" is a legal value and stays legal for any
-- number of accounts. users_email_format is a CHECK, and a CHECK passes when
-- it evaluates to NULL, so it needs no change either.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

COMMENT ON COLUMN users.email IS
    'Optional. An account identifies with an email, a phone number, or both, '
    'but never with neither - the API enforces that. NOT NULL is not set here '
    'because a Somali mobile number is a perfectly good sole identity.';

-- ---------------------------------------------------------------------
-- 2. The registration read policy understands phones
-- ---------------------------------------------------------------------
-- PostgreSQL evaluates SELECT policies during INSERT ... RETURNING, so the row
-- a caller has just created must be readable by that same caller. The API now
-- sets both app.registering_email and app.registering_phone before inserting,
-- and this policy matches on whichever one it was given.
--
-- The same reasoning as 005 still holds: the unique constraints abort the
-- transaction when the value is already taken, so this policy cannot be used
-- to probe for existing accounts.
DROP POLICY IF EXISTS users_registration_read ON users;
CREATE POLICY users_registration_read ON users
    FOR SELECT USING (
        email = NULLIF(current_setting('app.registering_email', TRUE), '')::citext
        OR phone = NULLIF(current_setting('app.registering_phone', TRUE), '')::text
    );
