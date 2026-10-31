process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'authentication-status-test-secret-long-enough';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;
let signAccessToken: typeof import('../src/middleware/auth.js').signAccessToken;
let config: typeof import('../src/config.js').config;

async function createUser(
    email: string,
    status: 'active' | 'pending' | 'suspended' | 'deleted',
): Promise<{ id: number; token: string }> {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const { rows } = await adminPool.query<{ user_id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, $4::user_status)
         RETURNING user_id`,
        [email, passwordHash, email, status],
    );
    const id = Number(rows[0]!.user_id);
    return {
        id,
        token: signAccessToken({
            id,
            email,
            isPlatformAdmin: false,
            token_version: 0,
        }),
    };
}

before(async () => {
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const authModule = await import('../src/middleware/auth.js');
    signAccessToken = authModule.signAccessToken;
    ({ config } = await import('../src/config.js'));
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);
    app = (await import('../src/app.js')).createApp();
});

after(async () => {
    await closePools?.();
});

describe('JWT account status authorization', () => {
    it('allows an active user with a valid previously issued JWT', async () => {
        const user = await createUser('auth-status-active@hq.test', 'active');
        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${user.token}`);

        assert.equal(response.status, 200, JSON.stringify(response.body));
    });

    it('blocks a suspended account on the protected /api/auth/me route with a previously valid JWT', async () => {
        const user = await createUser('auth-status-suspended@hq.test', 'suspended');
        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${user.token}`);

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, 'UNAUTHORIZED');
        assert.equal(response.body.error.message, 'Session revoked');
    });

    it('rejects an inactive-style pending user with a previously valid JWT', async () => {
        const user = await createUser('auth-status-inactive@hq.test', 'pending');
        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${user.token}`);

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, 'UNAUTHORIZED');
    });

    it('rejects a deleted user with a previously valid JWT', async () => {
        const user = await createUser('auth-status-deleted@hq.test', 'deleted');
        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${user.token}`);

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, 'UNAUTHORIZED');
    });

    it('rejects an old JWT after the user account is deleted', async () => {
        const user = await createUser('auth-status-row-deleted@hq.test', 'active');
        await adminPool.query(`DELETE FROM users WHERE user_id = $1`, [user.id]);

        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${user.token}`);

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, 'UNAUTHORIZED');
        assert.equal(response.body.error.message, 'Session revoked');
    });

    it('rejects an account after its status changes from active', async () => {
        const user = await createUser('auth-status-transition@hq.test', 'active');
        await adminPool.query(`UPDATE users SET status = 'suspended' WHERE user_id = $1`, [user.id]);

        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${user.token}`);

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, 'UNAUTHORIZED');
    });

    it('rejects an expired JWT', async () => {
        const expired = jwt.sign(
            { sub: '999999999', email: 'expired@hq.test', pa: false, token_version: 0 },
            config.JWT_SECRET,
            { expiresIn: -1 },
        );
        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${expired}`);

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, 'UNAUTHORIZED');
    });

    it('rejects an invalid JWT signature', async () => {
        const invalid = jwt.sign(
            { sub: '999999999', email: 'invalid@hq.test', pa: false, token_version: 0 },
            'different-signing-secret-that-is-long-enough',
        );
        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${invalid}`);

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, 'UNAUTHORIZED');
    });

    it('rejects a token after token_version is revoked', async () => {
        const user = await createUser('auth-status-revoked@hq.test', 'active');
        await adminPool.query(`UPDATE users SET token_version = token_version + 1 WHERE user_id = $1`, [user.id]);

        const response = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${user.token}`);

        assert.equal(response.status, 401);
        assert.equal(response.body.error.message, 'Session revoked');
    });

    it('preserves active Platform Admin behavior', async () => {
        const user = await createUser('auth-status-admin@hq.test', 'active');
        const { rows } = await adminPool.query<{ role_id: string }>(
            `SELECT role_id FROM roles WHERE role_key = 'platform_admin' AND scope = 'platform'`,
        );
        await adminPool.query(
            `INSERT INTO user_platform_roles (user_id, role_id) VALUES ($1, $2)`,
            [user.id, rows[0]!.role_id],
        );
        const token = signAccessToken({
            id: user.id,
            email: 'auth-status-admin@hq.test',
            isPlatformAdmin: true,
            token_version: 0,
        });

        const response = await request(app)
            .get('/api/admin/businesses')
            .set('Authorization', `Bearer ${token}`);

        assert.equal(response.status, 200, JSON.stringify(response.body));
    });

    it('preserves no-token optional authentication for public routes', async () => {
        const response = await request(app).get('/api/payments/methods');
        assert.equal(response.status, 200);
    });

    it('handles invalid and unauthorized optional tokens anonymously and safely', async () => {
        const unauthorizedUser = await createUser('auth-status-optional@hq.test', 'suspended');
        const invalidSignature = jwt.sign(
            { sub: String(unauthorizedUser.id), email: unauthorizedUser.token, pa: false, token_version: 0 },
            'another-different-signing-secret-long-enough',
        );

        const suspended = await request(app)
            .get('/api/payments/methods')
            .set('Authorization', `Bearer ${unauthorizedUser.token}`);
        const invalid = await request(app)
            .get('/api/payments/methods')
            .set('Authorization', `Bearer ${invalidSignature}`);

        assert.equal(suspended.status, 200);
        assert.equal(invalid.status, 200);
    });
});
