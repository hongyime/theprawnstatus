import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicCollectorEnabled } from './collector-backend';
import {
  collectAtomicStatus,
  readProbeRecordsForDayFromSupabase,
  rebuildAtomicStatus,
} from './supabase-store';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function setup() {
  vi.stubEnv('STATUS_COLLECTION_BACKEND', 'atomic');
  vi.stubEnv('STATUS_RUNNER', 'github-actions');
  vi.stubEnv('SUPABASE_URL', 'https://database.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-service-key-longer-than-32-characters');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'synthetic-public-key');
}

describe('collector cutover and recovery', () => {
  it('keeps the existing backend until explicitly enabled and rejects typos', () => {
    vi.stubEnv('STATUS_COLLECTION_BACKEND', '');
    expect(atomicCollectorEnabled()).toBe(false);
    vi.stubEnv('STATUS_COLLECTION_BACKEND', 'atomic');
    expect(atomicCollectorEnabled()).toBe(true);
    vi.stubEnv('STATUS_COLLECTION_BACKEND', 'atomci');
    expect(() => atomicCollectorEnabled()).toThrow('must be legacy or atomic');
  });

  it('reads all pages from both storage representations using the private RPC', async () => {
    setup();
    const row = {
      checked_at: '2026-09-13T00:00:00Z',
      target_id: 'alpha',
      status: 200,
      ms: 42,
      error_class: null,
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/rest/v1/rpc/status_raw_window');
      expect(url.searchParams.get('order')).toBe('checked_at.asc,target_id.asc');
      expect(new Headers(init.headers).get('apikey')).toBe(
        'synthetic-service-key-longer-than-32-characters',
      );
      expect(JSON.parse(String(init.body))).toEqual({
        p_runner: 'github-actions',
        p_start: '2026-09-13T00:00:00.000Z',
        p_end: '2026-09-14T00:00:00.000Z',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Response.json(
        url.searchParams.get('offset') === '0'
          ? Array.from({ length: 1000 }, () => row)
          : [{ ...row, target_id: 'last' }],
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await readProbeRecordsForDayFromSupabase('2026-09-13');
    expect(result).toHaveLength(1001);
    expect(result.at(-1)).toEqual({ t: row.checked_at, id: 'last', s: 200, ms: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not silently fall back to incomplete legacy history on an RPC failure', async () => {
    setup();
    const fetchMock = vi.fn(async () => Response.json({ code: 'PGRST202' }, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readProbeRecordsForDayFromSupabase('2026-09-13')).rejects.toThrow('404');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rebuilds in the database without downloading raw history or appending snapshots', async () => {
    setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe('/rest/v1/rpc/rebuild_status_projection');
      expect(JSON.parse(String(init.body))).toEqual({ p_runner: 'github-actions' });
      return Response.json({ state: 'complete' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await rebuildAtomicStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a disabled manual collector as a failure without probing', async () => {
    setup();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(new URL(String(input)).pathname).toBe('/rest/v1/rpc/claim_status_collection');
      return Response.json({ state: 'disabled' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(collectAtomicStatus()).rejects.toThrow('disabled');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
