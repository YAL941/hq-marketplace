import type { Response } from 'express';

export interface RealtimeClient {
    id: string;
    userId: number;
    businessId: number;
    res: Response;
    catchingUp: boolean;
    queuedEvents: RealtimeEvent[];
    sentNotificationIds: Set<string>;
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

    addClient(client: RealtimeClient): void {
        this.clients.set(client.id, client);
        const key = this.getBusinessKey(client.businessId);
        if (!this.businessClients.has(key)) {
            this.businessClients.set(key, new Set());
        }
        this.businessClients.get(key)!.add(client.id);
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
        const eventMessage = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
            client.res.write(eventMessage);
        } catch {
            this.removeClient(clientId);
        }
    }

    finishCatchUp(clientId: string): void {
        const client = this.clients.get(clientId);
        if (!client) return;
        client.catchingUp = false;
        const queuedEvents = client.queuedEvents.splice(0);
        for (const event of queuedEvents) this.writeEvent(client, event);
    }

    private deliverOrQueue(client: RealtimeClient, event: RealtimeEvent): void {
        if (client.catchingUp) {
            client.queuedEvents.push(event);
            return;
        }
        this.writeEvent(client, event);
    }

    private writeEvent(client: RealtimeClient, event: RealtimeEvent): void {
        if (event.type === 'notification') {
            if (client.sentNotificationIds.has(event.id)) return;
            client.sentNotificationIds.add(event.id);
        }
        try {
            client.res.write(this.formatSSE(event));
        } catch {
            this.removeClient(client.id);
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
}

export const realtimeService = new RealtimeService();
