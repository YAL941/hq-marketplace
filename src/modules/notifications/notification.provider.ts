import type { NotificationProvider } from './notification.types.js';

export abstract class BaseNotificationProvider implements NotificationProvider {
    abstract readonly channel: NotificationProvider['channel'];

    abstract send(message: Parameters<NotificationProvider['send']>[0]): Promise<void>;
}
