import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MIN_COMPOSE = [2, 32, 0];
const WEAK_SECRETS = new Set(['secret', 'change-me', 'changeme', 'postgres', 'password', 'test-secret', 'hq_app']);

export function isStrongSecret(value) {
    return typeof value === 'string'
        && value.trim().length >= 16
        && !WEAK_SECRETS.has(value.trim().toLowerCase())
        && new Set(value).size > 2;
}

export function compareComposeVersions(actual, minimum = MIN_COMPOSE) {
    const match = /(?:Docker Compose version\s*)?v?(\d+)\.(\d+)\.(\d+)/i.exec(actual);
    if (!match) return false;
    const version = match.slice(1).map(Number);
    for (let index = 0; index < minimum.length; index += 1) {
        if (version[index] !== minimum[index]) return version[index] > minimum[index];
    }
    return true;
}

export async function validateComposeEnvironment(env, readSecret = async (path) => (await readFile(path, 'utf8')).trim()) {
    const errors = [];
    const required = (name) => {
        const value = env[name]?.trim();
        if (!value) errors.push(`${name} is required`);
        return value;
    };
    const requireStrong = async (name, value) => {
        if (!value) return;
        if (!isStrongSecret(value)) errors.push(`${name} must be a non-placeholder secret of at least 16 characters`);
    };
    const fileSecret = async (envName, label, requiredFile = true) => {
        const path = env[envName]?.trim();
        if (!path) {
            if (requiredFile) errors.push(`${envName} is required`);
            return undefined;
        }
        try {
            const value = await readSecret(path);
            if (!value && requiredFile) errors.push(`${label} secret file is empty`);
            return value;
        } catch {
            errors.push(`${envName} must refer to a readable secret file`);
            return undefined;
        }
    };

    const migrationUser = required('PGUSER');
    const migrationPassword = required('PGPASSWORD');
    await requireStrong('PGPASSWORD', migrationPassword);
    const appUser = required('APP_DB_USER');
    if (migrationUser && appUser && migrationUser === appUser) errors.push('APP_DB_USER must differ from PGUSER');
    const appPassword = await fileSecret('APP_DB_PASSWORD_SECRET_FILE', 'APP_DB_PASSWORD');
    await requireStrong('APP_DB_PASSWORD', appPassword);

    const workerUser = required('NOTIFICATION_WORKER_DB_USER');
    if (workerUser && [migrationUser, appUser].includes(workerUser)) {
        errors.push('NOTIFICATION_WORKER_DB_USER must be a dedicated login');
    }
    const workerPassword = await fileSecret('NOTIFICATION_WORKER_DB_PASSWORD_SECRET_FILE', 'notification worker database password');
    await requireStrong('notification worker database password', workerPassword);

    const smtpUser = await fileSecret('SMTP_USER_SECRET_FILE', 'SMTP username', false);
    const smtpPassword = await fileSecret('SMTP_PASSWORD_SECRET_FILE', 'SMTP password', false);
    if (Boolean(smtpUser) !== Boolean(smtpPassword)) errors.push('SMTP username and password secrets must both be present or both be empty');
    if (env.SMTP_HOST?.trim()) {
        if (!smtpUser || !smtpPassword) errors.push('SMTP username and password secret files are required when SMTP_HOST is set');
        const mode = env.SMTP_TLS_MODE;
        if (mode !== 'starttls' && mode !== 'implicit') errors.push('SMTP_TLS_MODE must explicitly be starttls or implicit');
        const expectedSecure = mode === 'implicit';
        if (env.SMTP_SECURE !== String(expectedSecure)) errors.push('SMTP_SECURE does not match SMTP_TLS_MODE');
    }

    const localPostgresFile = env.LOCAL_POSTGRES_PASSWORD_FILE?.trim();
    if (localPostgresFile) {
        const localPassword = await fileSecret('LOCAL_POSTGRES_PASSWORD_FILE', 'local PostgreSQL password');
        await requireStrong('local PostgreSQL password', localPassword);
        if (localPassword && migrationPassword && localPassword !== migrationPassword) {
            errors.push('local PostgreSQL password secret must match PGPASSWORD used by migration tools');
        }
    }
    return errors;
}

async function main() {
    let version;
    try {
        version = execFileSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        console.error('[compose-preflight] Docker Compose v2.32.0 or newer is required');
        process.exitCode = 1;
        return;
    }
    if (!compareComposeVersions(version)) {
        console.error('[compose-preflight] Docker Compose v2.32.0 or newer is required');
        process.exitCode = 1;
        return;
    }
    const errors = await validateComposeEnvironment(process.env);
    if (errors.length) {
        console.error('[compose-preflight] configuration rejected:');
        for (const error of errors) console.error(`  - ${error}`);
        process.exitCode = 1;
        return;
    }
    console.info('[compose-preflight] configuration checks passed; secret values were not printed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
