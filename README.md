# OmniHQ — Phase 1

Marketplace directory and multi-business data isolation, with a customer-facing
web frontend and a business-owner dashboard.

## What is implemented

- Multi-tenant schema where every business-scoped row carries `business_id NOT NULL`.
- `businesses` as the tenant root, with slug uniqueness, status and a verification workflow.
- Platform identity (`users`, `roles`, `permissions`) with **scoped** roles, so
  `platform_admin` and `business_owner` are never the same kind of authority.
- `business_users` membership table: one user can belong to many businesses with different roles.
- Catalogue (`products`, `services`), branches (`business_locations`), commerce
  (`orders`, `order_items`), `reviews`, and a derived statistics layer.
- Public directory pages for search, category browsing, and account-synced
  business favorites.
- **Data isolation enforced in PostgreSQL** through Row Level Security, in addition to
  `WHERE business_id = ...` in every repository query.
- Migration runner with per-migration rollback scripts and a schema-change ledger.
- **Nearby search**: public, location-aware directory listing ordered by
  distance from the caller, with radius and optional filters.

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
| 4 | `db:seed` | categories and local admin; fictional listings are opt-in |

Step 3 matters: the API must connect as `hq_app`, not as the table owner. Only a
non-owner role is subject to RLS.

The directory seed does not create fictional businesses by default, so public
business counts start at zero until businesses are actually listed and
verified. To populate a local demo directory, run:

```bash
SEED_DEMO_BUSINESSES=true npm run db:seed
```

In PowerShell, run `$env:SEED_DEMO_BUSINESSES='true'; npm.cmd run db:seed`.
Never enable demo listings in production.

To add the explicitly labelled Nertu Fashion demo shop, its sample outfit
photo, and nine demo orders covering every order status, run this only against
a local development database:

```bash
NERTU_DEMO_PASSWORD='choose-a-password-at-least-12-characters' \
  npm run db:seed:demo -- /path/to/product-image.jpg
```

The demo owner signs in as `nertu.owner@example.test`; the sample customer
signs in as `nertu.customer@example.test`. Both use the password supplied in
`NERTU_DEMO_PASSWORD`. The product price is a demo placeholder, not a real
quote. Do not run this seed in production.

## Tests

```bash
npm test
```

The suite creates its own fixtures in `hq_marketplace_test` and covers the eight
required scenarios: product ownership, cross-business denial (API **and** raw SQL
with no `WHERE` clause), owner isolation, public directory visibility, order
creation with frozen prices, review isolation, multiple branches, and duplicate
business names. The nearby search adds a ninth group: distance ordering, radius
filtering, multi-branch deduplication at the closest branch, public visibility
of the result set, and input validation.

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
GET  /api/businesses/nearby
GET  /api/businesses/:businessId
GET  /api/businesses/:businessId/locations
GET  /api/products            GET /api/services        GET /api/reviews
```

### Nearby search

`GET /api/businesses/nearby?lat&lng&radiusKm[&city&categoryId&q&page&limit]`

Returns public businesses ordered by distance from `(lat, lng)`, one row per
business, `distance_km` in the row and the origin echoed in `meta`. The
distance of a multi-branch business is the distance of its closest active
branch, never an average.

| parameter | range | default | notes |
| --- | --- | --- | --- |
| `lat` | -90..90 | required | caller latitude |
| `lng` | -180..180 | required | caller longitude |
| `radiusKm` | 0.1..100 | 5 | inclusive maximum distance |
| `city` | 1..120 chars | — | case-insensitive exact match on the branch city |
| `categoryId` | positive int | — | same category filter as the directory |
| `q` | 1..80 chars | — | same name search semantics as the directory |
| `page`, `limit` | 1..10000 / 1..50 | 1 / 20 | same caps as every public list |

Implementation notes:

- Coordinates are the `DOUBLE PRECISION` columns that already exist on
  `business_locations`; no PostGIS, no geohash, no second source of truth for
  a branch's position. Migration `013` adds the indexes that make the query
  cheap: a bounding-box index and a join helper, both partial over active
  branches with coordinates.
- The bounding box is a prefilter only: the exact law-of-cosines distance is
  what excludes a branch near a corner of the box.
- Visibility is the same promise as the rest of the directory:
  `app_business_is_public` in the `WHERE`, and row level security answering
  again underneath. A pending business with a perfectly placed branch is
  invisible.
- The route is mounted before the directory router, so `/businesses/nearby`
  is not captured as a `:businessId`.

Authenticated:

```
POST /api/auth/register       POST /api/auth/login      GET /api/auth/me
POST /api/businesses/register
POST /api/orders              GET  /api/orders/mine     POST /api/orders/mine/:id/cancel
POST /api/reviews
GET  /api/favorites           PUT|DELETE /api/favorites/:businessId
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
GET                   /api/business/:businessId
PUT|DELETE            /api/business/:businessId/logo
PUT|DELETE            /api/business/:businessId/cover
PUT|DELETE            /api/business/:businessId/products/:productId/image
```

The business context comes from the path or the `X-Business-Id` header. It is
verified against `business_users` in the database before any query runs, and RLS
rejects it a second time.

`GET /api/business/:businessId` is the staff read: unlike
`GET /api/businesses/:businessId` it has no visibility predicate, so it returns a
`pending` or `rejected` business to its own members, including
`status`, `verification_status`, `rejection_reason` and `verified_at`. The
public read stays 404 for those, which is the point of the split.

Platform admin (`platform_admin` role only; anyone else gets 403):

```
GET   /api/admin/businesses?status=pending|active|rejected&page&limit
PATCH /api/admin/businesses/:businessId/verification
```

The verification decision body is `{ "decision": "approve" | "reject", "reason"?: string, "force"?: boolean }`.
A rejection needs a reason of at least 5 characters. Approving sets `status`
`active`, `verification_status` `verified`, `is_verified` true, `verified_at` to
now and `verified_by` to the admin, and clears `rejection_reason`; rejecting sets
`status` `rejected` and stores the reason. Deciding the same thing twice is a 409
unless `force: true` says it was meant.

## Image uploads

A business logo, a business cover and a product image. There is no schema
change: `businesses.logo_url`, `businesses.cover_image_url` and
`products.image_url` already existed and are still plain `TEXT`.

```
PUT    /api/business/:businessId/logo
DELETE /api/business/:businessId/logo
PUT    /api/business/:businessId/cover
DELETE /api/business/:businessId/cover
PUT    /api/business/:businessId/products/:productId/image
DELETE /api/business/:businessId/products/:productId/image
```

`PUT` takes `multipart/form-data` with exactly one file in a field named
`file`, and answers with the updated row, the same shape the matching `PATCH`
returns. `DELETE` answers `204` and clears the column. Both require
`Authorization: Bearer <token>`, business membership, and the permission the
equivalent edit route already checks — `business.edit` for the logo and the
cover, `products.edit` for a product image — and are rate limited with the same
`write` profile (30/minute) as orders and reviews.

### Limits and accepted formats

| | limit | stored width |
| --- | --- | --- |
| logo | 2 MB | 512 px |
| cover | 5 MB | 1600 px |
| product image | 5 MB | 1200 px |

Only **JPEG, PNG and WebP**, decided from the first bytes of the file and not
from its name, its extension or its declared content type. SVG is refused
outright. Anything over the ceiling, over 40 megapixels, animated or multi-page,
empty, or not one of the three formats is a `400` whose body carries
`details.field = "file"`.

Everything that is accepted is rewritten before it is stored: EXIF orientation
is applied and the orientation tag removed, all other metadata is dropped (sharp
only keeps it when `.withMetadata()` is called, which this pipeline never
does), the image is resized to the ceiling above without being enlarged, and the
result is WebP. Nothing is cropped.

### Stored URLs

A stored value is a path, never a filesystem location and never an absolute
URL:

```
/uploads/<businessId>/logo/<32 hex>.webp
/uploads/<businessId>/cover/<32 hex>.webp
/uploads/<businessId>/products/<productId>/<32 hex>.webp
```

The 32 hex characters are 16 bytes from the CSPRNG, so a name cannot be guessed
and the original file name never reaches a URL. `PATCH /api/business/:businessId`
and the product create/update bodies accept either such a path **under that
business's own folder**, or an external `http`/`https` URL — anything else, and
in particular a path under another business's folder, is a `400`.

Replacing an image writes the new file first, updates the row in a transaction,
and deletes the previous file only after that transaction commits. If any step
fails the new file is removed and the row and the old file are left exactly as
they were.

`GET /uploads/<key>` serves the file as `image/webp` with a one year
`immutable` cache (safe because a stored name is never reused) and
`Cross-Origin-Resource-Policy: cross-origin`. Dotfiles are denied, a directory
listing is not produced, and a missing key answers with the same `404` JSON body
as any other missing route.

### Storage: local now, S3 or R2 later

`StorageProvider` (`src/modules/media/storage/`) is the only thing that knows
where bytes live; routes never build a path themselves. `STORAGE_DRIVER=local`
writes to `UPLOAD_DIR` and is the default, so a fresh clone serves uploads
without editing `.env`. Adding a driver means a new class in that folder and a
new value in the enum in `src/config.ts` — no route, no schema and no stored
row changes.

Local disk is a development answer, and it has two consequences worth stating
before production:

* **A container filesystem is ephemeral.** The directory has to be a mounted
  volume, or uploaded images disappear on every deploy. This is the reason R2 or
  S3 is the expected production answer rather than a preference.
* **Several instances will not see each other's files.** One instance would
  write an image another instance cannot serve, because the load balancer may
  send the following `GET /uploads/...` to a different process.

Because a row stores `/uploads/...` and never a host, moving to a bucket means
new rows carry an absolute CDN URL and old rows keep working through whatever
resolves the `/uploads/` prefix. Nothing has to be rewritten at migration time.

### Environment

| variable | default | meaning |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | which `StorageProvider` stores images |
| `UPLOAD_DIR` | `uploads` | root folder for stored images; relative paths resolve against the working directory, and the folder is git-ignored |
| `UPLOAD_MAX_LOGO_BYTES` | `2097152` | logo ceiling |
| `UPLOAD_MAX_COVER_BYTES` | `5242880` | cover ceiling |
| `UPLOAD_MAX_PRODUCT_BYTES` | `5242880` | product image ceiling |
| `UPLOAD_MAX_PIXELS` | `40000000` | decompression-bomb guard |

All six are documented in [`.env.example`](.env.example) and all six have
defaults, so the server boots and serves uploads without `.env` being edited.

## Project layout

```
db/migrations/          forward migrations
db/migrations/down/     rollback scripts
db/seed/                (reserved for platform-owned seed data)
src/db/                 pool, tenant context, migrator
src/middleware/         auth, business resolution, error handling
src/modules/            one folder per business capability
src/modules/media/      upload routes, validation, image pipeline, storage
tests/                  acceptance tests
docs/                   schema, isolation and migration documentation
```
