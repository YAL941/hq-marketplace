import 'dotenv/config';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    PGHOST: z.string().default('localhost'),
    PGPORT: z.coerce.number().int().positive().default(5432),
    PGDATABASE: z.string().default('hq_marketplace'),
    PGUSER: z.string().default('postgres'),
    PGPASSWORD: z.string().default('postgres'),

    APP_DB_USER: z.string().default('hq_app'),
    APP_DB_PASSWORD: z.string().default('hq_app'),

    PORT: z.coerce.number().int().positive().default(4000),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().min(1).default('OmniHQ <no-reply@omnihq.local>'),
    PUBLIC_APP_URL: z.string().url().default('http://localhost:3001'),
    ORDERS_ENABLED: z.enum(['true', 'false']).optional(),
    // The production floor is checked separately and is stricter (32 chars,
    // no placeholders); this is only the minimum for a runnable dev setup.
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters (32 or more when NODE_ENV=production)'),
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
     * `local` writes to a folder on this machine and is the only driver that
     * exists today; it is also the default, so a fresh clone serves uploads
     * without anyone having to edit `.env` first. Adding S3 or Cloudflare R2
     * later means adding a value here and an implementation of
     * `StorageProvider`, not touching a route.
     */
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    /**
     * Root folder for stored images. A relative value is resolved against the
     * process working directory, which is the project root for `npm run dev`
     * and for `npm start`. The public URL of a stored file is always
     * `/uploads/<businessId>/<slot>/<name>`, independently of this path: the
     * folder is an implementation detail and must never leak into a database
     * row, or moving the folder would break every stored URL.
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

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

if (parsed.data.NODE_ENV === 'production') {
    assertProductionSecret('JWT_SECRET', parsed.data.JWT_SECRET, 32);
    assertProductionSecret('APP_DB_PASSWORD', parsed.data.APP_DB_PASSWORD, 16);
    assertProductionAdminPassword(parsed.data.PGPASSWORD);
    assertSeparateDbRoles(parsed.data.APP_DB_USER, parsed.data.PGUSER);
    assertAbsoluteUploadDir(parsed.data.UPLOAD_DIR);
    assertExplicitTrustProxyHops(parsed.data.TRUST_PROXY_HOPS);
}

export const config = {
    ...parsed.data,
    // Internal orders are enabled unless a deployment explicitly pauses them.
    ORDERS_ENABLED:
        parsed.data.ORDERS_ENABLED === undefined
            ? true
            : parsed.data.ORDERS_ENABLED === 'true',
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
    corsOrigins: parseCorsOrigins(parsed.data.CORS_ORIGIN, parsed.data.NODE_ENV === 'production'),
    /**
     * The schema intentionally has no default: production startup requires an
     * explicit trust-proxy count, while non-production can safely use zero.
     * Production never reaches the fallback — `assertExplicitTrustProxyHops()`
     * has already refused to start by then. The `1` below is therefore only
     * ever the answer for a development run that happens to set the variable.
     */
    trustProxyHops: parsed.data.TRUST_PROXY_HOPS ?? (parsed.data.NODE_ENV === 'production' ? 1 : 0),
} as const;

export type AppConfig = typeof config;
