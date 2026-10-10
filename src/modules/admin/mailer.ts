import nodemailer from 'nodemailer';
import { config } from '../../config.js';

export interface BusinessDecisionEmail {
    businessName: string;
    recipient: string | null;
    status: 'active' | 'rejected';
    reason?: string | null;
}

const transporter = config.SMTP_HOST
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        ...(config.SMTP_USER && config.SMTP_PASSWORD
            ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
            : {}),
    })
    : null;

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
    if (!transporter) return { sent: false, reason: 'SMTP is not configured' };

    await transporter.sendMail({
        from: config.MAIL_FROM,
        to: decision.recipient,
        subject: decision.status === 'active'
            ? 'تم اعتماد نشاطك | Your business is approved'
            : 'تحديث طلبك | Business listing update',
        html: decisionHtml(decision.status, decision.businessName, decision.reason ?? ''),
    });
    return { sent: true };
}
