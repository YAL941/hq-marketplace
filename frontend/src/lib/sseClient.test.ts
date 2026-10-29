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
