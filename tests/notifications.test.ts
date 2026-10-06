/**
 * Order-status notifications, tested through the real API and the real
 * trigger. The scenarios this file pins down:
 *
 *   * the trigger exists: a staff status change creates a notification
 *     for the customer, without any application code calling it;
 *   * the payload carries what the frontend needs to render the badge:
 *     order number, from/to status and the business id;
 *   * RLS is the filter: user A never sees user B's notifications, not
 *     even by guessing the id, and cannot mark them read;
 *   * a status update to the same status creates nothing (the trigger
 *     compares old and new, not just "an UPDATE happened");
 *   * read-all and mark-one-read keep the unread count honest.
 */

process.env['NODE_ENV'] = 'test';
process.env['PGDATABASE'] = process.env['TEST_PGDATABASE'] ?? 'hq_marketplace_test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-that-is-long-enough-123';

import assertModule from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';

const assert: typeof assertModule = assertModule;

type App = import('express').Express;
let app: App;
let adminPool: import('pg').Pool;
let closePools: () => Promise<void>;

let customerToken: string;
let staffToken: string;
let outsiderToken: string;
let orderId: number;
let notificationId: number;

before(async () => {
    app = (await import('../src/app.js')).createApp();
    const poolModule = await import('../src/db/pool.js');
    adminPool = poolModule.adminPool;
    closePools = poolModule.closePools;
    const { prepareTestDatabase } = await import('./helpers/test-database.js');
    await prepareTestDatabase(adminPool, { truncate: ['user_notifications', ...require('./helpers/test-database.js').TEST_TABLES] });
});
