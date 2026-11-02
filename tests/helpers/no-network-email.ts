import 'dotenv/config';
import nodemailer from 'nodemailer';
import net from 'node:net';
import assert from 'node:assert/strict';

process.env['NODE_ENV'] = 'test';

let realTransportAttempts = 0;
const originalCreateTransport = nodemailer.createTransport;
nodemailer.createTransport = ((..._args: Parameters<typeof originalCreateTransport>) => {
    realTransportAttempts++;
    throw new Error('real SMTP transport creation blocked in tests');
}) as typeof originalCreateTransport;

const originalSocketConnect = net.Socket.prototype.connect;
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const first = args[0] as { host?: unknown; path?: unknown } | number | string | undefined;
    const host = typeof first === 'object' && first !== null
        ? (typeof first.host === 'string' ? first.host : undefined)
        : typeof args[1] === 'string' ? args[1] : undefined;
    const path = typeof first === 'object' && first !== null
        ? first.path
        : typeof first === 'string' ? first : undefined;
    if (path === undefined && !loopbackHosts.has((host ?? 'localhost').toLowerCase())) {
        throw new Error('external network connections are blocked in tests');
    }
    return (originalSocketConnect as (...parameters: unknown[]) => net.Socket).apply(this, args);
} as typeof originalSocketConnect;

// Prove the guard rejects an external TCP destination before calling the
// operating system; local test servers and the loopback PostgreSQL remain usable.
assert.throws(
    () => new net.Socket().connect(25, 'smtp.example.test'),
    /external network connections are blocked in tests/,
);

const testGlobals = globalThis as typeof globalThis & {
    __hqTestMailerTransport?: { sendMail(message: unknown): Promise<unknown> } | null;
};
const fakeTransport = { sendMail: async (_message: unknown) => ({ accepted: [] }) };
testGlobals.__hqTestMailerTransport = fakeTransport;

export function getRealSmtpTransportAttempts(): number {
    return realTransportAttempts;
}

export function assertNoRealSmtpTransport(): void {
    if (realTransportAttempts !== 0) {
        throw new Error(`Real SMTP transport attempts were blocked (${realTransportAttempts})`);
    }
}

export function disableAuthEmailTransport(): void {
    testGlobals.__hqTestMailerTransport = null;
}

export function restoreAuthEmailTransport(): void {
    testGlobals.__hqTestMailerTransport = fakeTransport;
}
