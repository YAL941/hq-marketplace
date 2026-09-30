# HQ Marketplace — Migration Safety (Phase 1)

## Principles

1. **Nothing is dropped.** No migration in this phase drops an existing table, renames
   a column, or rewrites data.
2. **Additive only.** New tables, new columns (`NULL`-able or with a default), new
   indexes, new policies. Every change is backwards compatible with the previous
   version of the code.
3. **One migration, one transaction.** A migration that fails halfway leaves the
   database exactly as it was.
4. **Applied migrations are immutable.** `schema_migrations` stores a checksum; the
   runner warns if an applied file was edited. Corrections go into a new migration.
5. **Every migration has a rollback script** in `db/migrations/down/`.
6. **Destructive rollbacks are opt-in.** `npm run db:rollback` refuses to drop
   anything without `--allow-data-loss`.

## Running a migration

```bash
npm run db:status     # what has been applied
npm run db:migrate    # apply everything pending
npm run db:rollback   # undo the last migration
```

`db:migrate` is safe to run repeatedly: applied versions are skipped, and
transactions mean a failed migration changes nothing.

## Data-preserving upgrade order for an existing installation

When this schema is applied to a database that already has users, products or orders,
the order is fixed and each step is verified before the next one starts.

```text
1.  Backup           pg_dump -Fc before anything else
2.  Analyze          list current tables, PKs, FKs, indexes, row counts
3.  Migration 001    create users/roles/permissions; copy existing users
                     (map legacy role column -> user_platform_roles)
4.  Verify           row counts match; login still works
5.  Migration 002    create businesses; backfill a business for existing data
                     (one row per legacy tenant, or one "legacy" business)
6.  Migration 003    create products/services/orders/order_items/reviews;
                     backfill business_id on every row from step 5
7.  Migration 004    seed roles/permissions/categories, enable RLS
8.  Verify           run the isolation tests against a copy of production data
9.  Deploy           application code, then switch traffic
```

Rules for the backfill step:

- `business_id` is added as `NULL` first, filled, then set to `NOT NULL` in a
  follow-up migration once the verification query returns zero NULLs.
- A row that cannot be attributed to a business is **not** guessed: it goes into a
  clearly named "legacy/unassigned" business so it stays visible and auditable.
- If the legacy data cannot be represented without contradicting a new constraint
  (for example orders with no customer), the migration stops and reports it instead
  of deleting rows.

## Verification after a migration

```sql
-- every tenant table has a business id
SELECT table_name FROM information_schema.columns
WHERE table_name IN ('products','services','orders','order_items','reviews','business_locations')
  AND column_name = 'business_id'
  AND is_nullable = 'NO';

-- no cross-business references exist
SELECT COUNT(*) FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
WHERE oi.business_id <> o.business_id;

SELECT COUNT(*) FROM order_items oi
JOIN products p ON p.product_id = oi.product_id
WHERE oi.business_id <> p.business_id;

SELECT COUNT(*) FROM reviews r
JOIN orders o ON o.order_id = r.order_id
WHERE r.business_id <> o.business_id;

-- RLS is actually enabled
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('businesses','products','services','orders','order_items','reviews')
  AND NOT relrowsecurity;
```

Every one of these queries returns zero rows or `false` after migration 004.

## Rollback strategy

| Situation | Action |
| --- | --- |
| A migration failed | nothing to do, the transaction rolled back; fix the file and re-run `db:migrate` |
| A policy is wrong | `npm run db:rollback` (migration 004, non-destructive) |
| The schema must be reverted to empty | `npm run db:rollback -- --allow-data-loss` on every migration, in reverse order, on a **copy** of the data |
| Production incident | restore the `pg_dump` taken in step 1; migrations are forward-only by design |

## Environments

- `hq_marketplace` — development.
- `hq_marketplace_test` — the acceptance tests, truncated and rebuilt on every run.
- Production runs `db:migrate` as a deploy step, with the application role (`hq_app`)
  kept separate from the migration role.

## Backup before any change

```bash
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -Fc -h localhost -U postgres -d hq_marketplace -f hq_marketplace.backup
```
