import { describe, expect, it, vi } from 'vitest';

import type { TargetConfig } from '../../shared/types';
import { probe } from './probe';

const target: TargetConfig = {
  id: 'app',
  name: 'App',
  url: 'https://app.example.com',
  expect: 200,
};

function testOptions(fetchImpl: typeof fetch) {
  let tick = 0;
  return {
    fetchImpl,
    now: () => '2026-08-10T00:00:00.000Z',
    nowMs: () => {
      tick += 25;
      return tick;
    },
    sleep: async () => undefined,
    backoffMs: [1, 1],
  };
}

describe('probe', () => {
  it('records a first-try 200', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }));

    const record = await probe(target, testOptions(fetchImpl));

    expect(record).toMatchObject({
      id: 'app',
      s: 200,
    });
    expect(record).not.toHaveProperty('e');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('records a final non-expected HTTP status without an error class', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 502 }));

    const record = await probe(target, testOptions(fetchImpl));

    expect(record).toMatchObject({ s: 502 });
    expect(record).not.toHaveProperty('e');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('classifies timeout as a response-less failure', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    await expect(probe(target, testOptions(fetchImpl))).resolves.toMatchObject({
      s: null,
      e: 'timeout',
    });
  });

  it('classifies DNS failure', async () => {
    const error = new TypeError('fetch failed') as TypeError & { cause: { code: string } };
    error.cause = { code: 'ENOTFOUND' };
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);

    await expect(probe(target, testOptions(fetchImpl))).resolves.toMatchObject({
      s: null,
      e: 'dns',
    });
  });

  it('records success when a transient failure succeeds on attempt 2', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const record = await probe(target, testOptions(fetchImpl));

    expect(record).toMatchObject({ s: 200 });
    expect(record).not.toHaveProperty('e');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('can treat a redirect response as the health signal', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('', {
        status: 308,
        headers: { location: 'https://destination.example.com' },
      }),
    );

    const record = await probe(
      { ...target, expect: 308, follow_redirects: false },
      testOptions(fetchImpl),
    );

    expect(record).toMatchObject({ s: 308 });
    expect(record).not.toHaveProperty('e');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns one response-less failure when every attempt fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    const record = await probe(target, testOptions(fetchImpl));
    expect(record).toMatchObject({ s: null, e: 'conn' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
