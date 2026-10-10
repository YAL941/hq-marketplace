process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';
import assertModule from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
const assert = assertModule;
let app;
let adminPool;
let closePools;
before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
});
after(async () => {
    await closePools?.();
});
describe('password recovery', () => {
    it('returns a generic response for an unknown email', async () => {
        const response = await request(app)
            .post('/api/auth/password-reset/request')
            .send({ email: 'not-registered@hq.test' });
        assert.equal(response.status, 200);
        assert.match(response.body.data.message, /If an active account/);
    });
    it('updates a password once with a valid one-time token', async () => {
        const email = `password-reset-${randomBytes(6).toString('hex')}@hq.test`;
        const oldPassword = 'OriginalPassword123!';
        const newPassword = 'ReplacementPassword123!';
        const registration = await request(app)
            .post('/api/auth/register')
            .send({ email, password: oldPassword, fullName: 'Reset Test User' });
        assert.equal(registration.status, 201, JSON.stringify(registration.body));
        const rawToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(rawToken).digest('hex');
        await adminPool.query(`INSERT INTO user_password_reset_tokens (token_hash, user_id, expires_at)
             VALUES ($1, $2, now() + interval '30 minutes')`, [tokenHash, registration.body.data.user.user_id]);
        const reset = await request(app)
            .post('/api/auth/password-reset/confirm')
            .send({ token: rawToken, password: newPassword });
        assert.equal(reset.status, 200, JSON.stringify(reset.body));
        const reused = await request(app)
            .post('/api/auth/password-reset/confirm')
            .send({ token: rawToken, password: 'ThirdPassword123!' });
        assert.equal(reused.status, 400);
        const oldLogin = await request(app)
            .post('/api/auth/login')
            .send({ identifier: email, password: oldPassword });
        assert.equal(oldLogin.status, 401);
        const newLogin = await request(app)
            .post('/api/auth/login')
            .send({ identifier: email, password: newPassword });
        assert.equal(newLogin.status, 200, JSON.stringify(newLogin.body));
    });
});
//# sourceMappingURL=password-reset.test.js.map