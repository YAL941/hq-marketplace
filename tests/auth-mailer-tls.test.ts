import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import type { SendMailOptions } from 'nodemailer';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
    createAuthMailerTransport,
    installMailerTestTransport,
    sendPasswordResetEmail,
    type AuthMailerSmtpSettings,
    type AuthMailerTransport,
    type AuthMailerTransportOptions,
} from '../src/modules/admin/mailer.js';

const baseSettings: AuthMailerSmtpSettings = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_TLS_MODE: 'starttls',
    SMTP_USER: 'test-user',
    SMTP_PASSWORD: 'test-password',
    MAIL_FROM: 'test@example.test',
};
const run = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mailerUrl = pathToFileURL(resolve(projectRoot, 'src/modules/admin/mailer.ts')).href;

after(() => installMailerTestTransport(null));

describe('authentication mailer TLS policy', () => {
    it('starts in development when SMTP is intentionally unconfigured', async () => {
        const env = {
            PATH: process.env['PATH'] ?? '',
            NODE_ENV: 'development',
            DOTENV_CONFIG_PATH: resolve(projectRoot, 'no-such-env-for-auth-mailer-test'),
        };
        const { stdout } = await run(process.execPath, [
            '--import', './tests/helpers/register-typescript-loader.mjs',
            '--input-type=module', '-e',
            `import(${JSON.stringify(mailerUrl)}).then(({ isEmailDeliveryConfigured }) => {
                if (isEmailDeliveryConfigured()) process.exitCode = 1;
                else console.log('BOOTED_WITH_EMAIL_DISABLED');
            })`,
        ], { cwd: projectRoot, env, encoding: 'utf8' });
        assert.match(stdout, /BOOTED_WITH_EMAIL_DISABLED/);
    });

    it('requires STARTTLS and certificate validation with no plaintext fallback', () => {
        let options: AuthMailerTransportOptions | undefined;
        const fake: AuthMailerTransport = { sendMail: async () => ({ accepted: [] }) };

        const transport = createAuthMailerTransport(baseSettings, (received) => {
            options = received;
            return fake;
        });

        assert.equal(transport, fake);
        assert.equal(options?.secure, false);
        assert.equal(options?.requireTLS, true);
        assert.deepEqual(options?.tls, { rejectUnauthorized: true });
        assert.equal(options?.connectionTimeout, 10_000);
        assert.equal(options?.greetingTimeout, 10_000);
        assert.equal(options?.socketTimeout, 15_000);
    });

    it('uses implicit TLS with secure transport enabled', () => {
        let options: AuthMailerTransportOptions | undefined;
        createAuthMailerTransport({
            ...baseSettings,
            SMTP_PORT: 465,
            SMTP_SECURE: true,
            SMTP_TLS_MODE: 'implicit',
        }, (received) => {
            options = received;
            return { sendMail: async () => ({ accepted: [] }) };
        });

        assert.equal(options?.secure, true);
        assert.equal(options?.requireTLS, false);
        assert.deepEqual(options?.tls, { rejectUnauthorized: true });
    });

    it('does not create a transport when SMTP is not configured', () => {
        let factoryCalls = 0;
        const transport = createAuthMailerTransport({
            ...baseSettings,
            SMTP_HOST: undefined,
            SMTP_TLS_MODE: undefined,
        }, () => {
            factoryCalls++;
            return { sendMail: async () => undefined };
        });

        assert.equal(transport, null);
        assert.equal(factoryCalls, 0);
    });

    it('rejects missing or mismatched TLS policy before transport creation', () => {
        let factoryCalls = 0;
        const factory = () => {
            factoryCalls++;
            return { sendMail: async () => undefined };
        };

        assert.throws(() => createAuthMailerTransport({
            ...baseSettings,
            SMTP_TLS_MODE: undefined,
        }, factory), /SMTP TLS configuration is invalid/);
        assert.throws(() => createAuthMailerTransport({
            ...baseSettings,
            SMTP_SECURE: true,
            SMTP_TLS_MODE: 'starttls',
        }, factory), /SMTP TLS configuration is invalid/);
        assert.equal(factoryCalls, 0);
    });

    it('does not retry in plaintext after TLS negotiation failure and sanitizes the error', async () => {
        let sendCalls = 0;
        installMailerTestTransport({
            sendMail: async (_message: SendMailOptions) => {
                sendCalls++;
                throw Object.assign(new Error('provider response with secret details'), { code: 'ETLS' });
            },
        });

        await assert.rejects(sendPasswordResetEmail({
            recipient: 'person@example.test',
            fullName: 'Test User',
            resetUrl: 'https://example.test/reset',
        }), (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, 'SMTP delivery failed (smtp_tls_failed)');
            assert.doesNotMatch(error.message, /provider response|secret details/);
            return true;
        });
        assert.equal(sendCalls, 1);
    });
});
