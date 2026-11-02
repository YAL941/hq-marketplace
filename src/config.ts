import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

function loadSecretFile(targetName: string, pathName: string): void {
    const secretPath = process.env[pathName];
    if (process.env[targetName] || !secretPath) return;
    try {
        process.env[targetName] = readFileSync(secretPath, 'utf8').trim();
    } catch {
        throw new Error(`${pathName} could not be read`);
    }
}

// Compose file secrets are read before schema validation. Existing local .env
// configuration remains supported when no *_FILE path is provided.
loadSecretFile('APP_DB_PASSWORD', 'APP_DB_PASSWORD_FILE');
loadSecretFile('SMTP_USER', 'SMTP_USER_FILE');
loadSecretFile('SMTP_PASSWORD', 'SMTP_PASSWORD_FILE');

const envSchema = z.object({
    PROCESS_ROLE: z.enum(['api', 'notification_worker', 'migration', 'preflight']).default('api'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    PGHOST: z.string().default('localhost'),
    PGPORT: z.coerce.number().int().positive().default(5432),
    PGDATABASE: z.string().default('hq_marketplace'),
    PGUSER: z.string().optional(),
    PGPASSWORD: z.string().optional(),

    APP_DB_USER: z.string().default('hq_app'),
    APP_DB_PASSWORD: z.string().default('hq_app'),
    APP_DB_PASSWORD_FILE: z.string().optional(),
    APP_DB_CONNECTION_USER: z.string().optional(),
    PAYMENT_COMMISSION_BPS: z.coerce.number().int().min(0).max(10_000).default(500),
    PAYMENTS_MOCK_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    MOCK_MOBILE_MONEY_WEBHOOK_SECRET: z.string().optional(),
    PAYMENTS_MOCK_TESTER_EMAIL: z.string().email().optional(),

    PORT: z.coerce.number().int().positive().default(4000),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    /** Marketplace notifications require an explicit TLS transport mode. */
    SMTP_TLS_MODE: z.enum(['starttls', 'implicit']).optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_USER_FILE: z.string().optional(),
    SMTP_PASSWORD_FILE: z.string().optional(),
    MAIL_FROM: z.string().min(1).default('OmniHQ <no-reply@omnihq.local>'),
    PUBLIC_APP_URL: z.string().url().default('http://localhost:3001'),
    ORDERS_ENABLED: z.enum(['true', 'false']).optional(),
    // The production floor is checked separately and is stricter (32 chars,
    // no placeholders); this is only the minimum for a runnable dev setup.
    // Optional only for the notification worker, which does not issue or validate tokens.
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters (32 or more when NODE_ENV=production)').optional(),
    NOTIFICATION_WORKER_DB_USER: z.string().min(1).optional(),
    NOTIFICATION_WORKER_DB_PASSWORD: z.string().min(1).optional(),
    EMAIL_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    EMAIL_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
    EMAIL_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
    EMAIL_WORKER_LEASE_SECONDS: z.coerce.number().int().min(5).max(900).default(120),
    JWT_EXPIRES_IN: z.string().default('2h'),
    /**
     * Comma separated list of browser origins allowed to call the API, e.g.
     * `http://localhost:5173,https://app.example.com`.
     *
     * A wildcard is deliberately NOT accepted any more: with `origin: '*'` and
     * `credentials: true` the API was reachable from any page the user visited
     * while signed in, which turns a same-origin assumption into a false one.
     */
    CORS_ORIGIN: z.string().default('http://localhost:5173'),

    /**
     * How many reverse-proxy hops sit in front of the API, i.e. what
     * `express`'s `trust proxy` is set to.
     *
     * This is the single most consequential value in this file for a deployment.
     * With `0` every request that arrives through Caddy looks like it came from
     * `127.0.0.1`, so every rate limiter collapses onto one shared counter: ten
     * failed sign-ins from anyone would lock out every visitor on the site. With
     * `1` the client address is taken from `X-Forwarded-For` and the limiters
     * count people instead of counting the proxy.
     *
     * It is a hop count and not `true` on purpose. `true` means "trust the
     * `X-Forwarded-For` chain as far as it goes", which is only safe when
     * nothing but your own proxy can reach the port — with the API listening on
     * `127.0.0.1` that happens to hold, but if it is ever exposed the header
     * becomes attacker-controlled and the limiters can be walked around by
     * inventing one. A number states how many hops are actually trusted, so the
     * last one before the app is the one that counts.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),

    /**
     * Where uploaded images are stored.
     *
     * `local` writes to a folder on this machine and is the default for a fresh
     * local clone. `s3` selects a Cloudflare R2 / S3-compatible bucket and is
     * the correct choice for a deployed API behind a CDN or object store.
     */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
    /**
     * Root folder for stored images. A relative value is resolved against the
     * process working directory, which is the project root for `npm run dev`
     * and for `npm start`.
     */
    UPLOAD_DIR: z.string().min(1).default('uploads'),

    /** Upload ceilings, in bytes. The API is the only place these are enforced. */
    UPLOAD_MAX_LOGO_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
    UPLOAD_MAX_COVER_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
    UPLOAD_MAX_PRODUCT_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
    /**
     * Decompression-bomb guard. A 5 MB file can expand to gigabytes of pixels,
     * so the pixel count is checked after the header is read and before any
     * resize is attempted.
     */
    UPLOAD_MAX_PIXELS: z.coerce.number().int().positive().default(40_000_000),
}).refine(
    (value) => Boolean(value.SMTP_USER) === Boolean(value.SMTP_PASSWORD),
    { message: 'SMTP_USER and SMTP_PASSWORD must both be set or both be empty' },
).refine(
    (value) => value.PROCESS_ROLE !== 'api' || !value.SMTP_HOST || value.NODE_ENV === 'test'
        || (Boolean(value.SMTP_TLS_MODE)
            && value.SMTP_SECURE === (value.SMTP_TLS_MODE === 'implicit')),
    { message: 'API SMTP requires SMTP_TLS_MODE=starttls with SMTP_SECURE=false or SMTP_TLS_MODE=implicit with SMTP_SECURE=true' },
).refine(
    (value) => value.PROCESS_ROLE !== 'notification_worker'
        || Math.ceil(value.EMAIL_WORKER_BATCH_SIZE / value.EMAIL_WORKER_CONCURRENCY) * 35 + 5
            <= value.EMAIL_WORKER_LEASE_SECONDS,
    { message: 'EMAIL_WORKER_LEASE_SECONDS must cover bounded batch processing time' },
).refine(
    (value) => value.PROCESS_ROLE !== 'notification_worker' || !value.SMTP_HOST || Boolean(value.SMTP_TLS_MODE),
    { message: 'SMTP_TLS_MODE must be explicitly set to starttls or implicit for the email worker' },
).refine(
    (value) => value.PROCESS_ROLE !== 'notification_worker' || !value.SMTP_HOST
        || value.SMTP_SECURE === (value.SMTP_TLS_MODE === 'implicit'),
    { message: 'SMTP_SECURE must be true for implicit TLS and false for required STARTTLS' },
).refine(
    (value) => value.PROCESS_ROLE !== 'notification_worker' || value.NODE_ENV !== 'production'
        || !value.SMTP_HOST || (Boolean(value.SMTP_USER) && Boolean(value.SMTP_PASSWORD)),
    { message: 'SMTP_USER and SMTP_PASSWORD are required for production email worker delivery' },
);

/** The Vite dev server, used when CORS_ORIGIN is unset or unusable. */
const DEFAULT_DEV_ORIGIN = 'http://localhost:5173';

/**
 * Turns the raw CORS_ORIGIN value into an allow list.
 *
 * `*` used to be the documented value and is still present in some `.env`
 * files, so it is treated as "not configured" rather than as a wildcard: the
 * safe local default is used instead and the problem is reported, so a
 * deployment that still carries `CORS_ORIGIN=*` fails visibly in production
 * instead of quietly serving every origin.
 */
function parseCorsOrigins(raw: string, isProduction: boolean): string[] {
    const entries = raw
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter((o) => o.length > 0 && o !== '*');

    if (entries.length === 0) {
        if (isProduction) {
            throw new Error(
                'CORS_ORIGIN must list at least one allowed origin when NODE_ENV=production.\n'
                + '  Example: CORS_ORIGIN=https://app.example.com\n'
                + '  A wildcard is not accepted.',
            );
        }
        return [DEFAULT_DEV_ORIGIN];
    }

    if (isProduction) {
        const insecure = entries.filter((o) => o.startsWith('http://'));
        if (insecure.length > 0) {
            throw new Error(
                `CORS_ORIGIN contains plaintext origins, which is not allowed in production: `
                + `${insecure.join(', ')}\n  Use https:// for every allowed origin.`,
            );
        }
    }

    return entries;
}

/**
 * Values that must never reach production, because they are the ones people
 * copy from the README when they are setting the project up for the first time.
 */
const WEAK_SECRETS = new Set([
    'secret',
    'change-me',
    'changeme',
    'jwt-secret',
    'jwt_secret',
    'your-secret-here',
    'supersecret',
    'test-secret',
    'hq_app',
    'hqapp',
    'postgres',
    'password',
]);

/**
 * Refuses to let the API boot with a secret that is missing, too short, or a
 * known placeholder.
 *
 * Development and test keep their permissive defaults on purpose: a fresh
 * clone has to be runnable without writing a secret into a file first. The
 * moment NODE_ENV=production the same configuration is a deployment mistake
 * that must surface at startup rather than as a forged token in production
 * traffic, so the process refuses to start.
 */
function assertProductionSecret(name: string, value: string | undefined, minLength: number): void {
    const problems: string[] = [];

    if (value === undefined || value.trim() === '') {
        problems.push('is not set');
    } else {
        if (value.length < minLength) {
            problems.push(`is only ${value.length} characters, at least ${minLength} are required`);
        }
        if (WEAK_SECRETS.has(value.toLowerCase())) {
            problems.push('is a well known placeholder value');
        }
        if (new Set(value).size <= 2) {
            problems.push('repeats the same character too many times');
        }
    }

    if (problems.length === 0) return;

    throw new Error(
        `Refusing to start: ${name} ${problems.join(' and ')}.\n`
        + `  Generate a real one, for example:\n`
        + `    ${name}=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")\n`
        + `  and put it in the environment before running with NODE_ENV=production.`,
    );
}

/**
 * Refuses to let the API boot with a value that is a deployment mistake only in
 * production, where the same value is either harmless or fatal.
 *
 * Each guard below exists because its failure mode is silent. That is the
 * common thread: none of these misconfigurations produces an error, a stack
 * trace or a failed request. The server starts, serves traffic, and quietly
 * does the wrong thing — which is exactly why they are refused outright rather
 * than warned about.
 */

/**
 * The admin password is a real credential in production.
 *
 * `PGPASSWORD` is the schema owner's password, the one role that bypasses row
 * level security and can do anything to any table. It is checked here with the
 * same rule as `APP_DB_PASSWORD` for a reason: `change-me` is the value in
 * `.env.example`, and a deployment that copies the file and edits only the
 * fields it thinks it needs leaves the highest-privilege credential in the
 * project at its documented placeholder.
 */
function assertProductionAdminPassword(value: string | undefined): void {
    assertProductionSecret('PGPASSWORD', value, 16);
}

/**
 * The API and the migrations must not run as the same database role.
 *
 * Everything this project is built on — a role that cannot see other tenants'
 * rows — depends on those two being different identities. When
 * `APP_DB_USER` is left pointing at `PGUSER`, the application quietly becomes
 * the schema owner, and the policies stop being consulted on every query while
 * every request still returns `200`.
 *
 * This is the cheap half of that guard, caught at config time with a message
 * that can still be read by whoever is deploying. `assertAppRoleIsSafe()` in
 * `src/db/pool.ts` is the authoritative half: it asks the database rather than
 * trusting the environment, and therefore also catches a role that is unsafe for
 * a reason nobody wrote down here, such as BYPASSRLS.
 */
function assertSeparateDbRoles(appUser: string, adminUser: string): void {
    if (appUser === adminUser) {
        throw new Error(
            `Refusing to start: APP_DB_USER and PGUSER are both "${appUser}".\n`
            + `  The API must connect as a role that the database filters with row level\n`
            + `  security, not as the role that owns the tables. As the owner, every policy\n`
            + `  is bypassed: requests still succeed and still return other businesses' rows.\n`
            + `  Keep PGUSER as the migration role and let APP_DB_USER be the role created by:\n`
            + `    npm run db:grants`,
        );
    }
}

/**
 * Uploads live at an absolute path in production.
 *
 * A relative `UPLOAD_DIR` resolves against the process working directory, which
 * is the project root under `npm start` and something else entirely under a
 * service manager. Nothing fails when that happens: the first upload creates
 * the folder wherever the process happens to be, and the images already stored
 * under the previous location are simply gone — with no error, because the URLs
 * in the database still resolve to files that no longer exist.
 */
function assertAbsoluteUploadDir(value: string): void {
    if (isAbsolute(value)) return;

    throw new Error(
        `Refusing to start: UPLOAD_DIR is "${value}", which is a relative path.\n`
        + `  In production it is resolved against the working directory of whatever starts\n`
        + `  the process, and that differs between a shell, systemd and a container. Stored\n`
        + `  images would then be written somewhere that is not where the old ones are.\n`
        + `  Use an absolute path, and mount it as its own volume:\n`
        + `    UPLOAD_DIR=/var/lib/hq-marketplace/uploads`,
    );
}

/**
 * The proxy topology has to be stated, not guessed.
 *
 * `TRUST_PROXY_HOPS` has no default that is right, only defaults that are right
 * for someone else's deployment, and both of the plausible values are dangerous
 * in opposite directions:
 *
 *   * too low — every request through the proxy appears to come from `127.0.0.1`,
 *     so all visitors share one rate-limit counter and one of them can lock
 *     everyone else out.
 *   * too high — `X-Forwarded-For` is trusted further back than the number of
 *     proxies that actually set it, so a caller can invent their own address and
 *     walk around every limiter.
 *
 * Neither produces an error. So in production the value has to be a decision.
 */
function assertExplicitTrustProxyHops(value: number | undefined): void {
    if (value !== undefined) return;

    throw new Error(
        'Refusing to start: TRUST_PROXY_HOPS is not set.\n'
        + '  It has no safe default, because both of the likely mistakes are silent:\n'
        + '    0  every request through your proxy looks like 127.0.0.1, so all visitors\n'
        + '       share one rate-limit counter and one of them can lock out the rest;\n'
        + '    too high  X-Forwarded-For is trusted further back than the proxies that set\n'
        + '       it, so a caller can forge their address and walk around the limiters.\n'
        + '  Count the proxies between the internet and this process. For a single\n'
        + '  Caddy/nginx in front of the API: TRUST_PROXY_HOPS=1',
    );
}

function assertS3Config(value: AppConfig): void {
    if (value.STORAGE_DRIVER !== 's3') return;

    const missing: string[] = [];
    if (!value.S3_BUCKET) missing.push('S3_BUCKET');
    if (!value.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID');
    if (!value.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY');
    if (!value.S3_REGION && !value.S3_ENDPOINT) missing.push('S3_REGION or S3_ENDPOINT');

    if (missing.length > 0) {
        throw new Error(
            `Refusing to start: STORAGE_DRIVER=s3 requires ${missing.join(', ')}.\n`
            + '  Use a Cloudflare R2 or S3-compatible bucket. Set VITE_MEDIA_BASE in the frontend build '
            + 'or proxy /uploads/* to the bucket so browsers can load images.',
        );
    }
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

if (
    parsed.data.PAYMENTS_MOCK_ENABLED
    && (!parsed.data.MOCK_MOBILE_MONEY_WEBHOOK_SECRET
        || parsed.data.MOCK_MOBILE_MONEY_WEBHOOK_SECRET.length < 32)
) {
    throw new Error(
        'Invalid environment configuration:\n'
        + '  - MOCK_MOBILE_MONEY_WEBHOOK_SECRET: required and at least 32 characters when PAYMENTS_MOCK_ENABLED=true.',
    );
}

if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.PROCESS_ROLE === 'notification_worker') {
        if (parsed.data.PGUSER || parsed.data.PGPASSWORD) {
            throw new Error('Refusing to start: notification worker must not receive administrative database credentials.');
        }
        assertProductionSecret('NOTIFICATION_WORKER_DB_PASSWORD', parsed.data.NOTIFICATION_WORKER_DB_PASSWORD, 16);
        if (!parsed.data.NOTIFICATION_WORKER_DB_USER) {
            throw new Error('Refusing to start: NOTIFICATION_WORKER_DB_USER is not set.');
        }
        if ([parsed.data.PGUSER, parsed.data.APP_DB_USER].includes(parsed.data.NOTIFICATION_WORKER_DB_USER)) {
            throw new Error('Refusing to start: notification worker must use its dedicated database login.');
        }
    } else if (parsed.data.PROCESS_ROLE === 'api' || parsed.data.PROCESS_ROLE === 'preflight') {
        if (parsed.data.PROCESS_ROLE === 'api' && (parsed.data.PGUSER || parsed.data.PGPASSWORD)) {
            throw new Error('Refusing to start: API must not receive administrative database credentials.');
        }
        assertProductionSecret('JWT_SECRET', parsed.data.JWT_SECRET, 32);
        assertProductionSecret('APP_DB_PASSWORD', parsed.data.APP_DB_PASSWORD, 16);
        if (parsed.data.STORAGE_DRIVER === 'local') assertAbsoluteUploadDir(parsed.data.UPLOAD_DIR);
        assertExplicitTrustProxyHops(parsed.data.TRUST_PROXY_HOPS);
        if (parsed.data.PAYMENTS_MOCK_ENABLED && !parsed.data.PAYMENTS_MOCK_TESTER_EMAIL) {
            throw new Error('Refusing to start: PAYMENTS_MOCK_TESTER_EMAIL is required when PAYMENTS_MOCK_ENABLED=true in production.');
        }
    }
    if (parsed.data.PROCESS_ROLE === 'migration' || parsed.data.PROCESS_ROLE === 'preflight') {
        if (!parsed.data.PGUSER) throw new Error('Refusing to start: PGUSER is required for trusted database tooling.');
        assertProductionAdminPassword(parsed.data.PGPASSWORD);
        assertSeparateDbRoles(parsed.data.APP_DB_USER, parsed.data.PGUSER);
    }
}

const configBase = {
    ...parsed.data,
    // Worker code never uses JWT. This placeholder stays process-local and is
    // not accepted in API mode, where the existing production checks remain.
    JWT_SECRET: parsed.data.JWT_SECRET ?? 'notification-worker-unused-secret',
    // Internal orders are enabled unless a deployment explicitly pauses them.
    ORDERS_ENABLED:
        parsed.data.ORDERS_ENABLED === undefined
            ? true
            : parsed.data.ORDERS_ENABLED === 'true',
    mockMobileMoneyEnabled:
        parsed.data.PAYMENTS_MOCK_ENABLED
        && (parsed.data.NODE_ENV !== 'production' || Boolean(parsed.data.PAYMENTS_MOCK_TESTER_EMAIL))
        && Boolean(parsed.data.MOCK_MOBILE_MONEY_WEBHOOK_SECRET),
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
    corsOrigins: parsed.data.PROCESS_ROLE === 'api'
        ? parseCorsOrigins(parsed.data.CORS_ORIGIN, parsed.data.NODE_ENV === 'production')
        : [],
    /**
     * The schema intentionally has no default: production startup requires an
     * explicit trust-proxy count, while non-production can safely use zero.
     * Production never reaches the fallback — `assertExplicitTrustProxyHops()`
     * has already refused to start by then. The `1` below is therefore only
     * ever the answer for a development run that happens to set the variable.
     */
    trustProxyHops: parsed.data.TRUST_PROXY_HOPS ?? (parsed.data.NODE_ENV === 'production' ? 1 : 0),
} as const;

if (parsed.data.PROCESS_ROLE === 'api') assertS3Config(configBase);

export const config = configBase;

export type AppConfig = typeof config;
