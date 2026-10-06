-- Account-scoped business favorites. RLS makes the JWT-derived user id the
-- only identity allowed to read or change its own saved businesses.
CREATE TABLE user_favorites (
    user_id      BIGINT      NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    business_id  BIGINT      NOT NULL REFERENCES businesses (business_id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_favorites_pk PRIMARY KEY (user_id, business_id)
);

CREATE INDEX ix_user_favorites_business ON user_favorites (business_id);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_favorites_owner_access ON user_favorites
    FOR ALL
    USING (user_id = app_user_id())
    WITH CHECK (user_id = app_user_id());
