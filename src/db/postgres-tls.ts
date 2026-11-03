import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import type { ConnectionOptions } from 'node:tls';

export type PostgresTlsMode = 'disable' | 'verify-full' | undefined;
export type PostgresTlsOptions = false | Pick<ConnectionOptions, 'ca' | 'rejectUnauthorized'>;
type CaReader = (path: string) => string;

/**
 * Creates the node-postgres SSL option from the explicit runtime policy.
 * PostgreSQL connection settings use host/port fields (not connection-string
 * SSL query parameters), avoiding pg's connection-string SSL option precedence.
 */
export function createPostgresTlsOptions(
    mode: PostgresTlsMode,
    caFile?: string,
    readCa: CaReader = (path) => readFileSync(path, 'utf8'),
): PostgresTlsOptions {
    if (mode === 'disable' || mode === undefined) {
        if (caFile) throw new Error('PG_SSL_CA_FILE requires PG_TLS_MODE=verify-full');
        return false;
    }
    if (mode !== 'verify-full') throw new Error('PG_TLS_MODE must be disable or verify-full');

    if (!caFile) return { rejectUnauthorized: true };

    let ca: string;
    try {
        ca = readCa(caFile);
    } catch {
        throw new Error('PG_SSL_CA_FILE could not be read');
    }
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '').trim()) {
        throw new Error('PG_SSL_CA_FILE must contain a PEM certificate');
    }
    try {
        for (const certificate of certificates) new X509Certificate(certificate);
    } catch {
        throw new Error('PG_SSL_CA_FILE must contain a valid PEM certificate');
    }
    return { rejectUnauthorized: true, ca };
}
