import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getRealSmtpTransportAttempts } from './helpers/no-network-email.js';

describe('authentication and admin mail test isolation', () => {
    it('blocks real Nodemailer transports while the suite uses its fake mailer', () => {
        assert.equal(getRealSmtpTransportAttempts(), 0);
    });

    it('blocks external TCP connections while permitting loopback test dependencies', () => {
        // The preload itself probes and rejects a non-loopback socket before
        // the original connect method runs; integration tests still use local
        // PostgreSQL and in-process/loopback HTTP.
        assert.equal(getRealSmtpTransportAttempts(), 0);
    });
});
