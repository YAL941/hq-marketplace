-- Phase 5: Monetization (subscription plans, featured listings)

CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    tier TEXT NOT NULL UNIQUE,
    product_limit INTEGER NOT NULL DEFAULT 0,
    photo_limit INTEGER NOT NULL DEFAULT 0,
    featured_allowed BOOLEAN NOT NULL DEFAULT false,
    price_cents INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_subscriptions (
    id SERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
    status TEXT NOT NULL DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    UNIQUE (business_id)
);

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;

INSERT INTO subscription_plans (name, tier, product_limit, photo_limit, featured_allowed, price_cents)
VALUES
  ('Free', 'free', 20, 5, false, 0),
  ('Basic', 'basic', 100, 20, true, 999),
  ('Pro', 'pro', 1000, 100, true, 4999)
ON CONFLICT (tier) DO NOTHING;

-- default every existing business to free plan
INSERT INTO business_subscriptions (business_id, plan_id)
SELECT b.business_id, sp.id FROM businesses b
CROSS JOIN subscription_plans sp
WHERE sp.tier = 'free'
ON CONFLICT (business_id) DO NOTHING;
