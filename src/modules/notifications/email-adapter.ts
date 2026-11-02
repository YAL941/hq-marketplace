import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { config } from '../../config.js';

type SmtpSettings = Pick<typeof config,
    'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_TLS_MODE' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'MAIL_FROM'>;

export interface SmtpTransportOptions {
    host: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
    tls: { rejectUnauthorized: true };
    auth?: { user: string; pass: string };
}

export interface MarketplaceEmail {
    to: string;
    subject: string;
    html: string;
    text: string;
}

/** The deliberately small transport surface makes tests independent of SMTP. */
export interface EmailTransport {
    sendMail(message: SendMailOptions): Promise<unknown>;
}

export type EmailDeliveryFailureCode =
    | 'smtp_not_configured'
    | 'smtp_invalid_tls_configuration'
    | 'invalid_email_message'
    | 'smtp_timeout'
    | 'smtp_tls_failed'
    | 'smtp_connection_failed'
    | 'smtp_authentication_failed'
    | 'smtp_temporary_rejection'
    | 'smtp_permanent_rejection'
    | 'smtp_send_failed';

export class EmailDeliveryError extends Error {
    constructor(
        readonly code: EmailDeliveryFailureCode,
        readonly retryable: boolean,
    ) {
        super(code);
        this.name = 'EmailDeliveryError';
    }
}

export interface EmailAdapterOptions {
    /** Pass a fake transport in tests. Providing null explicitly disables delivery. */
    transport?: EmailTransport | null;
    /** Optional factory lets tests inspect policy without opening a socket. */
    createTransport?: (options: SmtpTransportOptions) => EmailTransport;
    /** Uses the existing config shape; no additional environment variables are introduced. */
    smtpSettings?: SmtpSettings;
}

export class SmtpEmailAdapter {
    private readonly transport: EmailTransport | null;
    private readonly from: string;

    constructor(options: EmailAdapterOptions = {}) {
        const settings = options.smtpSettings ?? config;
        this.from = settings.MAIL_FROM;

        if (Object.hasOwn(options, 'transport')) {
            this.transport = options.transport ?? null;
        } else if (!settings.SMTP_HOST) {
            this.transport = null;
        } else {
            const tlsMode = settings.SMTP_TLS_MODE;
            if (!tlsMode || settings.SMTP_SECURE !== (tlsMode === 'implicit')) {
                throw new EmailDeliveryError('smtp_invalid_tls_configuration', false);
            }
            const transportOptions: SmtpTransportOptions = {
                host: settings.SMTP_HOST,
                port: settings.SMTP_PORT,
                secure: tlsMode === 'implicit',
                requireTLS: tlsMode === 'starttls',
                connectionTimeout: 10_000,
                greetingTimeout: 10_000,
                socketTimeout: 15_000,
                tls: { rejectUnauthorized: true },
                ...(settings.SMTP_USER && settings.SMTP_PASSWORD
                    ? { auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD } }
                    : {}),
            };
            this.transport = options.createTransport
                ? options.createTransport(transportOptions)
                : nodemailer.createTransport(transportOptions);
        }
    }

    isConfigured(): boolean {
        return this.transport !== null;
    }

    async send(message: MarketplaceEmail): Promise<void> {
        if (!this.transport) {
            throw new EmailDeliveryError('smtp_not_configured', false);
        }
        if (!isSafeHeader(message.to) || !isSafeHeader(message.subject) || !message.to.trim()) {
            throw new EmailDeliveryError('invalid_email_message', false);
        }

        try {
            await this.transport.sendMail({
                from: this.from,
                to: message.to,
                subject: message.subject,
                html: message.html,
                text: message.text,
            });
        } catch (error) {
            // Do not retain the original error/cause: Nodemailer errors may include
            // server responses, addresses, or authentication diagnostics.
            const failure = classifySmtpFailure(error);
            throw new EmailDeliveryError(failure.code, failure.retryable);
        }
    }
}

function isSafeHeader(value: string): boolean {
    return value.length > 0 && !/[\r\n\0]/.test(value);
}

function classifySmtpFailure(error: unknown): { code: EmailDeliveryFailureCode; retryable: boolean } {
    const safeError = error !== null && typeof error === 'object'
        ? error as { code?: unknown; responseCode?: unknown }
        : {};
    const code = typeof safeError.code === 'string' ? safeError.code.toUpperCase() : '';
    const responseCode = typeof safeError.responseCode === 'number' ? safeError.responseCode : undefined;

    if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) {
        return { code: 'smtp_timeout', retryable: true };
    }
    if (['ETLS', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) {
        return { code: 'smtp_tls_failed', retryable: true };
    }
    if (['ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)) {
        return { code: 'smtp_connection_failed', retryable: true };
    }
    // Nodemailer documents EAUTH for authentication failures. Do not infer this
    // from a generic 5xx response, which can also mean a permanent recipient or
    // policy rejection.
    if (code === 'EAUTH') {
        return { code: 'smtp_authentication_failed', retryable: false };
    }
    if (responseCode !== undefined && responseCode >= 500) {
        return { code: 'smtp_permanent_rejection', retryable: false };
    }
    if (responseCode !== undefined && responseCode >= 400) {
        return { code: 'smtp_temporary_rejection', retryable: true };
    }
    return { code: 'smtp_send_failed', retryable: true };
}
