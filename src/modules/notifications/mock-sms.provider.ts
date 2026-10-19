import { BaseNotificationProvider } from './notification.provider.js';
import type { NotificationMessage } from './notification.types.js';

export class MockSmsProvider extends BaseNotificationProvider {
    readonly channel = 'sms' as const;
    readonly delivered: NotificationMessage[] = [];

    async send(message: NotificationMessage): Promise<void> {
        this.delivered.push({ ...message });
    }

    clear(): void {
        this.delivered.length = 0;
    }
}
