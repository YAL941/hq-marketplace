import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;

function headerValue(
    headers: Record<string, string | string[] | undefined>,
    name: string,
): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

export function createWebhookSignature(secret: string, timestamp: string, rawBody: Buffer): string {
    return createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex');
}

export function verifyWebhookSignature(
    secret: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
    nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
    const timestamp = headerValue(headers, 'x-mock-timestamp');
    const signature = headerValue(headers, 'x-mock-signature');
    if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || !SIGNATURE_PATTERN.test(signature)) return false;

    const timestampNumber = Number(timestamp);
    if (!Number.isSafeInteger(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > MAX_TIMESTAMP_AGE_SECONDS) {
        return false;
    }

    const expected = Buffer.from(createWebhookSignature(secret, timestamp, rawBody), 'hex');
    const actual = Buffer.from(signature, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
