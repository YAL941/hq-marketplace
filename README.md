# HQ Marketplace — Phase 1

Database architecture and multi-business data isolation.
No UI, no marketplace redesign: this phase is the data foundation only.

## What is implemented

- Multi-tenant schema where every business-scoped row carries `business_id NOT NULL`.
- `businesses` as the tenant root, with slug uniqueness, status and a verification workflow.
- Platform identity (`users`, `roles`, `permissions`) with **scoped** roles, so
  `platform_admin` and `business_owner` are never the same kind of authority.
- `business_users` membership table: one user can belong to many businesses with different roles.
- Catalogue (`products`, `services`), branches (`business_locations`), commerce
  (`orders`, `order_items`), `reviews`, and a derived statistics layer.
- **Data isolation enforced in PostgreSQL** through Row Level Security, in addition to
  `WHERE business_id = ...` in every repository query.
- Migration runner with per-migration rollback scripts and a schema-change ledger.

Documentation: [`docs/01-schema.md`](docs/01-schema.md), [`docs/02-data-isolation.md`](docs/02-data-isolation.md),
[`docs/03-migration-safety.md`](docs/03-migration-safety.md).

## Prerequisites

- Node.js >= 20
- PostgreSQL >= 15

## Setup

```bash
cp .env.example .env        # Windows: copy .env.example .env
npm install
npm run db:setup            # create databases, migrate, grant, seed
npm run dev
```

`npm run db:setup` runs, in order:

| Step | Command | What it does |
| --- | --- | --- |
| 1 | `db:create` | creates `hq_marketplace` and `hq_marketplace_test` |
| 2 | `db:migrate` | applies `db/migrations/*.sql` in order, each in a transaction |
| 3 | `db:grants` | creates the `hq_app` role and grants it **non-owner** privileges |
| 4 | `db:seed` | development fixtures only |

Step 3 matters: the API must connect as `hq_app`, not as the table owner. Only a
non-owner role is subject to RLS.

## Tests

```bash
npm test
```

The suite creates its own fixtures in `hq_marketplace_test` and covers the eight
required scenarios: product ownership, cross-business denial (API **and** raw SQL
with no `WHERE` clause), owner isolation, public directory visibility, order
creation with frozen prices, review isolation, multiple branches, and duplicate
business names.

## Migrations

```bash
npm run db:status              # what is applied
npm run db:migrate             # apply pending migrations
npm run db:rollback            # roll back the last migration
npm run db:rollback -- --allow-data-loss   # required for destructive rollbacks
```

Rules followed by every migration:

- never drop a table that already holds data,
- never edit an applied migration (the ledger stores a checksum and warns you),
- every table has a matching `db/migrations/down/*.sql` rollback script.

## API surface (Phase 1)

Public:

```
GET  /api/businesses
GET  /api/businesses/:businessId
GET  /api/businesses/:businessId/locations
GET  /api/products            GET /api/services        GET /api/reviews
```

Authenticated:

```
POST /api/auth/register       POST /api/auth/login      GET /api/auth/me
POST /api/businesses/register
POST /api/orders              GET  /api/orders/mine     POST /api/orders/mine/:id/cancel
POST /api/reviews
```

Business staff (membership + permission checked by the database):

```
GET|POST|PATCH|DELETE /api/business/:businessId/products[/:productId]
GET|POST|PATCH        /api/business/:businessId/services[/:serviceId]
GET|POST|PATCH        /api/business/:businessId/locations[/:locationId]
GET                   /api/business/:businessId/orders[/:orderId]
PATCH                 /api/business/:businessId/orders/:orderId/status
GET                   /api/business/:businessId/reviews
POST                  /api/business/:businessId/reviews/:reviewId/respond
PATCH                 /api/business/:businessId/reviews/:reviewId/moderate
PATCH                 /api/business/:businessId
GET                   /api/business/:businessId/statistics
GET|POST              /api/business/:businessId/members
```

The business context comes from the path or the `X-Business-Id` header. It is
verified against `business_users` in the database before any query runs, and RLS
rejects it a second time.

## Project layout

```
db/migrations/          forward migrations
db/migrations/down/     rollback scripts
db/seed/                (reserved for platform-owned seed data)
src/db/                 pool, tenant context, migrator
src/middleware/         auth, business resolution, error handling
src/modules/            one folder per business capability
tests/                  acceptance tests
docs/                   schema, isolation and migration documentation
```
