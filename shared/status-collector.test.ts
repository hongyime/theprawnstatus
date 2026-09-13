import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLLECTOR_CONCURRENCY,
  createCollectorRpc,
  createStatusCollector,
} from './status-collector';
import type { ProbeRecord, TargetConfig } from './types';

const secret = 'fixture-service-secret-is-long-enough-to-be-accepted';
const token = '00000000-0000-4000-8000-000000000001';
const slot = '2026-09-13T12:00:00+00:00';
const targets: TargetConfig[] = Array.from({ length: 22 }, (_, i) => ({
  id: 'target-' + i,
  name: 'Target ' + i,
  url: 'https://target-' + i + '.invalid',
  expect: 200,
}));
const request = (authorization = 'Bearer ' + secret, method = 'POST') =>
  new Request('https://collector.invalid', { method, headers: { authorization } });
const record = (target: TargetConfig): ProbeRecord => ({
  id: target.id,
  t: '2026-09-13T12:00:01.000Z',
  s: 200,
  ms: 17,
});
const claim = () => ({ state: 'claimed', token, slot, targets });
afterEach(() => vi.useRealTimers());

describe('authenticated bounded collector', () => {
  it.each(['', 'Bearer public-key', 'Basic ' + secret, 'Bearer ' + secret + '-wrong'])(
    'rejects unauthorized calls before any work: %s',
    async (authorization) => {
      const rpc = vi.fn();
      const probeTarget = vi.fn();
      const response = await createStatusCollector({ secret, rpc, probeTarget })(
        request(authorization),
      );
      expect(response.status).toBe(401);
      expect(rpc).not.toHaveBeenCalled();
      expect(probeTarget).not.toHaveBeenCalled();
    },
  );

  it('rejects non-POST calls without touching the database', async () => {
    const rpc = vi.fn();
    expect(
      (await createStatusCollector({ secret, rpc })(request('Bearer ' + secret, 'GET'))).status,
    ).toBe(405);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepts the configured platform authorization independently of the database credential', async () => {
    const rpc = vi.fn().mockResolvedValue({ state: 'disabled' });
    const handler = createStatusCollector({
      secret,
      rpc,
      authorizeVerifiedRequest: (request) =>
        request.headers.get('authorization') === 'Bearer synthetic-platform-jwt',
    });
    const response = await handler(
      new Request('https://collector.invalid', {
        method: 'POST',
        headers: {
          authorization: 'Bearer synthetic-platform-jwt',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'disabled', checked: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('honors a platform authorization rejection even when the fallback bearer matches', async () => {
    const rpc = vi.fn();
    const handler = createStatusCollector({
      secret,
      rpc,
      authorizeVerifiedRequest: () => false,
    });
    const response = await handler(request('Bearer ' + secret));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'busy', 'complete'])('skips probes for a %s slot', async (state) => {
    const rpc = vi.fn().mockResolvedValue({ state });
    const probeTarget = vi.fn();
    const response = await createStatusCollector({ secret, rpc, probeTarget })(request());
    expect(await response.json()).toEqual({ state, checked: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(probeTarget).not.toHaveBeenCalled();
  });

  it('stops before probes when the database reaches its configured capacity limit', async () => {
    const rpc = vi.fn().mockResolvedValue({ state: 'capacity' });
    const probeTarget = vi.fn();
    const response = await createStatusCollector({ secret, rpc, probeTarget })(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'collection_incomplete' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(probeTarget).not.toHaveBeenCalled();
  });

  it('uses database targets, bounds parallel probes and commits one ordered batch', async () => {
    let running = 0;
    let maximum = 0;
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(claim())
      .mockResolvedValueOnce({ state: 'complete', slot });
    const probeTarget = vi.fn(async (target: TargetConfig) => {
      running += 1;
      maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, 3));
      running -= 1;
      return record(target);
    });
    const handler = createStatusCollector({ secret, rpc, probeTarget });
    const response = await handler(
      new Request('https://collector.invalid', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          targets: [{ url: 'https://untrusted.invalid' }],
          token: 'untrusted',
        }),
      }),
    );
    expect(await response.json()).toEqual({ state: 'complete', checked: 22 });
    expect(maximum).toBe(COLLECTOR_CONCURRENCY);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).toEqual({
      p_runner: 'github-actions',
      p_token: token,
      p_records: targets.map(record),
    });
    expect(rpc.mock.calls[0][2].aborted).toBe(true);
  });

  it.each([
    [],
    [...targets, ...targets],
    [targets[0], targets[0]],
    [{ ...targets[0], url: 'file:///private' }],
    [{ ...targets[0], expect: 99 }],
  ])('rejects an invalid target configuration before probing', async (invalid) => {
    const rpc = vi.fn().mockResolvedValue({ ...claim(), targets: invalid });
    const probeTarget = vi.fn();
    const response = await createStatusCollector({ secret, rpc, probeTarget })(request());
    expect(response.status).toBe(503);
    expect(probeTarget).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('stops stalled probes and rejects their late result without a commit', async () => {
    let release!: (value: ProbeRecord) => void;
    const probeTarget = vi.fn(
      () =>
        new Promise<ProbeRecord>((resolve) => {
          release = resolve;
        }),
    );
    const rpc = vi.fn().mockResolvedValue(claim());
    const response = await createStatusCollector({ secret, rpc, probeTarget, budgetMs: 30 })(
      request(),
    );
    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(probeTarget).toHaveBeenCalledTimes(COLLECTOR_CONCURRENCY);
    release(record(targets[0]));
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not report success when the commit fails or returns another slot', async () => {
    for (const final of [
      () => Promise.reject(new Error('private database body ' + secret)),
      () => Promise.resolve({ state: 'complete', slot: 'wrong' }),
    ]) {
      const rpc = vi.fn().mockResolvedValueOnce(claim()).mockImplementationOnce(final);
      const response = await createStatusCollector({
        secret,
        rpc,
        probeTarget: async (target) => record(target),
      })(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(secret);
    }
  });

  it('clears the successful cycle timer', async () => {
    vi.useFakeTimers();
    const rpc = vi.fn().mockResolvedValue({ state: 'complete' });
    await createStatusCollector({ secret, rpc })(request());
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('collector database requests', () => {
  it('sends credentials only to the configured RPC and clears its timer', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ state: 'busy' }));
    const parent = new AbortController();
    const rpc = createCollectorRpc('https://database.invalid', secret, transport);
    expect(
      await rpc('claim_status_collection', { p_runner: 'github-actions' }, parent.signal),
    ).toEqual({ state: 'busy' });
    const [url, init] = transport.mock.calls[0];
    expect(String(url)).toBe('https://database.invalid/rest/v1/rpc/claim_status_collection');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + secret);
    expect(init?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a stalled successful response body when its parent stops', async () => {
    const cancel = vi.fn();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 200 }));
    const parent = new AbortController();
    const rpc = createCollectorRpc('https://database.invalid', secret, transport);
    const pending = rpc('claim_status_collection', {}, parent.signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(DOMException);
    await Promise.resolve();
    await Promise.resolve();
    parent.abort();
    await rejected;
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('closes a response that arrives after cancellation without reading it', async () => {
    const cancel = vi.fn();
    let deliver!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const parent = new AbortController();
    const rpc = createCollectorRpc('https://database.invalid', secret, transport);
    const pending = rpc('claim_status_collection', {}, parent.signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(DOMException);
    parent.abort();
    await rejected;
    deliver(new Response(new ReadableStream({ cancel }), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds a transport that never settles and hides private error bodies', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const rpc = createCollectorRpc('https://database.invalid', secret, transport);
    const pending = rpc('claim_status_collection', {}, new AbortController().signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(DOMException);
    await vi.advanceTimersByTimeAsync(15_001);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    const failing = createCollectorRpc(
      'https://database.invalid',
      secret,
      async () => new Response(secret, { status: 503 }),
    );
    await expect(
      failing('claim_status_collection', {}, new AbortController().signal),
    ).rejects.toThrow('Database collector request failed');
  });
});
