import 'dotenv/config';
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
});

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

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
}

if (parsed.data.NODE_ENV === 'production') {
    assertProductionSecret('JWT_SECRET', parsed.data.JWT_SECRET, 32);
    assertProductionSecret('APP_DB_PASSWORD', parsed.data.APP_DB_PASSWORD, 16);
}

export const config = {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
    corsOrigins: parseCorsOrigins(parsed.data.CORS_ORIGIN, parsed.data.NODE_ENV === 'production'),
} as const;

export type AppConfig = typeof config;
