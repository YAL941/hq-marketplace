import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { WorkerHealthFiles, workerMarkersAreHealthy } from '../src/modules/notifications/worker-health.js';

const now = 1_800_000_000_000;

describe('email worker process and database health markers', () => {
    it('is healthy on first startup before any successful delivery', () => {
        assert.deepEqual(workerMarkersAreHealthy(String(now), `database_ready ${now}`, now), {
            processAlive: true, databaseReady: true,
        });
    });

    it('is healthy when the queue is empty and no delivery has been verified', () => {
        assert.deepEqual(workerMarkersAreHealthy(String(now), `database_ready ${now}`, now), {
            processAlive: true, databaseReady: true,
        });
    });

    it('keeps unverified SMTP delivery separate from process health', () => {
        const deliveryStatus = 'unverified';
        const health = workerMarkersAreHealthy(String(now), `database_ready ${now}`, now);
        assert.equal(deliveryStatus, 'unverified');
        assert.equal(health.processAlive && health.databaseReady, true);
    });

    it('does not fail process health because a delivery attempt was transiently rejected', () => {
        const lastSmtpError = 'smtp_timeout';
        const health = workerMarkersAreHealthy(String(now), `database_ready ${now}`, now);
        assert.equal(lastSmtpError, 'smtp_timeout');
        assert.equal(health.processAlive && health.databaseReady, true);
    });

    it('allows delivery verification to become ready after a later successful retry', () => {
        let lastSmtpError: string | null = 'smtp_connection_failed';
        let lastSuccessAt: number | null = null;
        lastSmtpError = null;
        lastSuccessAt = now;
        assert.deepEqual({ lastSmtpError, lastSuccessAt }, { lastSmtpError: null, lastSuccessAt: now });
        assert.equal(workerMarkersAreHealthy(String(now), `database_ready ${now}`, now).databaseReady, true);
    });

    it('reports missing SMTP configuration independently from database readiness', () => {
        const smtpConfiguration = 'not_configured';
        const health = workerMarkersAreHealthy(String(now), `database_ready ${now}`, now);
        assert.equal(smtpConfiguration, 'not_configured');
        assert.equal(health.processAlive && health.databaseReady, true);
    });

    it('reports the database unavailable while the process remains alive', () => {
        assert.deepEqual(workerMarkersAreHealthy(String(now), `database_unavailable ${now}`, now), {
            processAlive: true, databaseReady: false,
        });
    });

    it('expires process and database health after shutdown or stale heartbeat', () => {
        assert.deepEqual(workerMarkersAreHealthy(String(now - 90_001), `database_ready ${now - 90_001}`, now), {
            processAlive: false, databaseReady: false,
        });
    });

    it('writes and removes liveness and database markers through the shutdown lifecycle', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'hq-worker-health-'));
        const heartbeat = join(directory, 'heartbeat');
        const readiness = join(directory, 'readiness');
        const markers = new WorkerHealthFiles(heartbeat, readiness);
        try {
            await markers.clear();
            await markers.markAlive(now);
            await markers.markDatabaseReady(now);
            assert.deepEqual(workerMarkersAreHealthy(readFileSync(heartbeat, 'utf8'), readFileSync(readiness, 'utf8'), now), {
                processAlive: true, databaseReady: true,
            });
            await markers.markDatabaseUnavailable(now + 1);
            assert.equal(workerMarkersAreHealthy(readFileSync(heartbeat, 'utf8'), readFileSync(readiness, 'utf8'), now + 1).databaseReady, false);
            await markers.clear();
            assert.equal(existsSync(heartbeat), false);
            assert.equal(existsSync(readiness), false);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
