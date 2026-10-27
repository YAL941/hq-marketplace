import type { Response } from 'express';

export interface RealtimeClient {
    id: string;
    userId: number;
    businessId: number;
    res: Response;
    lastEventId?: string;
}

export interface RealtimeEvent {
    type: 'notification' | 'wholesale.order_status' | 'ping';
    businessId: number;
    userId?: number;
    data: unknown;
    id?: string;
}

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

        const message = this.formatSSE(event);
        for (const clientId of clientIds) {
            const client = this.clients.get(clientId);
            if (!client) {
                clientIds.delete(clientId);
                continue;
            }
            try {
                client.res.write(message);
            } catch {
                this.removeClient(clientId);
            }
        }
    }

    broadcastToUser(businessId: number, userId: number, event: RealtimeEvent): void {
        const key = this.getBusinessKey(businessId);
        const clientIds = this.businessClients.get(key);
        if (!clientIds || clientIds.size === 0) return;

        const message = this.formatSSE(event);
        for (const clientId of clientIds) {
            const client = this.clients.get(clientId);
            if (!client || client.userId !== userId) continue;
            try {
                client.res.write(message);
            } catch {
                this.removeClient(clientId);
            }
        }
    }

    private formatSSE(event: RealtimeEvent): string {
        const id = event.id || Date.now().toString();
        const data = JSON.stringify(event.data);
        return `id: ${id}\nevent: ${event.type}\ndata: ${data}\n\n`;
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
