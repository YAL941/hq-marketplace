# OmniHQ Development Progress

## Completed
- Phase 0: Deployment fixes (upload limits, password reset await, ComingSoon) — 361 tests
- Phase 1: Customer orders + checkout (COD only) — 361 tests  
- Phase 2: Payment system (provider abstraction, migration 036, webhooks, commission 5%) — 362 tests
- Phase 3: Notifications (SMS/WhatsApp mock, 3 triggers, migration 037+038) — 366 tests
- Extra: Map display on business profile + branch location picker (Leaflet/OSM)

## In Progress
- Phase 4: Discovery and contact (opening hours timezone, is_open_now on server, nearby map UI)

## Pending
- Phase 5: Monetization (subscription plans, featured listings)
- Phase 6: Admin improvements, rate limiting, CI

## Test count history
| After phase | Tests |
|---|---|
| Phase 0 | 361 |
| Phase 1 | 361 |
| Phase 2 | 362 |
| Phase 3 | 366 |

## Key decisions
- Commission: 5% on subtotal only (excluding delivery)
- merchant_amount = subtotal - commission (delivery goes fully to merchant)
- COD stays pending until real webhook provider added
- is_open_now calculated server-side (Africa/Mogadishu)
- No Google Maps API — Leaflet + OpenStreetMap only
- payment_status separate from order_status

## Local PostgreSQL test setup
- After every PostgreSQL restart, re-run `db:grants` against `hq_marketplace_test` before running `npm test`.
- In PowerShell: `$env:PGDATABASE = 'hq_marketplace_test'; npm run db:grants`
