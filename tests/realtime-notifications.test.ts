process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? '979cd78027cc4346a75f453799aea1590e8a9d4b7fb84612bd6f35f6db3f14da';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createServer } from 'http';
import type { PoolClient } from 'pg';
import type { Response as ExpressResponse } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { realtimeService } from '../src/modules/realtime/realtime.service.js';
import { realtimeDispatcher } from '../src/modules/realtime/realtime.dispatcher.js';

type App = import('express').Express;
    let app: App;
    let adminPool: import('pg').Pool;
    let closePools: () => Promise<void>;
    let sellerBusinessId: number;
    let buyerBusinessId: number;
    let outsiderBusinessId: number;
    let noviewBusinessId: number;
    let sellerUserId: number;
    let buyerUserId: number;
    let sellerToken: string;
    let buyerToken: string;
    let outsiderToken: string;
    let noWholesaleViewToken: string;
let offerId: number;
let buyerProductId: number;

interface SseConnection {
    controller: AbortController;
    response: Response;
    reader: ReadableStreamDefaultReader<Uint8Array>;
}

before(async () => {
    app = (await import('../src/app.js')).createApp({ trustProxyHops: 0 });
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool);

    const { rows: users } = await adminPool.query(
        "INSERT INTO users (email, password_hash, full_name, status) VALUES ('sse-seller@hq.test','unused','SSE Seller','active'),('sse-buyer@hq.test','unused','SSE Buyer','active'),('sse-outsider@hq.test','unused','SSE Outsider','active'),('sse-noview@hq.test','unused','SSE NoView','active') RETURNING user_id, email",
    );
    const userIds = new Map((users as any[]).map((row) => [row.email, Number(row.user_id)]));
    sellerUserId = userIds.get('sse-seller@hq.test')!;
    buyerUserId = userIds.get('sse-buyer@hq.test')!;
    const { signAccessToken } = await import('../src/middleware/auth.js');
    sellerToken = signAccessToken({ id: userIds.get('sse-seller@hq.test')!, email: 'sse-seller@hq.test', isPlatformAdmin: false, token_version: 0 });
    buyerToken = signAccessToken({ id: userIds.get('sse-buyer@hq.test')!, email: 'sse-buyer@hq.test', isPlatformAdmin: false, token_version: 0 });
    outsiderToken = signAccessToken({ id: userIds.get('sse-outsider@hq.test')!, email: 'sse-outsider@hq.test', isPlatformAdmin: false, token_version: 0 });
    noWholesaleViewToken = signAccessToken({ id: userIds.get('sse-noview@hq.test')!, email: 'sse-noview@hq.test', isPlatformAdmin: false, token_version: 0 });

    const { rows: businesses } = await adminPool.query(
        "INSERT INTO businesses (business_name,business_slug,address,city,status,verification_status,is_verified,verified_at) VALUES ('SSE Seller','sse-seller','a','M','active','verified',TRUE,now()),('SSE Buyer','sse-buyer','a','M','active','verified',TRUE,now()),('SSE Outsider','sse-outsider','a','M','active','verified',TRUE,now()),('SSE NoView','sse-noview','a','M','active','verified',TRUE,now()) RETURNING business_id,business_slug",
    );
    const businessIds = new Map((businesses as any[]).map((row) => [row.business_slug, Number(row.business_id)]));
    sellerBusinessId = businessIds.get('sse-seller')!;
    buyerBusinessId = businessIds.get('sse-buyer')!;
    outsiderBusinessId = businessIds.get('sse-outsider')!;
    noviewBusinessId = businessIds.get('sse-noview')!;

    await adminPool.query(
        "INSERT INTO roles (role_key, role_name, description, scope, rank, is_system) VALUES ('test_no_wholesale_view', 'Test No Wholesale View', 'Test role without Wholesale permissions', 'business', 1, FALSE) ON CONFLICT (role_key, scope) DO NOTHING",
    );
    const { rows: roles } = await adminPool.query(
        "SELECT role_id, role_key FROM roles WHERE (scope='business' AND role_key IN ('business_owner', 'test_no_wholesale_view'))",
    );
    const roleIds = new Map((roles as any[]).map((row) => [row.role_key, Number(row.role_id)]));
    await adminPool.query(
        "INSERT INTO business_users (business_id,user_id,role_id,status,joined_at) VALUES ($1,$2,$3,'active',now()),($4,$5,$6,'active',now()),($7,$8,$9,'active',now()),($10,$11,$12,'active',now())",
        [sellerBusinessId, sellerUserId, roleIds.get('business_owner'), buyerBusinessId, buyerUserId, roleIds.get('business_owner'), outsiderBusinessId, userIds.get('sse-outsider@hq.test'), roleIds.get('business_owner'), noviewBusinessId, userIds.get('sse-noview@hq.test'), roleIds.get('test_no_wholesale_view')],
    );

    await adminPool.query(
        "INSERT INTO products (business_id,product_name,price,currency,status,is_stock_tracked) VALUES ($1,'SSE Supplier carton',12,'USD','active',TRUE),($2,'SSE Buyer item',12,'USD','active',TRUE)",
        [sellerBusinessId, buyerBusinessId],
    );

    await request(app).post('/api/business/' + sellerBusinessId + '/wholesale/supplier-application').set('Authorization', authorization(sellerToken)).send({ description: 'x' });
    const { rows: adminUsers } = await adminPool.query("SELECT user_id FROM users WHERE email='sse-admin2@hq.test'");
    let adminTokenLocal: string;
    if (adminUsers.length === 0) {
        const { rows: newAdmin } = await adminPool.query("INSERT INTO users (email,password_hash,full_name,status) VALUES ('sse-admin2@hq.test','unused','SSE Admin','active') RETURNING user_id");
        const { rows: proles } = await adminPool.query("SELECT role_id FROM roles WHERE scope='platform' AND role_key='platform_admin'");
        await adminPool.query("INSERT INTO user_platform_roles (user_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [newAdmin[0].user_id, proles[0].role_id]);
        adminTokenLocal = signAccessToken({ id: newAdmin[0].user_id, email: 'sse-admin2@hq.test', isPlatformAdmin: true, token_version: 0 });
    } else {
        adminTokenLocal = signAccessToken({ id: adminUsers[0].user_id, email: 'sse-admin2@hq.test', isPlatformAdmin: true, token_version: 0 });
    }
    await request(app).patch('/api/admin/wholesale/suppliers/' + sellerBusinessId).set('Authorization', authorization(adminTokenLocal)).send({ status: 'approved' });

    const { rows: sellerProducts } = await adminPool.query("SELECT product_id FROM products WHERE business_id=$1 LIMIT 1", [sellerBusinessId]);
    const offerRes = await request(app).post('/api/business/' + sellerBusinessId + '/wholesale/offers').set('Authorization', authorization(sellerToken)).send({ productId: Number(sellerProducts[0].product_id), wholesalePrice: 10, currency: 'USD', minimumOrderQuantity: 5, availableQuantity: 25, tiers: [] });
    offerId = Number(offerRes.body.data.offer_id);
    const { rows: buyerProducts } = await adminPool.query("SELECT product_id FROM products WHERE business_id=$1 LIMIT 1", [buyerBusinessId]);
    buyerProductId = Number(buyerProducts[0].product_id);
});

after(async () => {
    await closePools?.();
});

function authorization(token: string): string {
    return ['Bearer', token].join(' ');
}

async function openSse(baseUrl: string, businessId: number, token: string, lastEventId?: string): Promise<SseConnection> {
    const controller = new AbortController();
    const headers: Record<string, string> = {
        'Authorization': authorization(token),
        'Accept': 'text/event-stream',
    };
    if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId;
    const response = await fetch(baseUrl + '/api/business/' + businessId + '/notifications/stream', {
        method: 'GET',
        headers,
        signal: controller.signal,
    });
    if (!response.body) throw new Error('no body');
    return { controller, response, reader: response.body.getReader() };
}

async function closeSse(connection: SseConnection | undefined): Promise<void> {
    if (!connection) return;
    connection.controller.abort();
    try { await connection.reader.cancel(); } catch {}
    try { connection.reader.releaseLock(); } catch {}
    try { await connection.response.body?.cancel(); } catch {}
}

async function receivesTextWithContent(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string, timeoutMs: number): Promise<string> {
    const decoder = new TextDecoder();
    let received = '';
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            (async () => {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        received += decoder.decode(value);
                        if (received.includes(expected)) break;
                    }
                }
                return received;
            })(),
            new Promise<string>((resolve) => { timeout = setTimeout(() => resolve(received), timeoutMs); }),
        ]);
        return result;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return received;
        throw error;
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

interface SseFrame {
    id?: string;
    event: string;
    data: string;
}

async function receiveSseEvents(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    eventType: string,
    count: number,
    timeoutMs: number,
): Promise<SseFrame[]> {
    const decoder = new TextDecoder();
    const frames: SseFrame[] = [];
    const deadline = Date.now() + timeoutMs;
    let buffer = '';

    while (frames.length < count) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
            reader.read().then((value) => ({ kind: 'read' as const, value })),
            new Promise<{ kind: 'timeout' }>((resolve) => {
                timeout = setTimeout(() => resolve({ kind: 'timeout' }), remaining);
            }),
        ]);
        if (timeout) clearTimeout(timeout);
        if (result.kind === 'timeout' || result.value.done) break;
        if (!result.value.value) continue;

        buffer += decoder.decode(result.value.value, { stream: true });
        let separator = buffer.indexOf('\n\n');
        while (separator !== -1) {
            const block = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            let id: string | undefined;
            let currentEvent = 'message';
            const data: string[] = [];
            for (const line of block.split(/\r?\n/)) {
                if (line.startsWith('id:')) id = line.slice(3).trim();
                else if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
                else if (line.startsWith('data:')) data.push(line.slice(5).trim());
            }
            if (currentEvent === eventType) frames.push({ id, event: currentEvent, data: data.join('\n') });
            if (frames.length === count) break;
            separator = buffer.indexOf('\n\n');
        }
    }

    return frames;
}

async function createRfq(): Promise<number> {
    const response = await request(app)
        .post('/api/business/' + buyerBusinessId + '/wholesale/rfqs')
        .set('Authorization', authorization(buyerToken))
        .send({
            supplierBusinessId: sellerBusinessId,
            items: [{ offerId, buyerProductId, quantity: 5 }],
        });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return Number(response.body.data.rfqId ?? response.body.data.rfq_id);
}

async function latestNotificationId(userId: number, businessId: number): Promise<string> {
    const { rows } = await adminPool.query<{ notification_id: string }>(
        `SELECT COALESCE(MAX(notification_id), 0)::TEXT AS notification_id
           FROM in_app_notifications
          WHERE recipient_user_id = $1 AND business_id = $2`,
        [userId, businessId],
    );
    return rows[0]!.notification_id;
}

describe('SSE Phase A', () => {
    it('open SSE and receive first frame', async () => {
        const server = createServer(app);
        const baseUrl = await new Promise<string>((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                const addr = server.address();
                const port = typeof addr === 'object' && addr ? addr.port : 0;
                resolve('http://127.0.0.1:' + port);
            });
        });
        try {
            const connection = await openSse(baseUrl, sellerBusinessId, sellerToken);
            const text = await receivesTextWithContent(connection.reader, 'ping', 2000);
            assert.ok(text.includes('ping'));
            await closeSse(connection);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});

describe('SSE route ordering regression', () => {
    it('GET /api/business/:businessId/notifications/stream does not go through :notificationId validation', async () => {
        const httpServer = createServer(app);
        const baseUrl = await new Promise<string>((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => {
                const addr = httpServer.address();
                const port = typeof addr === 'object' && addr ? addr.port : 0;
                resolve('http://127.0.0.1:' + port);
            });
        });
        let connection: SseConnection | undefined;
        try {
            connection = await openSse(baseUrl, sellerBusinessId, sellerToken);
            const text = await receivesTextWithContent(connection.reader, 'ping', 2000);
            assert.ok(text.includes('ping'));
        } finally {
            await closeSse(connection);
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        }
    });
});

describe('SSE Phase B - RFQ delivery', () => {
    it('delivers RFQ created event to supplier SSE connection', async () => {
        const httpServer = createServer(app);
        const baseUrl = await new Promise<string>((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => {
                const addr = httpServer.address();
                const port = typeof addr === 'object' && addr ? addr.port : 0;
                resolve('http://127.0.0.1:' + port);
            });
        });
        let connection: SseConnection | undefined;
        try {
            connection = await openSse(baseUrl, sellerBusinessId, sellerToken);
            await receivesTextWithContent(connection.reader, 'ping', 1000);
            const rfqRes = await request(app).post('/api/business/' + buyerBusinessId + '/wholesale/rfqs').set('Authorization', authorization(buyerToken)).send({ supplierBusinessId: sellerBusinessId, items: [{ offerId, buyerProductId, quantity: 5 }] });
            assert.equal(rfqRes.status, 201);
            const createdRfqId = rfqRes.body.data.rfqId ?? rfqRes.body.data.rfq_id;
            const [frame] = await receiveSseEvents(connection.reader, 'notification', 1, 5000);
            assert.ok(frame);
            const payload = JSON.parse(frame.data) as { eventType: string; targetId: number | string };
            assert.equal(payload.eventType, 'wholesale.rfq.created');
            assert.equal(Number(payload.targetId), Number(createdRfqId));
            assert.equal(Number(frame.id), Number((await adminPool.query(
                'SELECT notification_id FROM in_app_notifications WHERE recipient_user_id = $1 AND target_id = $2 ORDER BY notification_id DESC LIMIT 1',
                [sellerUserId, createdRfqId],
            )).rows[0]?.notification_id));
        } finally {
            await closeSse(connection);
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        }
    });
});

        describe('SSE Last-Event-ID replay', () => {
            it('replays two missed notifications once with matching notification ids and target ids', async () => {
                const httpServer = createServer(app);
                const baseUrl = await new Promise<string>((resolve) => {
                    httpServer.listen(0, '127.0.0.1', () => {
                        const addr = httpServer.address();
                        const port = typeof addr === 'object' && addr ? addr.port : 0;
                        resolve('http://127.0.0.1:' + port);
                    });
                });
                const cursor = await latestNotificationId(sellerUserId, sellerBusinessId);
                const missedRfqIds = [await createRfq(), await createRfq()];
                const { rows: expectedNotifications } = await adminPool.query<{
                    notification_id: string;
                    target_id: string;
                }>(
                    `SELECT notification_id::TEXT, target_id::TEXT
                       FROM in_app_notifications
                      WHERE recipient_user_id = $1
                        AND business_id = $2
                        AND target_id = ANY($3::BIGINT[])
                      ORDER BY notification_id`,
                    [sellerUserId, sellerBusinessId, missedRfqIds],
                );
                assert.equal(expectedNotifications.length, 2);

                let connection: SseConnection | undefined;
                try {
                    connection = await openSse(baseUrl, sellerBusinessId, sellerToken, cursor);
                    const frames = await receiveSseEvents(connection.reader, 'notification', 2, 3000);
                    assert.deepEqual(frames.map((frame) => frame.id), expectedNotifications.map((row) => row.notification_id));
                    assert.equal(new Set(frames.map((frame) => frame.id)).size, 2);
                    assert.deepEqual(
                        frames.map((frame) => Number((JSON.parse(frame.data) as { targetId: number }).targetId)),
                        expectedNotifications.map((row) => Number(row.target_id)),
                    );
                    assert.deepEqual(
                        frames.map((frame) => Number((JSON.parse(frame.data) as { targetId: number }).targetId)),
                        missedRfqIds,
                    );
                } finally {
                    await closeSse(connection);
                    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
                }
            });

            it('does not replay another business notification to an unrelated business', async () => {
                const httpServer = createServer(app);
                const baseUrl = await new Promise<string>((resolve) => {
                    httpServer.listen(0, '127.0.0.1', () => {
                        const addr = httpServer.address();
                        const port = typeof addr === 'object' && addr ? addr.port : 0;
                        resolve('http://127.0.0.1:' + port);
                    });
                });
                const cursor = await latestNotificationId(sellerUserId, sellerBusinessId);
                await createRfq();
                let connection: SseConnection | undefined;
                try {
                    connection = await openSse(baseUrl, outsiderBusinessId, outsiderToken, cursor);
                    const frames = await receiveSseEvents(connection.reader, 'notification', 1, 300);
                    assert.deepEqual(frames, []);
                } finally {
                    await closeSse(connection);
                    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
                }
            });

            it('ignores a malformed cursor and continues with only new live events', async () => {
                const httpServer = createServer(app);
                const baseUrl = await new Promise<string>((resolve) => {
                    httpServer.listen(0, '127.0.0.1', () => {
                        const addr = httpServer.address();
                        const port = typeof addr === 'object' && addr ? addr.port : 0;
                        resolve('http://127.0.0.1:' + port);
                    });
                });
                await createRfq();
                let connection: SseConnection | undefined;
                try {
                    connection = await openSse(baseUrl, sellerBusinessId, sellerToken, 'not-a-positive-integer');
                    const createdRfqId = await createRfq();
                    const [frame] = await receiveSseEvents(connection.reader, 'notification', 1, 3000);
                    assert.ok(frame);
                    const payload = JSON.parse(frame.data) as { targetId: number | string };
                    assert.equal(Number(payload.targetId), createdRfqId);
                } finally {
                    await closeSse(connection);
                    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
                }
            });

            it('requests a full refresh instead of sending a partial replay over the limit', async () => {
                const cursor = await latestNotificationId(sellerUserId, sellerBusinessId);
                await adminPool.query(
                    `WITH inserted_events AS (
                        INSERT INTO wholesale_events
                            (buyer_business_id, supplier_business_id, actor_user_id, entity_type, entity_id, event_type, details)
                        SELECT $1, $2, $3, 'rfq', 900000000 + series, 'rfq.created', '{}'::JSONB
                          FROM generate_series(1, 501) AS series
                        RETURNING event_id, entity_id
                    )
                    INSERT INTO in_app_notifications
                        (recipient_user_id, business_id, event_id, event_type, target_type, target_id, dedupe_key, metadata)
                    SELECT $4, $2, event_id, 'wholesale.rfq.created', 'rfq', entity_id,
                           'sse-overflow:' || event_id::TEXT, '{}'::JSONB
                      FROM inserted_events`,
                    [buyerBusinessId, sellerBusinessId, buyerUserId, sellerUserId],
                );

                const httpServer = createServer(app);
                const baseUrl = await new Promise<string>((resolve) => {
                    httpServer.listen(0, '127.0.0.1', () => {
                        const addr = httpServer.address();
                        const port = typeof addr === 'object' && addr ? addr.port : 0;
                        resolve('http://127.0.0.1:' + port);
                    });
                });
                let connection: SseConnection | undefined;
                try {
                    connection = await openSse(baseUrl, sellerBusinessId, sellerToken, cursor);
                    const [frame] = await receiveSseEvents(connection.reader, 'notifications.reset', 1, 3000);
                    assert.ok(frame);
                    assert.equal(frame.id, undefined);
                    assert.deepEqual(JSON.parse(frame.data), { reason: 'replay_limit_exceeded' });
                } finally {
                    await closeSse(connection);
                    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
                }
            });
        });

        describe('Realtime notification deduplication', () => {
            it('writes a notification once when replay and the live queue contain the same id', () => {
                const output: string[] = [];
                const clientId = 'replay-live-dedupe-test';
                const event = {
                    type: 'notification' as const,
                    businessId: sellerBusinessId,
                    userId: sellerUserId,
                    id: '910000000000000001',
                    data: { eventType: 'wholesale.rfq.created', targetId: 42 },
                };
                realtimeService.addClient({
                    id: clientId,
                    businessId: sellerBusinessId,
                    userId: sellerUserId,
                    res: {
                        write: (chunk: string) => {
                            output.push(chunk);
                            return true;
                        },
                    } as unknown as ExpressResponse,
                    catchingUp: true,
                    queuedEvents: [],
                    sentNotificationIds: new Set<string>(),
                });

                try {
                    realtimeService.broadcastToUser(sellerBusinessId, sellerUserId, event);
                    realtimeService.sendReplayEvent(clientId, event);
                    realtimeService.finishCatchUp(clientId);
                    assert.equal(output.length, 1);
                    assert.equal(output[0]?.startsWith(`id: ${event.id}\n`), true);
                } finally {
                    realtimeService.removeClient(clientId);
                }
            });
        });

        describe('Tenant post-commit realtime dispatch', () => {
            it('logs dispatch failures without rolling back or failing a committed transaction', async () => {
                const { appPool } = await import('../src/db/pool.js');
                const { ANONYMOUS, withTenant } = await import('../src/db/tenant.js');
                const originalConnect = appPool.connect;
                const originalDispatch = realtimeDispatcher.dispatch;
                const originalConsoleError = console.error;
                const statements: string[] = [];
                const logs: unknown[][] = [];
                const fakeClient = {
                    query: async (statement: string) => {
                        statements.push(statement);
                        return { rows: [] };
                    },
                    release: () => undefined,
                } as unknown as PoolClient;

                appPool.connect = (async () => fakeClient) as typeof appPool.connect;
                realtimeDispatcher.dispatch = (() => {
                    throw new Error('test dispatch failure');
                }) as typeof realtimeDispatcher.dispatch;
                console.error = (...args) => {
                    logs.push(args);
                };

                try {
                    const result = await withTenant(ANONYMOUS, async (client) => {
                        (client as PoolClient & { _realtimeDispatchKey?: string })._realtimeDispatchKey = 'dispatch-failure-test';
                        return 'committed-result';
                    });
                    assert.equal(result, 'committed-result');
                    assert.ok(statements.includes('COMMIT'));
                    assert.equal(statements.includes('ROLLBACK'), false);
                    assert.equal(logs.length, 1);
                    assert.match(String(logs[0]?.[0]), /realtime dispatch failed after transaction commit/);
                } finally {
                    appPool.connect = originalConnect;
                    realtimeDispatcher.dispatch = originalDispatch;
                    console.error = originalConsoleError;
                }
            });
        });

        describe('Wholesale notification recipient function authorization', () => {
            it('rejects a caller that is not the event actor', async () => {
                const { rows } = await adminPool.query<{ event_id: string }>(
                    `INSERT INTO wholesale_events
                        (buyer_business_id, supplier_business_id, actor_user_id, entity_type, entity_id, event_type, details)
                     VALUES ($1, $2, $3, 'rfq', 990000001, 'rfq.created', '{}'::JSONB)
                     RETURNING event_id`,
                    [buyerBusinessId, sellerBusinessId, buyerUserId],
                );
                const eventId = Number(rows[0]!.event_id);
                const { businessContext, withTenant } = await import('../src/db/tenant.js');

                await assert.rejects(
                    withTenant(
                        businessContext(sellerUserId, sellerBusinessId),
                        (client) => client.query(
                            'SELECT * FROM wholesale_notification_recipients_for_event($1, $2)',
                            [eventId, sellerBusinessId],
                        ),
                    ),
                    /Unauthorized Wholesale notification recipient lookup/,
                );
            });

            it('rejects a caller from a business that is not a party to the event', async () => {
                const { rows } = await adminPool.query<{ event_id: string }>(
                    `INSERT INTO wholesale_events
                        (buyer_business_id, supplier_business_id, actor_user_id, entity_type, entity_id, event_type, details)
                     VALUES ($1, $2, $3, 'rfq', 990000002, 'rfq.created', '{}'::JSONB)
                     RETURNING event_id`,
                    [buyerBusinessId, sellerBusinessId, buyerUserId],
                );
                const eventId = Number(rows[0]!.event_id);
                const { businessContext, withTenant } = await import('../src/db/tenant.js');

                await assert.rejects(
                    withTenant(
                        businessContext(buyerUserId, outsiderBusinessId),
                        (client) => client.query(
                            'SELECT * FROM wholesale_notification_recipients_for_event($1, $2)',
                            [eventId, outsiderBusinessId],
                        ),
                    ),
                    /Unauthorized Wholesale notification recipient lookup/,
                );
            });
        });
describe('SSE Phase C - RFQ delivery isolation and permission', () => {
    it('rejects an expired JWT for the SSE connection with 401', async () => {
        const expiredToken = jwt.sign(
            {
                sub: String(sellerUserId),
                email: 'sse-seller@hq.test',
                pa: false,
                token_version: 0,
            },
            config.JWT_SECRET,
            { expiresIn: -1 },
        );
        const httpServer = createServer(app);
        const baseUrl = await new Promise<string>((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => {
                const addr = httpServer.address();
                const port = typeof addr === 'object' && addr ? addr.port : 0;
                resolve('http://127.0.0.1:' + port);
            });
        });
        try {
            const response = await fetch(baseUrl + '/api/business/' + sellerBusinessId + '/notifications/stream', {
                method: 'GET',
                headers: {
                    Authorization: authorization(expiredToken),
                    Accept: 'text/event-stream',
                },
            });
            await response.body?.cancel();
            console.log(`EXPIRED_JWT_SSE_STATUS=${response.status}`);
            assert.equal(response.status, 401);
        } finally {
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        }
    });

    it('delivers RFQ only to the supplier and rejects a member without wholesale.view', async () => {
        const httpServer = createServer(app);
        const baseUrl = await new Promise<string>((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => {
                const addr = httpServer.address();
                const port = typeof addr === 'object' && addr ? addr.port : 0;
                resolve('http://127.0.0.1:' + port);
            });
        });
        let supplierConnection: SseConnection | undefined;
        let outsiderConnection: SseConnection | undefined;
        const deniedController = new AbortController();
        let deniedResponse: Response | undefined;
        try {
            supplierConnection = await openSse(baseUrl, sellerBusinessId, sellerToken);
            outsiderConnection = await openSse(baseUrl, outsiderBusinessId, outsiderToken);
            deniedResponse = await fetch(baseUrl + '/api/business/' + noviewBusinessId + '/notifications/stream', {
                method: 'GET',
                headers: { 'Authorization': authorization(noWholesaleViewToken), 'Accept': 'text/event-stream' },
                signal: deniedController.signal,
            });
            console.log(`NO_WHOLESALE_VIEW_STATUS=${deniedResponse.status} user=sse-noview@hq.test business=sse-noview role=test_no_wholesale_view`);
            assert.equal(deniedResponse.status, 403);
            await deniedResponse.body?.cancel();
            const createdRfqId = await createRfq();
            const [supplierFrames, outsiderFrames] = await Promise.all([
                receiveSseEvents(supplierConnection.reader, 'notification', 1, 3000),
                receiveSseEvents(outsiderConnection.reader, 'notification', 1, 3000),
            ]);
            assert.equal(supplierFrames.length, 1);
            const payload = JSON.parse(supplierFrames[0]!.data) as { targetId: number | string };
            assert.equal(Number(payload.targetId), createdRfqId);
            assert.equal(outsiderFrames.length, 0);
        } finally {
            deniedController.abort();
            try { await deniedResponse?.body?.cancel(); } catch {}
            await closeSse(outsiderConnection);
            await closeSse(supplierConnection);
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        }
    });
});
