# HQ Marketplace — Schema (Phase 1)

## 1. Current state of the database

This is a **greenfield** repository: there is no legacy database, no legacy table
and no legacy backend to migrate. `npm run db:setup` creates an empty database and
builds the multi-business schema from scratch, so nothing was renamed, dropped or
recreated, and no data was deleted (there was none).

The design below is therefore the *proposed* schema, which is also the current
schema after migration. When this schema is later applied to an existing
installation, §6 describes the order of work and the checks required first.

## 2. Design rules

1. **User ≠ Business.** `users` is platform-wide. Business linkage only exists in
   `business_users`.
2. **Business ≠ Product / Service.** Every catalogue row carries `business_id NOT NULL`.
3. **Every tenant table is a child of `businesses`.** No operational table may be
   created without `business_id`.
4. **A tenant id is never a hardcoded constant in code.** It is resolved per request
   and verified in the database.
5. **Statistics are derived, not duplicated.** `v_business_statistics` computes from
   source tables; `business_statistics` is a rebuildable cache.
6. **Prices are snapshots.** `order_items.unit_price` never changes after the order.

## 3. Tables

| Table | Purpose | Primary key | Foreign keys (ON DELETE) |
| --- | --- | --- | --- |
| `users` | People on the platform | `user_id` | — |
| `roles` | Scoped roles: `platform` or `business` | `role_id` | — |
| `permissions` | Flat permission keys | `permission_id` | — |
| `role_permissions` | Role → permission grants | `(role_id, permission_id)` | roles (CASCADE), permissions (CASCADE) |
| `user_platform_roles` | Platform-wide grants | `(user_id, role_id)` | users (CASCADE), roles (RESTRICT) |
| `business_categories` | Business category catalog | `category_id` | — |
| `businesses` | Tenant root | `business_id` | business_categories (RESTRICT), users for `verified_by` (SET NULL) |
| `business_users` | Membership: user ↔ business ↔ role | `business_user_id` | businesses (RESTRICT), users (RESTRICT), roles (RESTRICT) |
| `business_locations` | Branches | `location_id` | businesses (RESTRICT) |
| `product_categories` | Product catalog | `category_id` | — |
| `service_categories` | Service catalog | `category_id` | — |
| `products` | Products of a business | `product_id` | businesses (RESTRICT), product_categories (RESTRICT) |
| `services` | Services of a business | `service_id` | businesses (RESTRICT), service_categories (RESTRICT), business_locations (SET NULL) |
| `orders` | Orders, one per business | `order_id` | businesses (RESTRICT), users (RESTRICT), business_locations (SET NULL) |
| `order_items` | Line items with price snapshots | `order_item_id` | orders (CASCADE), businesses (RESTRICT), products/services (RESTRICT) |
| `reviews` | Business reviews | `review_id` | businesses (RESTRICT), users (RESTRICT), orders (SET NULL) |
| `business_statistics` | Rebuildable aggregate cache | `business_id` | businesses (CASCADE) |

`ON DELETE` was chosen per relationship, not blanket:

- **RESTRICT** on anything with historical or financial value (businesses, products,
  services, orders, reviews, users). A business is retired with `status = 'closed'`
  and `deleted_at`, never deleted.
- **CASCADE** only on pure junction rows that carry no data of their own
  (`role_permissions`, `order_items`).
- **SET NULL** for optional references (`verified_by`, `invited_by`, `location_id`,
  a review's order).
- `products` referenced by an order item cannot be deleted at all; products are
  archived (`deleted_at`) instead.

## 4. Important columns

**businesses** — `business_id` (identity PK), `business_name`, `business_slug`
(unique), `business_description`, `business_category_id`, contact/location columns,
`status` (`pending|active|suspended|closed|rejected`), `verification_status`
(`pending|verified|rejected`), `is_verified`, `verified_at`, `verified_by`,
`deleted_at`.

`business_name` is **not** unique: several pharmacies may share a name. `business_slug`
is the unique public handle. A check constraint keeps `is_verified` consistent with
`verification_status` and `verified_at`.

**business_users** — `business_user_id`, `business_id`, `user_id`, `role_id`, `status`,
`joined_at`, `invited_by`, `created_at`. `UNIQUE (business_id, user_id, role_id)`
prevents duplicates while allowing several distinct roles in one business, and a
partial unique index allows at most one active owner per business.

**products** — `product_id`, `business_id`, `category_id`, `product_name`, `description`,
`price`, `discount_price`, `currency`, `sku`, `image_url`, `stock_quantity`,
`is_stock_tracked`, `status`, `rating_avg`, `rating_count`, timestamps, `deleted_at`.
`UNIQUE (business_id, sku)` — a SKU is unique per business, not platform-wide.

**services** — `service_id`, `business_id`, `service_category_id`, `location_id`,
`service_name`, `description`, `price`, `currency`, `duration_minutes`, `capacity`,
`is_bookable`, `status`, timestamps, `deleted_at`.

**orders** — `order_id`, `order_number`, `business_id`, `customer_id`, `location_id`,
`order_type`, `order_status`, `subtotal`, `delivery_fee`, `discount_amount`,
`tax_amount`, `total_amount`, `currency`, notes, `scheduled_for`, lifecycle timestamps.
A check constraint enforces `total_amount = subtotal + delivery_fee + tax - discount`.

**order_items** — `order_item_id`, `order_id`, `business_id`, `product_id`, `service_id`,
`item_type`, `item_name`, `quantity`, `unit_price`, `total_price`, `notes`. Exactly one
of `product_id` / `service_id` is set, matching `item_type`.

**reviews** — `review_id`, `business_id`, `user_id`, `order_id`, `rating` (1–5),
`review_text`, `business_response`, `responded_at`, `status`. `UNIQUE (business_id, user_id)`
= one review per user per business.

## 5. Relationship diagram

```text
users
  │
  ├── user_platform_roles ──► roles ──► role_permissions ──► permissions
  │                             (scope = platform)
  │
  └── business_users ──► roles (scope = business)
            │
            ▼
      businesses ──────────► business_categories
            │
            ├── business_locations          (branches)
            ├── products ──────────────────► product_categories
            ├── services ──────────────────► service_categories
            ├── orders ◄── customers (users)
            │     └── order_items ──► products | services
            ├── reviews ◄── users
            └── business_statistics        (cache of v_business_statistics)
```

Cross-tenant integrity is enforced by composite foreign keys:

```text
order_items (product_id, business_id) ──► products (product_id, business_id)
order_items (service_id, business_id) ──► services (service_id, business_id)
orders     (location_id, business_id) ──► business_locations (location_id, business_id)
services   (location_id, business_id) ──► business_locations (location_id, business_id)
reviews    (order_id,    business_id) ──► orders (order_id, business_id)
```

An order of Business A can therefore never contain a product or branch of Business B,
even if application code is wrong.

## 6. Indexes

Indexes follow the query patterns, not a guess list:

- every foreign key used in a `WHERE`/`JOIN`: `business_id`, `user_id`, `category_id`;
- every `ORDER BY created_at DESC` list: composite `(business_id, status, created_at DESC)`;
- public catalogue: partial indexes `WHERE status = 'active' AND deleted_at IS NULL`;
- lookup paths: `lower(business_name)`, `lower(product_name)`, `(city, district)`;
- integrity: partial unique indexes for the single owner and the primary branch.

Composite indexes always lead with `business_id`, so a tenant query stays inside one
business's slice of the index.

## 7. Extending the schema

- New business category → `INSERT INTO business_categories` (no migration).
- New product or service category → same, in the matching catalog table.
- New permission → `INSERT INTO permissions` + grant it to roles.
- New business capability → new table with `business_id NOT NULL REFERENCES businesses`,
  a down script, RLS policies, and a migration checksum the runner tracks.
