import type { ProbeRecord, TargetConfig } from './types.ts';
import { probe } from './probe.ts';
import { abortable } from './request-lifetime.ts';

export const COLLECTOR_CONCURRENCY = 8;
export const COLLECTOR_MAX_TARGETS = 24;
export const COLLECTOR_BUDGET_MS = 140_000;
export const COLLECTOR_RPC_TIMEOUT_MS = 15_000;
export const COLLECTOR_RPC_MAX_BYTES = 131_072;

type RpcName = 'claim_status_collection' | 'commit_status_collection';
type Rpc = (
  name: RpcName,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;
interface CollectorDependencies {
  secret: string;
  authorizeVerifiedRequest?: (request: Request) => boolean | Promise<boolean>;
  rpc: Rpc;
  probeTarget?: (target: TargetConfig, signal: AbortSignal) => Promise<ProbeRecord>;
  budgetMs?: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function targetsFrom(value: unknown): TargetConfig[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > COLLECTOR_MAX_TARGETS) {
    throw new Error('Invalid collector targets');
  }
  const ids = new Set<string>();
  return value.map((target: unknown) => {
    if (
      !object(target) ||
      typeof target.id !== 'string' ||
      !/^[a-z0-9-]{1,100}$/.test(target.id) ||
      ids.has(target.id) ||
      typeof target.name !== 'string' ||
      target.name.length === 0 ||
      target.name.length > 200 ||
      typeof target.url !== 'string' ||
      target.url.length > 2048 ||
      !Number.isInteger(target.expect) ||
      Number(target.expect) < 100 ||
      Number(target.expect) > 599 ||
      (target.follow_redirects !== undefined && typeof target.follow_redirects !== 'boolean')
    ) {
      throw new Error('Invalid collector target');
    }
    const url = new URL(target.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Invalid collector target URL');
    }
    ids.add(target.id);
    return target as unknown as TargetConfig;
  });
}

async function authorized(header: string | null, secret: string): Promise<boolean> {
  if (
    secret.length < 32 ||
    header === null ||
    header.length > 4096 ||
    !header.startsWith('Bearer ')
  )
    return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(header.slice(7))),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const a = new Uint8Array(actual);
  const b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

/** The hosted adapter authorizes platform-verified claims; callers supply no targets or IDs. */
export function createStatusCollector(dependencies: CollectorDependencies) {
  const probeTarget = dependencies.probeTarget ?? ((target, signal) => probe(target, { signal }));
  const requestedBudget = dependencies.budgetMs ?? COLLECTOR_BUDGET_MS;
  const budget =
    Number.isFinite(requestedBudget) && requestedBudget > 0
      ? Math.min(requestedBudget, COLLECTOR_BUDGET_MS)
      : COLLECTOR_BUDGET_MS;
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST')
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const accepted = dependencies.authorizeVerifiedRequest
      ? await dependencies.authorizeVerifiedRequest(request)
      : await authorized(request.headers.get('authorization'), dependencies.secret);
    if (!accepted) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException('Collector time limit reached', 'TimeoutError')),
      budget,
    );
    const signal = controller.signal;
    try {
      const claim = await abortable(signal, () =>
        dependencies.rpc('claim_status_collection', { p_runner: 'github-actions' }, signal),
      );
      if (!object(claim)) throw new Error('Invalid collector claim');
      if (['disabled', 'busy', 'complete'].includes(String(claim.state))) {
        return Response.json({ state: claim.state, checked: 0 });
      }
      if (
        claim.state !== 'claimed' ||
        typeof claim.token !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claim.token) ||
        typeof claim.slot !== 'string' ||
        !Number.isFinite(Date.parse(claim.slot))
      ) {
        throw new Error('Invalid collector claim');
      }
      const targets = targetsFrom(claim.targets);
      const records: ProbeRecord[] = new Array(targets.length);
      let next = 0;
      async function worker(): Promise<void> {
        for (;;) {
          if (signal.aborted) throw signal.reason;
          const index = next++;
          if (index >= targets.length) return;
          records[index] = await abortable(signal, () => probeTarget(targets[index], signal));
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(COLLECTOR_CONCURRENCY, targets.length) }, () => worker()),
      );
      if (signal.aborted) throw signal.reason;
      const committed = await abortable(signal, () =>
        dependencies.rpc(
          'commit_status_collection',
          {
            p_runner: 'github-actions',
            p_token: claim.token,
            p_records: records,
          },
          signal,
        ),
      );
      if (!object(committed) || committed.state !== 'complete' || committed.slot !== claim.slot) {
        throw new Error('Invalid collector commit response');
      }
      return Response.json({ state: 'complete', checked: records.length });
    } catch {
      // Database bodies, tokens and target URLs are deliberately absent here.
      return Response.json({ error: 'collection_incomplete' }, { status: 503 });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

function discard(response: Response | undefined): void {
  try {
    void response?.body?.cancel().catch(() => undefined);
  } catch {
    /* Response already consumed. */
  }
}

async function readRpcBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) throw new Error('Empty database response');
  const reader = response.body.getReader();
  const stop = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', stop, { once: true });
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return await abortable(signal, async () => {
      for (;;) {
        const chunk = await reader.read();
        if (signal.aborted) throw signal.reason;
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > COLLECTOR_RPC_MAX_BYTES) throw new Error('Database response exceeds limit');
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode()) as unknown;
    });
  } finally {
    signal.removeEventListener('abort', stop);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Minimal REST adapter; every request and response body belongs to a deadline. */
export function createCollectorRpc(url: string, key: string, fetchImpl: typeof fetch = fetch): Rpc {
  const base = new URL(url);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || !key) {
    throw new Error('Invalid collector database configuration');
  }
  return async (name, parameters, parent) => {
    const controller = new AbortController();
    const signal = AbortSignal.any([parent, controller.signal]);
    const timer = setTimeout(
      () =>
        controller.abort(new DOMException('Database request time limit reached', 'TimeoutError')),
      COLLECTOR_RPC_TIMEOUT_MS,
    );
    let response: Response | undefined;
    const body = JSON.stringify(parameters);
    try {
      return await abortable(signal, async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          response = await fetchImpl(new URL('/rest/v1/rpc/' + name, base), {
            method: 'POST',
            signal,
            headers: {
              apikey: key,
              authorization: 'Bearer ' + key,
              'content-type': 'application/json',
            },
            body,
          });
          if (signal.aborted) {
            discard(response);
            throw signal.reason;
          }
          if (attempt === 0 && [502, 503, 504].includes(response.status)) {
            // Keep the exact payload and the original deadline. Commit retries are
            // idempotent; an uncertain claim may return busy without probing again.
            discard(response);
            response = undefined;
            let retryTimer: ReturnType<typeof setTimeout> | undefined;
            try {
              await abortable(
                signal,
                () =>
                  new Promise<void>((resolve) => {
                    retryTimer = setTimeout(resolve, 250);
                  }),
              );
            } finally {
              clearTimeout(retryTimer);
            }
            continue;
          }
          if (!response.ok) throw new Error('Database collector request failed');
          return await readRpcBody(response, signal);
        }
        throw new Error('Database collector request failed');
      });
    } finally {
      clearTimeout(timer);
      controller.abort();
      discard(response);
    }
  };
}
