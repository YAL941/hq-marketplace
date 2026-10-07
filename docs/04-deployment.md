# HQ Marketplace — Deployment (Phase 1)

How to run this API in production, and what will stop it from starting if you get
it wrong. Everything here is enforced by code rather than described for you to
remember, so this document mostly explains *why* a refusal happens and how to fix
it.

## The shape of a deployment

```text
                    ┌───────────────────────────────┐
   browser  ──────► │ reverse proxy                 │   TLS termination
                    │ Caddy / nginx / ALB           │
                    └──────────────┬────────────────┘
                                   │
                                   ▼
                    ┌───────────────────────────────┐
                    │ hq-marketplace API            │   node, PORT
                    │ trust proxy = TRUST_PROXY_HOPS│
                    └──────────────┬────────────────┘
                                   │
                                   ▼
                    ┌───────────────────────────────┐
                    │ PostgreSQL                    │
                    │ hq_app  (RLS filtered)        │
                    │ postgres (migrations only)    │
                    └───────────────────────────────┘
```

Two things about that diagram carry most of the risk, and both are enforced at
startup:

1. **The number of proxies matters**, and both wrong values fail silently.
2. **The API must not run as the table owner**, or row level security stops
   being consulted and every tenant can see every other tenant's rows.

## Before you deploy

```bash
npm ci
npm run db:migrate     # apply pending migrations, as the migration role
npm run db:grants      # create/refresh the application role and its privileges
npm run preflight      # everything that can be checked without starting the API
```

Then promote the first administrator — see "The first administrator" below. It
cannot be done by the seed, and the API has no endpoint for it.

`npm run preflight` is the step that catches a bad deployment on your machine
rather than on the box. It exits non-zero if anything is wrong, so it works as a
deploy gate:

```bash
NODE_ENV=production npm run preflight
```

It checks that the environment is valid, that both database connections work,
that the application role is one the policies actually apply to, that all
migrations are applied, that the upload directory is writable, and that the port
is free. It changes nothing, so it is also safe to run against a live server.

## Environment

Copy `.env.example` and fill it in. The production rules below are refusals, not
warnings: the process will not start.

| Variable | Production requirement | Why |
| --- | --- | --- |
| `JWT_SECRET` | at least 32 characters, not a placeholder | a forged token is the whole failure |
| `APP_DB_PASSWORD` | at least 16 characters, not a placeholder | the API's own credential |
| `PGPASSWORD` | at least 16 characters, not a placeholder | the schema owner's credential, which bypasses RLS |
| `APP_DB_USER` | must differ from `PGUSER` | see "Database roles" below |
| `CORS_ORIGIN` | at least one origin, all `https://`, no `*` | a wildcard with credentials is not a restriction |
| `UPLOAD_DIR` | absolute path | a relative path resolves against the service manager's working directory |
| `TRUST_PROXY_HOPS` | set explicitly | there is no safe default |
| `ORDERS_ENABLED` | defaults to `false` in production | order creation currently accepts adjustment amounts and currency from the client; enable only after those values are computed by server-side rules |

`ORDERS_ENABLED` defaults to `true` in development and test, and `false` in
production. When disabled, `POST /api/orders` returns the same 404 response as
an unknown route; existing order reads and business order management remain
available. Do not enable production order creation until delivery fees,
discounts, tax and currency are derived from trusted server-side rules.

Development and test keep their permissive defaults deliberately, so a fresh
clone runs without writing a secret into a file first.

### TRUST_PROXY_HOPS

The only value with no safe default, because both plausible mistakes are silent:

- **Too low** — every request through your proxy looks like it came from
  `127.0.0.1`. All visitors then share one rate-limit counter, and ten failed
  sign-ins from anyone locks out the whole site.
- **Too high** — `X-Forwarded-For` is trusted further back than the number of
  proxies that actually set it, so a caller can invent their own address and walk
  around every limiter.

Count the proxies between the internet and this process:

| Topology | Value |
| --- | --- |
| the API port is exposed directly | `0` |
| one Caddy/nginx in front | `1` |
| Cloudflare in front of Caddy/nginx | `2` |

It is a number rather than `true` on purpose: `true` trusts the header as far as
it goes, which is only safe while nothing but your own proxy can reach the port.

## Database roles

Two roles, deliberately different identities:

| Role | Used by | RLS |
| --- | --- | --- |
| `PGUSER` (`postgres`) | migrations and grants only | bypasses RLS, owns the tables |
| `APP_DB_USER` (`hq_app`) | every request the API serves | enforced by the policies |

`npm run db:grants` creates the application role and grants it only what the API
needs. Run it after every migration, since new tables need new grants.

If the API ever connects as the table owner, nothing fails visibly: requests
still return `200` and still return other businesses' rows. Two independent
checks guard against it — `APP_DB_USER` and `PGUSER` are compared at config load,
and `assertAppRoleIsSafe()` asks the database about the role at startup. The
second is the authoritative one, because it also catches an unsafe role nobody
wrote down, such as one holding `BYPASSRLS`.

See [02-data-isolation.md](./02-data-isolation.md) for what the policies actually
do.

## Uploads

`UPLOAD_DIR` must be its own volume in production, owned by the user the service
runs as, and referenced by an absolute path:

```ini
UPLOAD_DIR=/var/lib/hq-marketplace/uploads
```

The public URL of a stored file is always `/uploads/<businessId>/<slot>/<name>`.
The folder name never appears in a database row, so moving or remounting the
volume does not invalidate a single stored URL.

Stored files are served from the API's own origin, so they get a Content Security
Policy of their own: `default-src 'none'` plus an empty `sandbox`. An uploaded
SVG is a document a browser would otherwise execute on the API's origin. The
policy does not affect normal display — an `<img>` is not a document — and it
does not apply to a 404, where there are no user-supplied bytes to contain.

## Health checks

Three endpoints. All of them are unconditional — none are gated on the
environment — because removing an endpoint a monitor already polls is how an
existing uptime check starts reporting a false outage, and a monitor cannot be
reconfigured in the same minute as a deploy.

| Endpoint | Question | Depends on the database | Use for |
| --- | --- | --- | --- |
| `GET /health` | same as `/healthz`; kept for the deployment already using it | no | **uptime monitoring, Caddy health check** |
| `GET /healthz` | is this process able to serve HTTP? | no | orchestrator **liveness** probe |
| `GET /readyz` | can it actually serve requests? | yes, `503` when not | orchestrator **readiness** probe |

### Which one to use

- **Uptime monitoring (external, from outside the host): `GET /health`.** It is
  dependency-free, so a database outage does not make your monitor page you for
  an API that is still answering HTTP. It is also the endpoint older Caddyfiles
  and health checks already point at.
- **Caddy: `GET /health`**, for the same reason. Caddy sits in front of the
  process, so what it should ask is "is this process up", not "is the database
  reachable" — the latter belongs to the load balancer's readiness routing, and
  an unhealthy database should not take the proxy out of rotation.

  ```caddyfile
  example.com {
      reverse_proxy localhost:4000 {
          health_uri /health
          health_interval 30s
          health_timeout 5s
      }
  }
  ```

  With a health_uri set, Caddy only sends traffic to instances it considers up.
  Note that `/readyz` would also work there, but it makes the proxy drop a
  perfectly healthy process whenever the database blinks.
- **Orchestrator liveness probe: `GET /healthz`.** If the process is unable to
  serve HTTP at all, restart it.
- **Orchestrator readiness probe: `GET /readyz`.** If the process cannot reach
  the database, take it out of rotation but do not restart it.

Getting liveness and readiness the wrong way round is expensive. A liveness probe
that depends on the database makes a database outage restart every API process at
once, which discards warm connections and turns a recoverable dependency problem
into a fleet-wide crash loop.

Neither endpoint is rate limited — a probe runs every few seconds from every
instance and must not spend the same budget as a user. Neither reports the
driver's error text, because probe output is collected by dashboards and log
pipelines as well as by people.

Readiness gives up after 2 seconds. A connection to a host that has stopped
answering would otherwise hang until the operating system gave up, and the
caller's own timeout would expire first.

## Graceful shutdown

`SIGTERM` and `SIGINT` both start the same sequence:

1. `close()` — no new connections are accepted.
2. `closeIdleConnections()` — idle keep-alives are released. This is the step
   that makes the wait finite, and the one a plain `close()` omits.
3. In-flight requests are allowed to finish, for up to 10 seconds.
4. On timeout, remaining connections are cut and the process exits **non-zero**,
   so a supervisor learns the stop was not clean.
5. Connection pools are released before the process exits.
6. A second signal stops the wait immediately — if you signal twice, you mean it.

`uncaughtException` and `unhandledRejection` go through the same path, so an
unhandled error closes the pools instead of terminating the process mid-request.

### systemd

The stop timeout must exceed the application's own, or systemd escalates to
`SIGKILL` before step 4 can report anything:

```ini
[Service]
Type=simple
ExecStart=/usr/bin/node dist/server.js
EnvironmentFile=/etc/hq-marketplace.env
WorkingDirectory=/opt/hq-marketplace
TimeoutStopSec=30
Restart=on-failure
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

### Kubernetes

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 4000 }
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /readyz, port: 4000 }
  periodSeconds: 5
terminationGracePeriodSeconds: 30
```

### Rolling deploys

```bash
npm ci
npm run build
npm run db:migrate
npm run db:grants
NODE_ENV=production npm run preflight
# then restart; the API refuses to start if any of the above was skipped
```

Migrations are additive and backwards compatible, so the previous release keeps
working while the new one is starting. See
[03-migration-safety.md](./03-migration-safety.md).

## What the API refuses to start on

Each of these is a silent failure if it were allowed through, which is why they
are refusals rather than warnings:

- `JWT_SECRET` missing, under 32 characters, or a known placeholder
- `APP_DB_PASSWORD` or `PGPASSWORD` missing, too short, or a placeholder
- `APP_DB_USER` equal to `PGUSER`
- `CORS_ORIGIN` empty, a wildcard, or containing an `http://` origin
- `UPLOAD_DIR` relative
- `TRUST_PROXY_HOPS` unset
- the application database role being a superuser, holding `BYPASSRLS`, or owning
  a table without `FORCE ROW LEVEL SECURITY`

Outside production the database-role check warns instead of refusing, so a fresh
development setup runs without ceremony.

## The route index

`GET /api` returns a complete map of every endpoint, its required auth level, and
which header belongs to which role. It is available in development and test, and
it answers `404` in production.

Not because a 404 hides anything from somebody determined — the route names are
in this document, in the source, and in any client that has called the API. It is
because the index is a ready-made inventory of the privileged surface, and it
drifts out of date silently: nothing requires a new route to update it, so in
production it is as likely to be misleading as it is to be useful.

`GET /` still answers in production and reports `"index": null`, so a client can
tell "this build has no index" from an older response that omitted the field.

## The first administrator

A deployment has exactly one first administrator, and there is no way to create
one from a script. That is deliberate: an account has to come from a real
registration, so its password is one a person chose and hashed by the registration
endpoint, rather than one written into a shell history by a deploy script.

`db:promote-admin` and `db:revoke-admin` grant and revoke the `platform_admin`
role for an account that already exists. Neither accepts a password, because
there is no legitimate case for one — registration is the only way to set a
password, and keeping it that way is what stops this script from becoming a
backdoor.

### Procedure

```bash
# 1. Register through the site, as a person would.
#    POST /api/auth/register, or the sign-up form. Note the address used.

# 2. See what promoting them would do. Nothing is written without --yes.
npm run db:promote-admin -- you@example.com

# 3. Apply it.
npm run db:promote-admin -- you@example.com --yes
```

Step 2 is not a formality. It prints the account it found by name and asks for
`--yes`, so running the command to see what it does cannot promote anyone, and a
typo in the address is visible before it becomes a real role.

Confirm the account was found: an address with no account is an error, not an
empty success, and the script will tell you to register first.

### Handing the role over, and taking it back

```bash
# promote somebody else — the role is not exclusive, both accounts hold it
npm run db:promote-admin -- colleague@example.com --yes

# take it back
npm run db:revoke-admin -- colleague@example.com --yes
```

Both are idempotent, so a re-run after an uncertain deploy is safe: a second
promotion reports "nothing to change" and exits `0`, and so does revoking from
someone who was never an admin. Neither is an error, because a script that fails
on "already in the requested state" gets wrapped in retries and a `set -e` loop.

### What these scripts will not do

- **create an account** — an unknown address is refused
- **set or reset a password** — there is no option that takes one
- **touch the account itself** — a promotion changes one row in
  `user_platform_roles` and leaves `users` alone, so it cannot lock anyone out
- **revoke anything else** — the delete is scoped to the `platform_admin` role id,
  so a `customer` role and any business memberships survive

They connect as the OWNER role, not as `hq_app`, because this is a
platform-level operation and the application role is subject to the very policies
this role sits outside of.

## Rate limiting

Limiters key on `req.ip`, which is whatever `trust proxy` produced — see
`TRUST_PROXY_HOPS` above. With that setting wrong the limiters are useless, and
they look like they are working while doing it.