import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { config } from '../../config.js';

export interface BusinessDecisionEmail {
    businessName: string;
    recipient: string | null;
    status: 'active' | 'pending' | 'rejected';
    reason?: string | null;
}

export interface AuthMailerTransport {
    sendMail(message: SendMailOptions): Promise<unknown>;
}

export interface AuthMailerSmtpSettings {
    SMTP_HOST?: string;
    SMTP_PORT: number;
    SMTP_SECURE: boolean;
    SMTP_TLS_MODE?: 'starttls' | 'implicit';
    SMTP_USER?: string;
    SMTP_PASSWORD?: string;
    MAIL_FROM: string;
}

export interface AuthMailerTransportOptions {
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

let testTransport: AuthMailerTransport | null | undefined;
let productionTransport: AuthMailerTransport | null = config.NODE_ENV === 'test'
    ? null
    : createProductionTransport();
const testGlobals = globalThis as typeof globalThis & { __hqTestMailerTransport?: AuthMailerTransport | null };

/** Test-only seam; production always uses the original config-backed SMTP transport. */
export function installMailerTestTransport(transport: AuthMailerTransport | null): void {
    if (config.NODE_ENV !== 'test') throw new Error('Mailer test transport is available only in test mode');
    testTransport = transport;
}

function getTransport(): AuthMailerTransport | null {
    if (config.NODE_ENV === 'test') {
        return testTransport !== undefined ? testTransport : testGlobals.__hqTestMailerTransport ?? null;
    }
    return productionTransport;
}

function createProductionTransport(): AuthMailerTransport | null {
    return createAuthMailerTransport(config, (options) => nodemailer.createTransport(options));
}

/** Build the auth transport with an explicit TLS policy; injectable for tests. */
export function createAuthMailerTransport(
    settings: AuthMailerSmtpSettings,
    createTransport: (options: AuthMailerTransportOptions) => AuthMailerTransport =
        (options) => nodemailer.createTransport(options),
): AuthMailerTransport | null {
    if (!settings.SMTP_HOST) return null;
    if (!settings.SMTP_TLS_MODE || settings.SMTP_SECURE !== (settings.SMTP_TLS_MODE === 'implicit')) {
        throw new Error('SMTP TLS configuration is invalid');
    }
    return createTransport({
        host: settings.SMTP_HOST,
        port: settings.SMTP_PORT,
        secure: settings.SMTP_TLS_MODE === 'implicit',
        requireTLS: settings.SMTP_TLS_MODE === 'starttls',
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        tls: { rejectUnauthorized: true },
        ...(settings.SMTP_USER && settings.SMTP_PASSWORD
            ? { auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD } }
            : {}),
    });
}

async function sendSafely(transport: AuthMailerTransport, message: SendMailOptions): Promise<void> {
    try {
        await transport.sendMail(message);
    } catch (error) {
        throw new Error(`SMTP delivery failed (${safeSmtpFailureCode(error)})`);
    }
}

function safeSmtpFailureCode(error: unknown): string {
    const candidate = error !== null && typeof error === 'object'
        ? error as { code?: unknown; responseCode?: unknown }
        : {};
    const code = typeof candidate.code === 'string' ? candidate.code.toUpperCase() : '';
    if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) return 'smtp_timeout';
    if (['ETLS', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) {
        return 'smtp_tls_failed';
    }
    if (['ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)) {
        return 'smtp_connection_failed';
    }
    if (code === 'EAUTH') return 'smtp_authentication_failed';
    if (typeof candidate.responseCode === 'number') {
        return candidate.responseCode >= 500 ? 'smtp_permanent_rejection'
            : candidate.responseCode >= 400 ? 'smtp_temporary_rejection' : 'smtp_send_failed';
    }
    return 'smtp_send_failed';
}

export function isEmailDeliveryConfigured(): boolean {
    return getTransport() !== null;
}

export async function sendPasswordResetEmail(input: {
    recipient: string;
    fullName: string;
    resetUrl: string;
}): Promise<void> {
    const transporter = getTransport();
    if (!transporter) throw new Error('SMTP is not configured');
    const safeName = escapeHtml(input.fullName);
    const safeUrl = escapeHtml(input.resetUrl);
    await sendSafely(transporter, {
        from: config.MAIL_FROM,
        to: input.recipient,
        subject: 'Reset your password',
        html: `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#172554;max-width:600px;margin:auto">
          <h2>Reset your password</h2>
          <p>Hello ${safeName},</p>
          <p>Use the link below to choose a new password. It expires in 30 minutes and can only be used once.</p>
          <p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#1769C4;color:#fff;text-decoration:none;border-radius:8px">Reset password</a></p>
          <p>If you did not request this, you can ignore this email.</p>
        </div>`,
    });
}

export async function sendEmailVerificationCode(input: {
    recipient: string;
    fullName: string;
    code: string;
}): Promise<{ sent: boolean; reason?: string }> {
    const transporter = getTransport();
    if (!transporter) return { sent: false, reason: 'SMTP is not configured' };
    const safeName = escapeHtml(input.fullName);
    const safeCode = escapeHtml(input.code);
    await sendSafely(transporter, {
        from: config.MAIL_FROM,
        to: input.recipient,
        subject: 'رمز تأكيد بريدك | Verify your email',
        html: `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#172554;max-width:600px;margin:auto">
          <h2>تأكيد بريدك الإلكتروني</h2>
          <p>مرحباً ${safeName}، استخدم الرمز التالي لتأكيد بريدك الإلكتروني في OmniHQ:</p>
          <p dir="ltr" style="font-size:28px;font-weight:bold;letter-spacing:8px">${safeCode}</p>
          <p>تنتهي صلاحية الرمز بعد 15 دقيقة. إذا لم تنشئ هذا الحساب، فتجاهل هذه الرسالة.</p>
          <hr><h2>Verify your email</h2>
          <p>Hello ${safeName}, use this code to verify your OmniHQ email address:</p>
          <p dir="ltr" style="font-size:28px;font-weight:bold;letter-spacing:8px">${safeCode}</p>
          <p>This code expires in 15 minutes. If you did not create this account, you can ignore this email.</p>
        </div>`,
    });
    return { sent: true };
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]!);
}

function decisionHtml(status: BusinessDecisionEmail['status'], businessName: string, reason: string): string {
    const safeName = escapeHtml(businessName);
    const safeReason = escapeHtml(reason);
    if (status === 'active') {
        return `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#172554">
          <h2>تم اعتماد نشاطك التجاري</h2><p>مرحباً ${safeName}،</p>
          <p>يسعدنا إبلاغك بأنه تمت الموافقة على نشاطك وأصبح ظاهراً في دليل OmniHQ.</p>
          <hr><h2>Your business is approved</h2><p>Hello ${safeName},</p>
          <p>Your business has been approved and is now listed in the OmniHQ directory.</p>
        </div>`;
    }
    if (status === 'pending') {
        return `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#172554">
          <h2>تمت إعادة طلب نشاطك للمراجعة</h2><p>مرحباً ${safeName}،</p>
          <p>أُعيد طلب إدراج نشاطك إلى قائمة المراجعة. سيبقى غير ظاهر في الدليل حتى انتهاء المراجعة.</p>
          <hr><h2>Your business is back under review</h2><p>Hello ${safeName},</p>
          <p>Your business listing has been returned to the review queue. It will remain hidden until the review is complete.</p>
        </div>`;
    }
    return `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#172554">
      <h2>تحديث طلب إدراج نشاطك</h2><p>مرحباً ${safeName}،</p>
      <p>نأسف لإبلاغك بأنه لم تتم الموافقة على طلب الإدراج حالياً.</p>
      ${safeReason ? `<p><strong>السبب:</strong> ${safeReason}</p>` : ''}
      <hr><h2>Business listing update</h2><p>Hello ${safeName},</p>
      <p>Unfortunately, we could not approve your business listing at this time.</p>
      ${safeReason ? `<p><strong>Reason:</strong> ${safeReason}</p>` : ''}
    </div>`;
}

/** SMTP failures are returned to the caller without undoing the committed decision. */
export async function sendBusinessDecisionEmail(
    decision: BusinessDecisionEmail,
): Promise<{ sent: boolean; reason?: string }> {
    if (!decision.recipient) return { sent: false, reason: 'No recipient email address' };
    const transporter = getTransport();
    if (!transporter) return { sent: false, reason: 'SMTP is not configured' };

    await sendSafely(transporter, {
        from: config.MAIL_FROM,
        to: decision.recipient,
        subject: decision.status === 'active'
            ? 'تم اعتماد نشاطك | Your business is approved'
            : decision.status === 'pending'
                ? 'طلبك قيد المراجعة | Your business is under review'
                : 'تحديث طلبك | Business listing update',
        html: decisionHtml(decision.status, decision.businessName, decision.reason ?? ''),
    });
    return { sent: true };
}
