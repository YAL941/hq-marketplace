export const SSE_MAX_FAILURES = 3;
export const SSE_HEARTBEAT_TIMEOUT = 45000;
export const SSE_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
// Polling retry threshold: try SSE once every 60 seconds until it succeeds.
export const SSE_POLLING_RETRY_INTERVAL = 60000;

export interface SseFrame {
  id: string;
  eventType: string;
  data: string;
}

export interface ParsedSseFrames {
  frames: SseFrame[];
  remainder: string;
}

export function parseSseFrames(buffer: string, chunk: string): ParsedSseFrames {
  const combined = buffer + chunk;
  const blocks = combined.split(/\r?\n\r?\n/);
  const remainder = blocks.pop() ?? '';
  const frames: SseFrame[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventType = 'message';
    let data = '';
    let id = '';
    let valid = false;

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('id:')) {
        id = line.slice(3).trim();
        valid = true;
      } else if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
        valid = true;
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trim();
        valid = true;
      }
    }

    if (valid) frames.push({ id, eventType, data });
  }

  return { frames, remainder };
}

export interface SseClientOptions {
  url: string;
  getToken: () => string | null;
  getLastEventId: () => string | null;
  onUnauthorized: () => void;
  onFrame: (frame: SseFrame) => void;
  onPolling: (enabled: boolean) => void;
  onBeforeReconnect: () => void | Promise<void>;
  maxFailures?: number;
  heartbeatTimeout?: number;
  reconnectDelays?: number[];
}

export class SseClient {
  private abortController: AbortController | null = null;
  private failures = 0;
  private reconnectAttempt = 0;
  private heartbeatTimeout: number | null = null;
  private reconnectTimeout: number | null = null;
  private pollingRetryTimeout: number | null = null;
  private stopped = false;
  private polling = false;
  private lastBuffer = '';

  constructor(private readonly options: SseClientOptions) {}

  start(): void {
    if (this.abortController !== null && !this.stopped) return;
    this.stopped = false;
    this.polling = false;
    this.failures = 0;
    this.reconnectAttempt = 0;
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearPollingRetry();
    this.connect();
  }

  private retryPollingConnection(): void {
    if (this.stopped || !this.polling) return;
    this.abortController?.abort();
    this.abortController = null;
    this.connect(true);
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
    this.abortController = null;
    this.clearHeartbeat();
    this.clearPollingRetry();
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private setPolling(enabled: boolean): void {
    this.polling = enabled;
    this.options.onPolling(enabled);
    if (enabled) {
      this.clearPollingRetry();
      const retryInterval = SSE_POLLING_RETRY_INTERVAL;
      const retry = () => {
        this.pollingRetryTimeout = null;
        if (this.stopped) return;
        this.retryPollingConnection();
      };
      this.pollingRetryTimeout = window.setTimeout(retry, retryInterval);
    } else {
      this.clearPollingRetry();
    }
  }

  private clearPollingRetry(): void {
    if (this.pollingRetryTimeout !== null) {
      window.clearTimeout(this.pollingRetryTimeout);
      this.pollingRetryTimeout = null;
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimeout !== null) {
      window.clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();
    const timeout = this.options.heartbeatTimeout ?? SSE_HEARTBEAT_TIMEOUT;
    this.heartbeatTimeout = window.setTimeout(() => {
      const controller = this.abortController;
      this.abortController = null;
      controller?.abort();
      this.clearHeartbeat();
      this.scheduleReconnect();
    }, timeout);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.polling) {
      this.clearPollingRetry();
      this.pollingRetryTimeout = window.setTimeout(() => {
        this.pollingRetryTimeout = null;
        if (this.stopped || !this.polling) return;
        this.retryPollingConnection();
      }, SSE_POLLING_RETRY_INTERVAL);
      return;
    }
    const maxFailures = this.options.maxFailures ?? SSE_MAX_FAILURES;
    this.failures++;
    if (this.failures >= maxFailures) {
      this.setPolling(true);
      return;
    }
    const delays = this.options.reconnectDelays ?? SSE_RECONNECT_DELAYS;
    const delay = delays[this.reconnectAttempt] ?? delays[delays.length - 1];
    this.reconnectAttempt++;
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.stopped || this.polling) return;
      void this.options.onBeforeReconnect();
      this.connect();
    }, delay);
  }

  private async connect(allowPolling = false): Promise<void> {
    if (this.stopped || (this.polling && !allowPolling)) return;
    const maxFailures = this.options.maxFailures ?? SSE_MAX_FAILURES;
    if (!allowPolling && this.failures >= maxFailures) {
      this.setPolling(true);
      return;
    }

    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;

    try {
      const token = this.options.getToken();
      if (!token) {
        this.options.onUnauthorized();
        return;
      }

      const headers: HeadersInit = {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      };
      const lastEventId = this.options.getLastEventId();
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;

      const response = await fetch(this.options.url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.options.onUnauthorized();
          return;
        }
        throw new Error(`SSE failed: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        throw new Error('Invalid content type');
      }

      this.setPolling(false);
      this.failures = 0;
      this.lastBuffer = '';
      this.resetHeartbeat();

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            this.clearHeartbeat();
            this.scheduleReconnect();
            break;
          }
          this.resetHeartbeat();
          const parsed = parseSseFrames(this.lastBuffer, decoder.decode(value, { stream: true }));
          this.lastBuffer = parsed.remainder;
          if (parsed.frames.length > 0) {
            this.reconnectAttempt = 0;
          }
          for (const frame of parsed.frames) this.options.onFrame(frame);
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError' || controller.signal.aborted) return;
        throw error;
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError' || controller.signal.aborted) return;
      this.clearHeartbeat();
      this.scheduleReconnect();
    }
  }
}
