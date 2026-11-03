import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { rootCertificates } from 'node:tls';
import { Client } from 'pg';
import { describe, it } from 'node:test';
import { createPostgresTlsOptions } from '../src/db/postgres-tls.js';

const testCertificate = rootCertificates[0];
assert.ok(testCertificate, 'Node test runtime must provide a CA certificate fixture');

describe('PostgreSQL TLS configuration', () => {
    it('enables certificate verification for verify-full', () => {
        assert.deepEqual(createPostgresTlsOptions('verify-full'), { rejectUnauthorized: true });
    });

    it('uses a configured PEM CA without disabling certificate verification', () => {
        const options = createPostgresTlsOptions('verify-full', '/protected/db-ca.pem', () => testCertificate);
        assert.deepEqual(options, { rejectUnauthorized: true, ca: testCertificate });
    });

    it('rejects unavailable, empty, or invalid CA files without exposing path or contents', () => {
        const secretPath = '/protected/private-ca.pem';
        const secretContent = 'private certificate contents';
        assert.throws(
            () => createPostgresTlsOptions('verify-full', secretPath, () => { throw new Error(secretContent); }),
            (error: unknown) => {
                assert.equal((error as Error).message, 'PG_SSL_CA_FILE could not be read');
                assert.doesNotMatch((error as Error).message, /private|protected/);
                return true;
            },
        );
        for (const value of ['', secretContent, '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----']) {
            assert.throws(
                () => createPostgresTlsOptions('verify-full', secretPath, () => value),
                /PG_SSL_CA_FILE must contain (a PEM|a valid PEM) certificate/,
            );
        }
    });

    it('keeps local development explicitly configurable without TLS', () => {
        assert.equal(createPostgresTlsOptions('disable'), false);
        assert.equal(createPostgresTlsOptions(undefined), false);
    });

    it('rejects a CA file when TLS is disabled', () => {
        assert.throws(() => createPostgresTlsOptions('disable', '/protected/db-ca.pem'), /requires PG_TLS_MODE/);
    });

    it('does not fall back to plaintext when a local server refuses SSL', async () => {
        let plaintextStartupObserved = false;
        const server = net.createServer((socket) => {
            socket.once('data', (request) => {
                assert.equal(request.length, 8);
                assert.equal(request.readInt32BE(0), 8);
                assert.equal(request.readInt32BE(4), 80_877_103); // PostgreSQL SSLRequest code.
                socket.write('N');
                socket.once('data', () => { plaintextStartupObserved = true; });
            });
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        assert.ok(address && typeof address !== 'string');

        const client = new Client({
            host: '127.0.0.1',
            port: address.port,
            database: 'tls_test',
            user: 'tls_test',
            password: 'test-only',
            ssl: createPostgresTlsOptions('verify-full'),
            connectionTimeoutMillis: 1_000,
        });
        try {
            await assert.rejects(client.connect());
            await new Promise((resolve) => setTimeout(resolve, 25));
            assert.equal(plaintextStartupObserved, false);
        } finally {
            await client.end().catch(() => undefined);
            server.close();
            await once(server, 'close');
        }
    });
});
