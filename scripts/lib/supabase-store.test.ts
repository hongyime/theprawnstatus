import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readLatestHealthFromSupabase,
  readLatestSummaryFromSupabase,
  readProbeRecordsSinceFromSupabase,
} from './supabase-store';

describe('latest Supabase snapshots', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://fixture.invalid');
    vi.stubEnv('SUPABASE_ANON_KEY', 'synthetic-read-key');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  for (const [table, column, read] of [
    ['status_runs', 'summary', readLatestSummaryFromSupabase],
    ['health_runs', 'report', readLatestHealthFromSupabase],
  ] as const) {
    it(`${table} reads only the latest row even with extensive history`, async () => {
      const latest = { schema: 1, generated_at: '2026-09-12T00:00:00Z', fixture: 'latest' };
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(`/rest/v1/${table}`);
        expect(url.searchParams.get('limit')).toBe('1');
        expect(url.searchParams.get('order')).toBe('generated_at.desc');
        expect(url.searchParams.get('select')).toBe(column);
        const offset = Number(url.searchParams.get('offset') ?? '0');
        return new Response(
          JSON.stringify(
            offset < 20 ? [{ [column]: offset === 0 ? latest : { fixture: 'older' } }] : [],
          ),
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      expect(await read()).toEqual(latest);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it(`${table} returns null for an empty history`, async () => {
      const fetchMock = vi.fn(async () => new Response('[]'));
      vi.stubGlobal('fetch', fetchMock);
      expect(await read()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    for (const phase of ['headers', 'body'] as const) {
      it(`${table} aborts stalled ${phase} within the shared ten-second deadline`, async () => {
        vi.useFakeTimers();
        let signal: AbortSignal;
        vi.stubGlobal(
          'fetch',
          vi.fn((_input: unknown, init: RequestInit) => {
            signal = init.signal as AbortSignal;
            if (phase === 'headers') {
              return new Promise<Response>((_resolve, reject) => {
                signal.addEventListener(
                  'abort',
                  () => reject(new DOMException('Aborted', 'AbortError')),
                  { once: true },
                );
              });
            }
            const body = new ReadableStream({
              start(controller) {
                signal.addEventListener(
                  'abort',
                  () => controller.error(new DOMException('Aborted', 'AbortError')),
                  { once: true },
                );
              },
            });
            return Promise.resolve(new Response(body));
          }),
        );
        const pending = read();
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await vi.advanceTimersByTimeAsync(9_999);
        expect(signal!.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(signal!.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      });
    }

    it(`${table} clears the deadline after success and provider failure`, async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('[]')),
      );
      await read();
      expect(vi.getTimerCount()).toBe(0);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('synthetic failure', { status: 503 })),
      );
      await expect(read()).rejects.toThrow('503');
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('keeps complete pagination for historical probe readers', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get('offset'));
      expect(url.searchParams.get('limit')).toBe('1000');
      const rows = Array.from({ length: offset === 0 ? 1000 : 1 }, (_, i) => ({
        checked_at: '2026-09-12T00:00:00Z',
        target_id: `fixture-${offset + i}`,
        status: 200,
        ms: 10,
        error_class: null,
      }));
      return new Response(JSON.stringify(rows));
    });
    vi.stubGlobal('fetch', fetchMock);
    const rows = await readProbeRecordsSinceFromSupabase(new Date('2026-09-11T00:00:00Z'));
    expect(rows).toHaveLength(1001);
    expect(rows[1000].id).toBe('fixture-1000');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
