import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferLoaded, requestJson, withDeadline } from './request';

describe('dashboard request budgets', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('bounds a stalled response body after successful headers', async () => {
    let signal!: AbortSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
      }),
    );
    const result = requestJson('/fixture').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels immediately when the owning component is disposed', async () => {
    const owner = new AbortController();
    let signal!: AbortSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise(() => {});
      }),
    );
    const result = requestJson('/fixture', owner.signal).catch((error: unknown) => error);
    owner.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a request with an already-cancelled owner', async () => {
    const owner = new AbortController();
    owner.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestJson('/fixture', owner.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the full fallback chain to twenty seconds', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = withDeadline(undefined, 20_000, async (signal) => {
      for (const url of ['/primary', '/secondary', '/snapshot']) {
        try {
          return await requestJson(url, signal);
        } catch {
          signal.throwIfAborted();
        }
      }
      throw new Error('all sources failed');
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases timers after successful JSON and cancels unused error bodies', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"value":7}'))
        .mockResolvedValueOnce({ ok: false, status: 503, body: { cancel } }),
    );
    await expect(requestJson('/fixture')).resolves.toEqual({ value: 7 });
    await expect(requestJson('/failure')).rejects.toThrow('503');
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains newer loaded records but accepts a newer recovery snapshot', () => {
    const loaded = { generated_at: '2026-09-13T00:00:00Z' };
    expect(preferLoaded(loaded, { generated_at: '2026-09-12T00:00:00Z' })).toBe(true);
    expect(preferLoaded(loaded, { generated_at: '2026-09-14T00:00:00Z' })).toBe(false);
    expect(preferLoaded(loaded, { generated_at: null })).toBe(true);
    expect(preferLoaded(null, loaded)).toBe(false);
  });
});
