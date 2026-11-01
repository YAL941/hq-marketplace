import type { Response } from 'express';
import { businessContext, withTenant } from '../../db/tenant.js';

export interface RealtimeClient {
    id: string;
    userId: number;
    businessId: number;
    tokenVersion: number;
    res: Response;
    catchingUp: boolean;
    queuedEvents: RealtimeEvent[];
    sentNotificationIds: Set<string>;
    cleanup?: () => void;
    revalidating?: boolean;
}

export type RealtimeEvent =
    | {
        type: 'notification';
        businessId: number;
        userId?: number;
        data: unknown;
        id: string;
    }
    | {
        type: 'wholesale.order_status' | 'ping';
        businessId: number;
        userId?: number;
        data: unknown;
    };

class RealtimeService {
    private clients = new Map<string, RealtimeClient>();
    private businessClients = new Map<string, Set<string>>();
    private revalidateTimers = new Map<string, NodeJS.Timeout>();
    private revalidateIntervalMs = 30_000;

    private async revalidateClientInternal(clientId: string): Promise<void> {
        const client = this.clients.get(clientId);
        if (!client) return;
        if (client.revalidating) return;
        client.revalidating = true;
        try {
            const ctx = businessContext(client.userId, client.businessId);
            // Check user status and token_version
            const userRes = await withTenant(ctx, async (tenantClient) => {
                const { rows } = await tenantClient.query<{ token_version: number; status: string }>(
                    'SELECT token_version, status FROM users WHERE user_id = $1',
                    [client.userId],
                );
                return rows[0];
            });
            if (!userRes
                || userRes.status !== 'active'
                || Number(userRes.token_version) !== client.tokenVersion) {
                this.closeClient(clientId);
                return;
            }
            // Check membership
            const { rows: memRows } = await withTenant(ctx, async (tenantClient) => {
                const { rows } = await tenantClient.query<{ allowed: boolean }>(
                    'SELECT (app_is_business_member($1) OR app_is_platform_admin()) AS allowed',
                    [client.businessId],
                );
                return { rows };
            });
            if (memRows[0]?.allowed !== true) {
                this.closeClient(clientId);
                return;
            }
            // Check permission
            const { rows: permRows } = await withTenant(ctx, async (tenantClient) => {
                const { rows } = await tenantClient.query<{ allowed: boolean }>(
                    "SELECT app_has_business_permission($1, 'wholesale.view') AS allowed",
                    [client.businessId],
                );
                return { rows };
            });
            if (permRows[0]?.allowed !== true) {
                this.closeClient(clientId);
                return;
            }
        } catch (error) {
            console.error('[hq] realtime revalidation failed', error);
            this.closeClient(clientId);
            return;
        } finally {
            const c = this.clients.get(clientId);
            if (c) c.revalidating = false;
        }
    }

    private closeClient(clientId: string): void {
        const client = this.clients.get(clientId);
        if (!client) return;
        try {
            if (client.cleanup) {
                client.cleanup();
            }
        } catch (error) {
            console.error('[hq] realtime client cleanup failed', error);
        }
        try {
            if (!client.res.writableEnded) {
                client.res.end();
            }
        } catch (error) {
            console.error('[hq] realtime client end failed', error);
        }
        const timer = this.revalidateTimers.get(clientId);
        if (timer) {
            clearInterval(timer);
            this.revalidateTimers.delete(clientId);
        }
        client.queuedEvents.splice(0);
        client.sentNotificationIds.clear();
        this.removeClient(clientId);
    }

    addClient(client: RealtimeClient): void {
        this.clients.set(client.id, client);
        const key = this.getBusinessKey(client.businessId);
        if (!this.businessClients.has(key)) {
            this.businessClients.set(key, new Set());
        }
        this.businessClients.get(key)!.add(client.id);
        if (!this.revalidateTimers.has(client.id)) {
            const timer = setInterval(() => {
                void this.revalidateClientInternal(client.id);
            }, this.revalidateIntervalMs);
            this.revalidateTimers.set(client.id, timer);
        }
    }

    removeClient(clientId: string): void {
        const client = this.clients.get(clientId);
        if (!client) return;
        this.clients.delete(clientId);
        const key = this.getBusinessKey(client.businessId);
        const set = this.businessClients.get(key);
        if (set) {
            set.delete(clientId);
            if (set.size === 0) {
                this.businessClients.delete(key);
            }
        }
        const timer = this.revalidateTimers.get(clientId);
        if (timer) {
            clearInterval(timer);
            this.revalidateTimers.delete(clientId);
        }
    }

    broadcastToBusiness(businessId: number, event: RealtimeEvent): void {
        const key = this.getBusinessKey(businessId);
        const clientIds = this.businessClients.get(key);
        if (!clientIds || clientIds.size === 0) return;

        for (const clientId of clientIds) {
            const client = this.clients.get(clientId);
            if (!client) {
                clientIds.delete(clientId);
                continue;
            }
            this.deliverOrQueue(client, event);
        }
    }

    broadcastToUser(businessId: number, userId: number, event: RealtimeEvent): void {
        const key = this.getBusinessKey(businessId);
        const clientIds = this.businessClients.get(key);
        if (!clientIds || clientIds.size === 0) return;

        for (const clientId of clientIds) {
            const client = this.clients.get(clientId);
            if (!client || client.userId !== userId) continue;
            this.deliverOrQueue(client, event);
        }
    }

    sendReplayEvent(clientId: string, event: RealtimeEvent): void {
        const client = this.clients.get(clientId);
        if (client) this.writeEvent(client, event);
    }

    sendControlEvent(clientId: string, type: 'ping' | 'notifications.reset', data: unknown): void {
        const client = this.clients.get(clientId);
        if (!client) return;
        if (client.res.writableEnded) {
            this.closeClient(clientId);
            return;
        }
        const eventMessage = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
            client.res.write(eventMessage);
        } catch {
            this.closeClient(clientId);
        }
    }

    finishCatchUp(clientId: string): void {
        const client = this.clients.get(clientId);
        if (!client) return;
        if (client.res.writableEnded) {
            this.closeClient(clientId);
            return;
        }
        client.catchingUp = false;
        const queuedEvents = client.queuedEvents.splice(0);
        for (const event of queuedEvents) this.writeEvent(client, event);
    }

    private deliverOrQueue(client: RealtimeClient, event: RealtimeEvent): void {
        if (client.res.writableEnded) {
            this.closeClient(client.id);
            return;
        }
        if (client.catchingUp) {
            client.queuedEvents.push(event);
            return;
        }
        this.writeEvent(client, event);
    }

    private writeEvent(client: RealtimeClient, event: RealtimeEvent): void {
        if (client.res.writableEnded) {
            this.closeClient(client.id);
            return;
        }
        if (event.type === 'notification') {
            if (client.sentNotificationIds.has(event.id)) return;
            client.sentNotificationIds.add(event.id);
        }
        try {
            client.res.write(this.formatSSE(event));
        } catch {
            this.closeClient(client.id);
        }
    }

    private formatSSE(event: RealtimeEvent): string {
        const idLine = event.type === 'notification' ? `id: ${event.id}\n` : '';
        const data = JSON.stringify(event.data);
        return `${idLine}event: ${event.type}\ndata: ${data}\n\n`;
    }

    private getBusinessKey(businessId: number): string {
        return `b:${businessId}`;
    }

    getClientCount(businessId?: number): number {
        if (businessId) {
            return this.businessClients.get(this.getBusinessKey(businessId))?.size || 0;
        }
        return this.clients.size;
    }

    configureRevalidationIntervalForTests(intervalMs: number): void {
        if (process.env['NODE_ENV'] !== 'test') {
            throw new Error('Realtime revalidation interval configuration is only available in test');
        }
        if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
            throw new Error('Realtime revalidation interval must be a positive integer');
        }
        this.revalidateIntervalMs = intervalMs;
    }

    resetRevalidationIntervalForTests(): void {
        if (process.env['NODE_ENV'] !== 'test') {
            throw new Error('Realtime revalidation interval configuration is only available in test');
        }
        this.revalidateIntervalMs = 30_000;
    }

    async revalidateClientsForTests(): Promise<void> {
        if (process.env['NODE_ENV'] !== 'test') {
            throw new Error('Manual realtime revalidation is only available in test');
        }
        await Promise.all(
            [...this.clients.keys()].map((clientId) => this.revalidateClientInternal(clientId)),
        );
    }

    clearAllClientsForTests(): void {
        if (process.env['NODE_ENV'] !== 'test') {
            throw new Error('Realtime test cleanup is only available in test');
        }
        for (const clientId of [...this.clients.keys()]) {
            this.closeClient(clientId);
        }
    }
}

export const realtimeService = new RealtimeService();
