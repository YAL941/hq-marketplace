// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SseClient, parseSseFrames } from './sseClient';

describe('parseSseFrames', () => {
  it('handles chunks split across frame boundaries and CRLF', () => {
    const first = parseSseFrames('', 'id: 42\r\n');
    expect(first.frames).toEqual([]);

    const second = parseSseFrames(first.remainder, 'event: update\r\ndata: hello\r\n\r\n');
    expect(second).toEqual({
      frames: [{ id: '42', eventType: 'update', data: 'hello' }],
      remainder: '',
    });
  });

  it('returns ping frames and no notification id for an id-less ping', () => {
    const parsed = parseSseFrames('', 'event: ping\r\ndata: keepalive\r\n\r\n');
    expect(parsed.frames).toEqual([{ id: '', eventType: 'ping', data: 'keepalive' }]);
  });

  it('ignores a malformed frame without SSE fields', () => {
    const parsed = parseSseFrames('', 'this is not an sse frame\r\n\r\n');
    expect(parsed.frames).toEqual([]);
  });
});

describe('SseClient batch 1', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([401, 403])('calls onUnauthorized once without reconnecting for status %i', async (status) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status,
      headers: new Headers(),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onUnauthorized = vi.fn();
    const client = new SseClient({
      url: '/notifications/stream',
      getToken: () => 'test-token',
      getLastEventId: () => null,
      onUnauthorized,
      onFrame: vi.fn(),
      onPolling: vi.fn(),
      onBeforeReconnect: vi.fn(),
    });

    client.start();
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it('treats done as a disconnect and reconnects', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const onBeforeReconnect = vi.fn();
    const client = new SseClient({
      url: '/notifications/stream',
      getToken: () => 'test-token',
      getLastEventId: () => null,
      onUnauthorized: vi.fn(),
      onFrame: vi.fn(),
      onPolling: vi.fn(),
      onBeforeReconnect,
    });

    client.start();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onBeforeReconnect).toHaveBeenCalledTimes(1);
    client.stop();
  });
});

describe('SseClient batch 2', () => {
  const createClient = (
    fetchMock: ReturnType<typeof vi.fn>,
    onPolling = vi.fn(),
    onUnauthorized = vi.fn(),
    onBeforeReconnect = vi.fn(),
    maxFailures?: number,
  ) => {
    vi.stubGlobal('fetch', fetchMock);
    return new SseClient({
      url: '/notifications/stream',
      getToken: () => 'test-token',
      getLastEventId: () => null,
      onUnauthorized,
      onFrame: vi.fn(),
      onPolling,
      onBeforeReconnect,
      maxFailures,
    });
  };

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('enters Polling after three consecutive failures', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'));
    const onPolling = vi.fn();
    const client = createClient(fetchMock, onPolling);

    client.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(onPolling).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    client.stop();
  });

  it('treats heartbeat timeout as a reconnect failure before Polling', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
        });
      }
      return Promise.reject(new Error('network failure'));
    });
    const onPolling = vi.fn();
    const client = createClient(fetchMock, onPolling);

    client.start();
    await flush();
    await vi.advanceTimersByTimeAsync(45000);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onPolling).not.toHaveBeenCalledWith(true);
    client.stop();
  });

  it('polling success after 60 seconds returns to SSE', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      if (calls <= 3) return Promise.reject(new Error('network failure'));
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
      });
    });
    const onPolling = vi.fn();
    const client = createClient(fetchMock, onPolling);

    client.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    await flush();

    expect(onPolling).toHaveBeenCalledWith(false);
    client.stop();
  });

  it('a failed Polling retry remains Polling and retries after 60 seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'));
    const onPolling = vi.fn();
    const client = createClient(fetchMock, onPolling);

    client.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    await flush();

    expect(onPolling).toHaveBeenCalledWith(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(60000);
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
    client.stop();
  });

  it('after returning from Polling a disconnect uses 1s, 2s, then 4s delays', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let resolveFirstRead: ((value: { done: boolean; value: Uint8Array | undefined }) => void) | undefined;
    let resolveSecondRead: ((value: { done: boolean; value: Uint8Array | undefined }) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      if (calls <= 4) return Promise.reject(new Error('network failure'));
      if (calls === 5) {
        let readCount = 0;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/event-stream' }),
          body: {
            getReader: () => ({
              read: vi.fn(() => {
                readCount++;
                if (readCount === 1) {
                  return new Promise<{ done: boolean; value: Uint8Array | undefined }>((resolve) => {
                    resolveFirstRead = resolve;
                  });
                }
                return new Promise<{ done: boolean; value: Uint8Array | undefined }>((resolve) => {
                  resolveSecondRead = resolve;
                });
              }),
            }),
          },
        });
      }
      return Promise.reject(new Error('network failure'));
    });
    const onPolling = vi.fn();
    const client = createClient(fetchMock, onPolling, vi.fn(), vi.fn(), 4);

    client.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    await vi.advanceTimersByTimeAsync(4000);
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    await flush();

    expect(onPolling.mock.calls.map(([enabled]) => enabled)).toEqual([true, false]);
    resolveFirstRead?.({ done: false, value: new TextEncoder().encode('id: 42\r\nevent: update\r\ndata: ok\r\n\r\n') });
    await flush();
    resolveSecondRead?.({ done: true, value: undefined });
    await flush();

    for (const delay of [1000, 2000, 4000]) {
      const countBefore = fetchMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(countBefore);

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(countBefore + 1);
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(7);
    client.stop();
  });

  it('start twice opens only one connection', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
    });
    const client = createClient(fetchMock);

    client.start();
    client.start();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it('stop cancels reconnect and heartbeat timers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'));
    const client = createClient(fetchMock);

    client.start();
    await flush();
    client.stop();

    expect(vi.getTimerCount()).toBe(0);
  });
});
