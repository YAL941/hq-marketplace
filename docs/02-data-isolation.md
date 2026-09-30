# HQ Marketplace — Data Isolation (Phase 1)

The requirement: with `BusinessID = 101` in context, the system must not be able to
return data of `BusinessID = 202`. This document describes how that is enforced and
why it does not rely on the frontend.

## Layers

```text
1. Business context resolution   src/middleware/error.ts   resolveBusiness()
2. Membership check              app_is_business_member()   (database)
3. Permission check              app_has_business_permission() (database)
4. Query scoping                 WHERE business_id = $1     (application)
5. Row Level Security            ENABLE ROW LEVEL SECURITY   (database, mandatory)
6. Composite foreign keys        an order cannot mix tenants
```

Layers 2, 3, 5 and 6 are enforced by PostgreSQL. Even a completely broken
application that issues `SELECT * FROM products` still gets only the rows the
current user is allowed to see.

## 1. Request context

Every request resolves exactly one business:

- from the path (`/api/business/:businessId/...`), or
- from the `X-Business-Id` header.

`resolveBusiness()` parses it, then asks the database whether the caller is an
active member of that business (`business_users.status = 'active'`). A non-member
gets `403` before any tenant query runs. The id is therefore never trusted as an
input, only as a claim to be verified.

## 2. Tenant context propagation

`src/db/tenant.ts` opens a transaction, sets the request identity on the
connection, and runs the callback:

```ts
await client.query('SELECT set_config($1, $2, true)', ['app.user_id', String(ctx.userId)]);
await client.query('SELECT set_config($1, $2, true)', ['app.is_platform_admin', ...]);
await client.query('SELECT set_config($1, $2, true)', ['app.current_business_id', ...]);
```

`set_config(..., true)` is transaction-local: the value is discarded on commit or
rollback, so nothing leaks to the next request that reuses a pooled connection.
`withTenant()` also guarantees that a failed request leaves no partial write.

## 3. Row Level Security

Enabled on `users`, `businesses`, `business_users`, `business_locations`,
`products`, `services`, `orders`, `order_items`, `reviews` and
`business_statistics`.

| Table | Who reads it |
| --- | --- |
| `businesses` | anyone, but only rows that are `status = 'active'` and not deleted; members also read their own pending business; platform admin reads all |
| `products` / `services` | active rows of active businesses for the public catalogue; members read all rows of their own business |
| `orders` | the customer who placed the order, the owning business, the platform admin. No deletes |
| `order_items` | participants of the parent order (verified through the `orders` table inside the policy) |
| `reviews` | published reviews publicly, plus all reviews for members |
| `business_users` | the user themselves, members of the same business, platform admin |
| `business_statistics` | members and platform admin |

The helper functions (`app_is_business_member`, `app_has_business_permission`,
`app_business_ids`, `app_business_is_public`, `app_business_has_no_members`) are
`SECURITY DEFINER`. Without that, a policy on `business_users` that queries
`business_users` would recurse infinitely, because RLS would re-apply the policy to
the sub-query.

`app_user_for_login()` is also `SECURITY DEFINER`: an anonymous visitor cannot read
`users` at all, so login needs a narrow function that returns a single row for
password verification. It must never be exposed directly by an endpoint.

## 4. The role the application connects as

```text
hq_app   -> LOGIN, no ownership, RLS enforced      (the API)
postgres -> owns the schema, bypasses RLS           (migrations, seeds, grants only)
```

If the API connected as the owner, RLS would be skipped entirely and the whole
isolation model would collapse. `scripts/apply-grants.ts` creates `hq_app`, grants
`SELECT/INSERT/UPDATE/DELETE`, and revokes `PUBLIC`. Running the API as the owner is
a deployment error, not a configuration detail.

## 5. Roles and permissions

Permissions are context-free strings (`products.edit`); the *context* comes from
where the permission is granted:

| Role | Scope | Effect |
| --- | --- | --- |
| `platform_admin` | platform | every permission, on every business |
| `platform_support` | platform | read-only across businesses |
| `customer` | platform | browse, order, review |
| `business_owner` | business | full control of **their** business, including employees |
| `business_manager` | business | day-to-day operations, no employee management |
| `business_employee` | business | limited read/update, no creation, no deletion |

A `platform_admin` is never implicitly an owner of every business: the two live in
different tables (`user_platform_roles` vs `business_users`) and triggers reject
granting a business-scoped role at platform level, and vice versa.

`business.edit` is checked against the business in the request context, so a
Business Owner of business 101 can never update business 202: the API rejects it
(403, not a member) and RLS rejects the row even if the request reaches SQL.

## 6. Onboarding without a back door

A business is created in `status = 'pending'`, `verification_status = 'pending'`,
`is_verified = false`. The `businesses_user_create` RLS policy allows any
authenticated user to insert exactly such a row, and `business_users_claim_ownership`
lets only the first member claim ownership of a business that has no members yet.
Pending businesses stay invisible to the public directory until a platform admin
activates them.

## 7. What is explicitly not done

- No business id is hardcoded in the application.
- No isolation decision is made in the frontend; the frontend only ever displays
  what the API returned.
- No cross-business query is issued "temporarily"; analytics are per business.
- No test uses mock data: the tests run against a real PostgreSQL database.
