# Email notification operations

## Recipient policy

New-order email targets the one active `business_owner` membership. Migration 004
enforces at most one active owner per business; that membership is the primary
owner for this policy. The recipient must still be an active account with a
verified email. A missing or ineligible owner results in no outbox row, and the
business contact email is never used as a fallback.

## Restricted operator endpoints

These routes require an authenticated `platform_admin` account:

- `GET /api/admin/notifications/health` returns aggregate counts and readiness.
- `GET /api/admin/notifications/dead-letters/:outboxId` returns sanitized
  metadata only and records an inspection audit entry.
- `POST /api/admin/notifications/dead-letters/:outboxId/review` accepts one of
  `provider_corrected`, `recipient_corrected`, `manual_review`, or
  `false_positive` as `reason_code`.
- `POST /api/admin/notifications/dead-letters/:outboxId/retry` requires a
  reviewed dead letter and the same bounded reason codes. It reuses the same
  outbox row and dedupe key, resets attempts, and records actor, time, and reason.
- `POST /api/admin/notifications/retention/prune` accepts an optional batch
  `limit` from 1 to 500 and returns an aggregate deletion count.

The admin routes use the normal `hq_app` connection and tenant context. Database
functions repeat the platform-admin check. The worker role cannot execute these
functions, and neither application users nor the worker receive direct access
to the private outbox tables. Operator reason codes intentionally exclude free
text so a secret or personal detail cannot accidentally enter the audit log.
Health-summary views, dead-letter inspection, review, retry, and retention
deletion are recorded with the operator account and timestamp; retry/review and
retention additionally record a bounded reason category or aggregate count.

## Retention and deduplication

Retention is operator-triggered and each call is bounded to at most 500 rows:

- `sent`: after 90 days from `sent_at`.
- `dead`: after 180 days from explicit operator review.
- `skipped`: after 180 days from its terminal update.

`pending` and `processing` records are never candidates; active leases are
excluded. The cleanup uses `SKIP LOCKED` and dedupe advisory locks so it does not
take locks needed for enqueue/claim work. Before a terminal row is removed, its
dedupe key is stored as a private SHA-256 tombstone. Tombstones are retained
indefinitely so replayed business events cannot create a second notification.
This is small, non-message metadata and has no automatic purge yet.

## Health and alerting

The admin health summary reports queue counts, oldest pending age, expired
leases, sanitized failure-code counts, worker heartbeat age, worker liveness,
SMTP configuration state, last SMTP result, and delivery readiness. It does not
return recipient addresses or message content. Database readiness means this
API query succeeded. SMTP configuration is reported separately from delivery:
delivery remains `unverified` until a send succeeds and becomes `failed` after a
new SMTP error; the latest successful send clears that failure state. No SMTP
connection probe is performed. Connection, timeout, authentication, and
permanent-rejection failures use distinct sanitized codes.

Suggested initial alerts: worker heartbeat older than 90 seconds; SMTP not
configured for 2 minutes; any new dead letter or SMTP authentication failure;
SMTP connection/timeout failures sustained for 5 minutes; oldest pending over
15 minutes (warning) or 60 minutes (high); expired leases above zero; and a
sustained increase in pending count. Tune thresholds against observed traffic.

The Docker worker health check requires a current process heartbeat and a
recent successful database readiness check. It deliberately does not depend on
SMTP configuration or a previous successful send, so a new worker and an empty
queue can be healthy while delivery remains `unverified`. SMTP configuration
and delivery verification are reported separately through the health summary
and worker logs. A transient SMTP error affects that delivery and retry policy,
not process health, while the worker remains connected to the database.
Database unavailability fails worker readiness; process liveness remains a
separate heartbeat. The worker removes both markers during graceful shutdown,
and the health check also rejects stale markers.
Docker restart policies do not restart an unhealthy container while its process
continues running; alert and investigate that state separately.

## SMTP classification

Nodemailer `EAUTH` is classified as `smtp_authentication_failed` and is not
retried. Network connection failures and timeouts are retryable. Generic 5xx
SMTP responses remain `smtp_permanent_rejection`; they are not assumed to be
authentication failures. Error responses are reduced to these codes before
logging or persisting.

## Worker login provisioning — operator procedure

Status: **NOT VERIFIED on Neon**. The repository intentionally does not create
the runtime login or a password during application startup.

Migration 062 creates only the `hq_notification_worker` NOLOGIN group role.
Migration 064 grants that group access to the restricted `notification_api`
schema and wrappers. Migration 065 adds the worker heartbeat and delivery-state
functions. The worker login must therefore be a separate LOGIN role and be
granted membership in `hq_notification_worker`; it must not inherit any
administrator, application, migration, or notification-definer role.

Operator-only provisioning sequence:

1. Use the provider's secret manager and least-privilege administrator identity.
2. Generate a unique worker database password outside shell history and source
   control.
3. Create the LOGIN role with the provider's interactive SQL/editor mechanism
   or a provider CLI that does not persist the password in terminal history.
   Disable login on the group role and preserve `NOINHERIT`,
   `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`,
   `NOBYPASSRLS`, and `NOINHERIT`.
4. Grant exactly `hq_notification_worker` membership to the LOGIN role. Do not
   grant `hq_notification_definer`, `hq_app`, or any migration/admin role.
5. Store the password only in the worker deployment secret source. Rotate it
   only by changing that role's password through an authenticated operator
   path, then updating the secret atomically, restarting the worker, and
   verifying it reaches database-ready state.
6. Verify effective privileges from the migration/admin connection:
   login/role flags, exact group membership, notification API function
   execution, absence of private/public/direct table privileges, absence of
   extra schema usage, and absence of extra role memberships.
7. To revoke incident access: revoke the login membership, then rotate or
   lock/disable the login according to provider-supported controls. Confirm
   the worker cannot authenticate or execute notification API functions
   before restoring service.

Do not place the worker password in `.sql`, Docker environment values, Git,
logs, migration files, or command-line arguments. The runtime startup guard
only verifies an already-provisioned role; it cannot safely provision Neon
role objects itself.

The exact Neon login creation, role membership, password rotation, and pooled
`SET LOCAL ROLE` behavior remain NOT VERIFIED without an isolated Neon branch.

## Compose and secret provisioning

The supported deployment baseline is Docker Compose v2.32.0 or newer. Run
`npm run compose:validate` before rendering or starting a deployment. It checks
the Compose version, distinct database identities, strong database credentials,
secret files, and SMTP TLS mode without printing secret values. The staging and
production `docker-compose.yml` expects an externally managed PostgreSQL host;
the local-only PostgreSQL service is in `docker-compose.local.yml` and binds to
127.0.0.1. It uses a separate named volume.

Both runtime pools and the trusted migration pool use `PG_TLS_MODE`. Production
requires `verify-full`, which enables certificate-chain and server-name
validation and never falls back to plaintext. Local PostgreSQL can explicitly
use `disable`. For a provider with a private CA, mount its PEM bundle read-only
into each process that needs it and set `PG_SSL_CA_FILE` to that absolute
in-container path; do not pass certificate contents through environment values.

Compose secrets in these files use the `file` source and are mounted under
`/run/secrets`. Provision files from the staging secret manager before running
Compose; set the corresponding `*_SECRET_FILE` paths in the deployment
environment. On a local developer machine, place generated test-only files in
`.secrets/`, which is ignored by Git. Restrict host file access to the deploy
operator and service account. Do not put secret contents in Compose YAML,
Docker build arguments, Git, shell command lines, or logs.

File-backed Compose secrets are a delivery mechanism, not an external secrets
manager. They do not provide centralized rotation, access review, or audit on
their own. The deployment platform must control the source files and refresh
them during rotation. The API mounts only its application database credential
and SMTP credentials required by the existing authentication mailer. The worker
mounts its dedicated database credential and SMTP credentials. Administrative
PostgreSQL credentials are not mounted into either runtime service; migration
operators supply them in a separate trusted context.

The Compose preflight requires migration role credentials, the API and worker
secret files, and (when SMTP_HOST is configured) both SMTP credential files and
an explicit TLS mode. The API authentication mailer and notification worker
both reject an active SMTP host without an explicit matching TLS mode.
`SMTP_TLS_MODE=starttls` requires `SMTP_SECURE=false` and sets Nodemailer's
`requireTLS`; absence of STARTTLS fails the connection.
`SMTP_TLS_MODE=implicit` requires `SMTP_SECURE=true` and establishes TLS from
connect. Certificate validation remains enabled. A provider-specific nonstandard
port may be used only when the provider confirms the matching transport mode.

## Safe deployment recovery

Before a staging release, take a PostgreSQL backup using the approved secret
manager and database backup tooling. Verify that the backup can be restored to a
separate isolated database. Preserve `notification_private.notification_outbox`,
`notification_private.notification_admin_audit`,
`notification_private.notification_outbox_dedupe_tombstones`, and
`notification_private.notification_worker_state`. The dedupe tombstones prevent
an old business event from being enqueued again after retention removes its
terminal outbox row.

For a normal code rollback, stop only the email-worker service with a graceful
SIGTERM (for Compose, `docker compose --profile email-worker stop -t 900
email-worker`). The worker waits for its active bounded cycle, closes its
database pool, and removes its liveness markers. If it is force-stopped, active
leases remain recoverable after lease expiry; do not clear or edit them by hand.
Roll back the application image while keeping the database schema and outbox
data. Restart a worker build compatible with the currently applied schema, then
confirm fresh heartbeat, database readiness, and queue progress before retrying
dead letters.

Do not use Down migrations as a deployment rollback. In particular, Down 065
removes notification audit history and dedupe tombstones, and Down 062 drops the
outbox schema and its queued records. A database-level recovery requires an
approved maintenance window, a verified backup, and a restore into an isolated
target first; compare row counts and dedupe tombstone coverage before any traffic
is routed to the restored database. Prefer forward corrective migrations over
destructive rollback.

SMTP is at-least-once: if SMTP accepts a message but PostgreSQL cannot record the
acknowledgment, the lease will expire and the same notification may be sent
again. Review provider acceptance logs and the outbox status before any manual
retry. Do not promise exactly-once delivery to users or operators.

## Alert configuration status

The application exposes health signals but this repository does not configure
an alert delivery system. Treat the following as required staging alerts, not as
active alerts until the deployment's monitoring channel has been configured and
an alert test has been observed:

- Worker unhealthy or heartbeat older than 90 seconds: page the on-call operator.
- Database readiness failure for 2 consecutive checks: page the on-call operator.
- Any SMTP authentication failure or TLS negotiation failure: page the mail
  service owner and pause controlled sends until credentials/policy are checked.
- SMTP connection failures sustained for 5 minutes: warn and inspect network or
  provider availability.
- Pending queue oldest age over 15 minutes: warning; over 60 minutes: high
  priority. Alert on a sustained rising pending count even before those ages.
- Any dead-letter record: alert for operator review; repeated retry attempts
  above 3 per message: warn before the configured maximum is reached.
- Any expired lease: warn; a continuing increase indicates a stalled worker or
  database acknowledgments.

The existing admin health endpoint and aggregate logs supply these signals, but
they do not deliver alerts. Configure a monitor to poll the health endpoint or
consume the sanitized logs, then test each alert using staging-only synthetic
conditions before enabling real recipient notifications.
