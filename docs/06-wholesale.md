# HQ Wholesale

The business dashboard uses the existing wholesale business API for offers,
RFQs, purchase orders, receipts, and the wholesale event log. The server resolves
the business from the route, verifies membership and wholesale permissions, and
scopes each operation to the buyer or supplier business. A dashboard response
also reports wholesale-management and inventory-management capabilities so the
UI can hide actions the signed-in role cannot perform; the API remains the
authority.

The activity list is backed by `wholesale_events`. It is an audit/activity feed,
not a notification delivery system. Wholesale also persists in-app notification
rows for new supplier purchase orders, buyer-facing order transitions, RFQ
creation, quotations, quote decisions, and buyer receipt confirmations.
Recipients are selected server-side from active members of the event's buyer or
supplier business who hold `wholesale.view`; callers cannot provide recipient
IDs. Notifications include event type, target, creation time, and read state.
Their links are internal dashboard links with a fragment for the corresponding
RFQ or purchase order.

Platform approval notifications are stored separately from Wholesale activity
events, but appear in the same dashboard notification center. The approval
decision and its notification for each active business owner are committed in
one transaction. The recipient-scoped API checks membership on every list and
mark-as-read request, while row-level security limits reads and updates to the
current business and recipient. Notifications persist across browser sessions,
include the approved business page link, support unread/read state, and are
paginated with a load-more action. Rolling back migration 054 drops these
notifications and their read state; see the migration-safety guide before
considering that destructive rollback.

Each notification is inserted synchronously in the same database transaction as
its Wholesale audit/business event. A notification persistence failure aborts
the business transaction rather than silently dropping the notification. The
database enforces both source-event uniqueness per recipient (migration 051)
and a stable recipient deduplication key (migration 052); identical quote retries use a fingerprint of quote
lines, expiry, and note, while changed quote contents remain a distinct update.
The inbox API enforces membership, `wholesale.view`, recipient-user scoping, and
current-business scoping, and supports pagination, unread counts, detail reads,
and idempotent mark-as-read. The dashboard refreshes the inbox after mutations,
when the tab regains focus, and every 30 seconds while visible. Periodic polling
refreshes only the inbox rather than reloading Wholesale data and receipt
history.

This is synchronous in-app persistence, not an asynchronous outbox or external
delivery pipeline. There is no WebSocket synchronization, email, or push
notification channel; another device sees changes on its next refresh/poll.
The deduplication key treats an identical quote payload for the same RFQ as a
retry, so intentionally re-sending the exact same quote content does not create
a second notification. Distinguishing that from an identical request retry
would require an explicit client operation ID.

The Wholesale dashboard reloads its data when the tab regains focus and after
mutations. No mock Wholesale notifications are shown.

Purchase order creation and shipment do not add buyer inventory. The buyer
records receipt against a shipped order through the idempotent receipt API;
only that physical receipt creates inventory movements. A receipt attempt is
scoped by buyer business, purchase order, and stable attempt ID. The server
hashes a canonical representation of the buyer, order, receiving location,
note, and sorted receipt lines. Reusing an attempt ID with a different payload
is rejected.

The attempt ledger, receipt, receipt lines, inventory movements, order totals,
and saved response are coordinated in one database transaction. The server
locks the purchase order before reading or creating an attempt, and the ledger
has a composite unique key. Concurrent retries therefore serialize: the first
successful request stores a completed result, and all identical retries return
that result without incrementing stock again. A pending ledger row is created
inside that same transaction and is never committed on its own. Any failure
(including an inventory-update failure) rolls back the pending row and all
receipt/stock changes; clients may safely retry the same attempt ID and
payload. A successful commit always includes the completed result.

`GET .../purchase-orders/:orderId/receipt-attempts` returns authorized receipt
history, including each stable attempt ID and its recorded response. The
Wholesale dashboard consults this server history when local browser storage is
missing, so it can recover a completed response after a lost request response,
reload, browser closure, or storage clearing. A matching historical receipt is
offered as recovery; a separate explicit action starts a new attempt, allowing
a genuinely new physical receipt with identical quantities to receive a
different ID. The older receipt rows created before migration 049 remain
available through this history endpoint and retain their existing
purchase-order/idempotency-key uniqueness.

Attempt history is readable only to an authenticated business member with
Wholesale-management and inventory-management permission, and every request also
checks that the purchase order belongs to the authorized buyer. The
attempt-ledger RLS policy enforces buyer scoping independently of the route.
The design protects retries carrying the same attempt ID and lets an
authorized client recover that ID from server history. It cannot independently
prove that two separate attempt IDs refer to the same physical delivery; users
must use the recovery action when an earlier operation is uncertain rather than
choose the explicit new-receipt action.

## Migration recovery note

The test database was verified at migrations 001–050. Migration 039 is applied
but has no rollback script; `migrateDown` refuses it rather than guessing how to
remove subscription rows and `businesses.featured_until`. Do not create a
rollback that drops this data without product/data-owner approval. For an
incident, take a backup and prefer a forward corrective migration; test any
restore or rollback on an isolated database copy first. Wholesale migration
046's rollback drops wholesale tables and data, and 047's rollback drops buyer
mapping columns, so both are data-destructive and require explicit approval.
Migration 049's rollback drops only the receipt-attempt recovery ledger; receipt
and stock-movement business records remain, but server-side attempt-history
recovery is lost. It is marked destructive and requires `--allow-data-loss`.
Migration 050's rollback removes only the Wholesale-manager read policy and
does not remove receipt or inventory data.

Migration 051 adds persistent in-app Wholesale notification history and its
transactional event-to-recipient function. Its reviewed down migration drops
the notification function and notification table only; Wholesale events,
orders, RFQs, receipts, and inventory data remain. The rollback is destructive
because notification read state and history are lost, so the migration runner
requires `--allow-data-loss`. Migration 052 adds and backfills the recipient
deduplication key and hardens the writer to tolerate conflicts on either
uniqueness constraint. Its reviewed down migration preserves notification rows,
keys, and the deduplication constraint, and keeps conflict-tolerant inserts to
avoid turning retries into business-operation failures. Do not roll back
migration 051 merely to disable delivery; prefer a forward migration that
preserves notification history.
