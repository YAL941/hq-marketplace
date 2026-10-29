import { realtimeService, type RealtimeEvent } from './realtime.service.js';

export interface PendingBroadcast {
    type: 'business' | 'user';
    businessId: number;
    userId?: number;
    event: RealtimeEvent;
}

class RealtimeDispatcher {
    private pending = new Map<string, PendingBroadcast[]>();

    enqueue(key: string, broadcast: PendingBroadcast): void {
        if (!this.pending.has(key)) {
            this.pending.set(key, []);
        }
        this.pending.get(key)!.push(broadcast);
    }

    dispatch(key: string): void {
        const broadcasts = this.pending.get(key);
        if (!broadcasts || broadcasts.length === 0) return;
        this.pending.delete(key);
        for (const broadcast of broadcasts) {
            try {
                if (broadcast.type === 'business') {
                    realtimeService.broadcastToBusiness(broadcast.businessId, broadcast.event);
                } else if (broadcast.type === 'user' && broadcast.userId !== undefined) {
                    realtimeService.broadcastToUser(broadcast.businessId, broadcast.userId, broadcast.event);
                }
            } catch {
                // Don't let broadcast failures affect committed transactions
            }
        }
    }

    clear(key: string): void {
        this.pending.delete(key);
    }
}

export const realtimeDispatcher = new RealtimeDispatcher();
