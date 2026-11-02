import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SendMailOptions } from 'nodemailer';
import { EmailDeliveryError, type EmailTransport, type SmtpTransportOptions, SmtpEmailAdapter } from '../src/modules/notifications/email-adapter.js';

const message = { to: 'customer@example.test', subject: 'Order update', html: '<p>Update</p>', text: 'Update' };

function fakeTransport(sendMail: (input: SendMailOptions) => Promise<unknown>): EmailTransport {
    return { sendMail };
}

describe('SMTP email adapter', () => {
    it('requires STARTTLS and certificate validation with no plaintext downgrade', async () => {
        let captured: SmtpTransportOptions | undefined;
        const adapter = new SmtpEmailAdapter({
            smtpSettings: {
                SMTP_HOST: 'smtp.example.test', SMTP_PORT: 587, SMTP_SECURE: false, SMTP_TLS_MODE: 'starttls',
                SMTP_USER: 'test-user', SMTP_PASSWORD: 'test-password', MAIL_FROM: 'OmniHQ <mail@example.test>',
            },
            createTransport: (options) => { captured = options; return fakeTransport(async () => ({})); },
        });
        assert.equal(adapter.isConfigured(), true);
        assert.equal(captured?.secure, false);
        assert.equal(captured?.requireTLS, true);
        assert.deepEqual(captured?.tls, { rejectUnauthorized: true });
    });

    it('uses implicit TLS without enabling a STARTTLS downgrade path', async () => {
        let captured: SmtpTransportOptions | undefined;
        new SmtpEmailAdapter({
            smtpSettings: {
                SMTP_HOST: 'smtp.example.test', SMTP_PORT: 465, SMTP_SECURE: true, SMTP_TLS_MODE: 'implicit',
                SMTP_USER: 'test-user', SMTP_PASSWORD: 'test-password', MAIL_FROM: 'OmniHQ <mail@example.test>',
            },
            createTransport: (options) => { captured = options; return fakeTransport(async () => ({})); },
        });
        assert.equal(captured?.secure, true);
        assert.equal(captured?.requireTLS, false);
        assert.deepEqual(captured?.tls, { rejectUnauthorized: true });
    });

    it('rejects incomplete TLS configuration before creating a transport', () => {
        let created = false;
        assert.throws(() => new SmtpEmailAdapter({
            smtpSettings: {
                SMTP_HOST: 'smtp.example.test', SMTP_PORT: 587, SMTP_SECURE: false, SMTP_TLS_MODE: undefined,
                SMTP_USER: undefined, SMTP_PASSWORD: undefined, MAIL_FROM: 'OmniHQ <mail@example.test>',
            },
            createTransport: () => { created = true; return fakeTransport(async () => ({})); },
        }), (error: unknown) => error instanceof EmailDeliveryError && error.code === 'smtp_invalid_tls_configuration');
        assert.equal(created, false);
    });

    it('classifies TLS negotiation failure without exposing provider details', async () => {
        const adapter = new SmtpEmailAdapter({
            transport: fakeTransport(async () => { throw Object.assign(new Error('private TLS endpoint details'), { code: 'ETLS' }); }),
        });
        await assert.rejects(adapter.send(message), (error: unknown) => {
            assert.ok(error instanceof EmailDeliveryError);
            assert.equal(error.code, 'smtp_tls_failed');
            assert.equal(error.retryable, true);
            assert.equal(error.message, 'smtp_tls_failed');
            return true;
        });
    });

    it('sends HTML and plain text through the injected transport', async () => {
        let captured: SendMailOptions | undefined;
        const adapter = new SmtpEmailAdapter({
            transport: fakeTransport(async (input) => { captured = input; return { accepted: [input.to] }; }),
        });

        assert.equal(adapter.isConfigured(), true);
        await adapter.send(message);
        assert.equal(captured?.to, message.to);
        assert.equal(captured?.subject, message.subject);
        assert.equal(captured?.html, message.html);
        assert.equal(captured?.text, message.text);
        assert.equal(typeof captured?.from, 'string');
    });

    it('classifies temporary SMTP rejection as retryable without exposing server text', async () => {
        const adapter = new SmtpEmailAdapter({
            transport: fakeTransport(async () => { throw Object.assign(new Error('secret server response'), { responseCode: 451 }); }),
        });
        await assert.rejects(adapter.send(message), (error: unknown) => {
            assert.ok(error instanceof EmailDeliveryError);
            assert.equal(error.code, 'smtp_temporary_rejection');
            assert.equal(error.retryable, true);
            assert.equal(error.message, 'smtp_temporary_rejection');
            assert.equal('cause' in error, false);
            return true;
        });
    });

    it('classifies permanent SMTP rejection as non-retryable', async () => {
        const adapter = new SmtpEmailAdapter({
            transport: fakeTransport(async () => { throw Object.assign(new Error('mailbox and server details'), { responseCode: 550 }); }),
        });
        await assert.rejects(adapter.send(message), (error: unknown) => {
            assert.ok(error instanceof EmailDeliveryError);
            assert.equal(error.code, 'smtp_permanent_rejection');
            assert.equal(error.retryable, false);
            assert.equal(error.message.includes('mailbox'), false);
            return true;
        });
    });

    it('classifies Nodemailer EAUTH separately from generic permanent rejection', async () => {
        const adapter = new SmtpEmailAdapter({
            transport: fakeTransport(async () => {
                throw Object.assign(new Error('private authentication details'), { code: 'EAUTH', responseCode: 535 });
            }),
        });
        await assert.rejects(adapter.send(message), (error: unknown) => {
            assert.ok(error instanceof EmailDeliveryError);
            assert.equal(error.code, 'smtp_authentication_failed');
            assert.equal(error.retryable, false);
            assert.equal(error.message.includes('private'), false);
            return true;
        });
    });

    it('classifies socket timeout as retryable', async () => {
        const adapter = new SmtpEmailAdapter({
            transport: fakeTransport(async () => { throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }); }),
        });
        await assert.rejects(adapter.send(message), (error: unknown) => {
            assert.ok(error instanceof EmailDeliveryError);
            assert.equal(error.code, 'smtp_timeout');
            assert.equal(error.retryable, true);
            return true;
        });
    });

    it('classifies network connection failure as retryable', async () => {
        const adapter = new SmtpEmailAdapter({
            transport: fakeTransport(async () => { throw Object.assign(new Error('private host details'), { code: 'ECONNREFUSED' }); }),
        });
        await assert.rejects(adapter.send(message), (error: unknown) =>
            error instanceof EmailDeliveryError && error.code === 'smtp_connection_failed' && error.retryable);
    });

    it('fails safely when SMTP configuration is missing', async () => {
        const adapter = new SmtpEmailAdapter({
            smtpSettings: {
                SMTP_HOST: undefined,
                SMTP_PORT: 587,
                SMTP_SECURE: false,
                SMTP_TLS_MODE: undefined,
                SMTP_USER: undefined,
                SMTP_PASSWORD: undefined,
                MAIL_FROM: 'OmniHQ <no-reply@example.test>',
            },
        });
        assert.equal(adapter.isConfigured(), false);
        await assert.rejects(adapter.send(message), (error: unknown) => {
            assert.ok(error instanceof EmailDeliveryError);
            assert.equal(error.code, 'smtp_not_configured');
            assert.equal(error.retryable, false);
            return true;
        });
    });

    it('rejects header injection before the transport is called', async () => {
        let called = false;
        const adapter = new SmtpEmailAdapter({
            transport: fakeTransport(async () => { called = true; }),
        });
        await assert.rejects(adapter.send({ ...message, subject: 'subject\r\nBcc: attacker@example.test' }),
            (error: unknown) => error instanceof EmailDeliveryError && error.code === 'invalid_email_message');
        assert.equal(called, false);
    });
});
