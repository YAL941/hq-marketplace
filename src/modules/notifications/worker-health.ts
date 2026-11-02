import { unlink, writeFile } from 'node:fs/promises';

export interface WorkerHealthMarkers {
    processAlive: boolean;
    databaseReady: boolean;
}

/** Marker files separate process liveness from its last database probe. */
export class WorkerHealthFiles {
    constructor(private readonly heartbeatPath: string, private readonly readinessPath: string) {}

    async markAlive(now = Date.now()): Promise<void> {
        await writeFile(this.heartbeatPath, String(now), { mode: 0o600 });
    }

    async markDatabaseReady(now = Date.now()): Promise<void> {
        await writeFile(this.readinessPath, `database_ready ${now}`, { mode: 0o600 });
    }

    async markDatabaseUnavailable(now = Date.now()): Promise<void> {
        await writeFile(this.readinessPath, `database_unavailable ${now}`, { mode: 0o600 });
    }

    async clear(): Promise<void> {
        await Promise.all([
            unlink(this.heartbeatPath).catch(() => undefined),
            unlink(this.readinessPath).catch(() => undefined),
        ]);
    }
}

export function workerMarkersAreHealthy(
    heartbeatValue: string,
    readinessValue: string,
    now = Date.now(),
    maxAgeMs = 90_000,
): WorkerHealthMarkers {
    const heartbeatAt = Number(heartbeatValue.trim());
    const readinessMatch = /^(database_ready|database_unavailable) (\d+)$/.exec(readinessValue.trim());
    const readinessAt = readinessMatch ? Number(readinessMatch[2]) : Number.NaN;
    return {
        processAlive: Number.isFinite(heartbeatAt) && now >= heartbeatAt && now - heartbeatAt <= maxAgeMs,
        databaseReady: readinessMatch?.[1] === 'database_ready'
            && Number.isFinite(readinessAt) && now >= readinessAt && now - readinessAt <= maxAgeMs,
    };
}
