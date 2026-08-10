import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

import type { ErrorClass, ProbeRecord, TargetConfig } from '../../shared/types';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_BACKOFF_MS = [1_000, 3_000] as const;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'theprawnstatus/1.0 (+https://github.com/hongyime/theprawnstatus)';

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  now?: () => string;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  backoffMs?: readonly number[];
}

interface AttemptResult {
  status: number | null;
  ms: number;
  errorClass?: ErrorClass;
}

function classifyError(error: unknown): ErrorClass {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'timeout';
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'abort';
  }

  const code = findErrorCode(error);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'dns';
  }

  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return 'tls';
  }

  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH'
  ) {
    return 'conn';
  }

  return 'conn';
}

function findErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === 'string') {
    return maybeCode;
  }

  return findErrorCode((error as { cause?: unknown }).cause);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399;
}

async function fetchWithRedirects(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Response> {
  let current = url;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': USER_AGENT,
      },
    });

    if (!isRedirect(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (location === null) {
      return response;
    }

    if (redirects === MAX_REDIRECTS) {
      throw new DOMException('Too many redirects', 'AbortError');
    }

    current = new URL(location, current).toString();
  }

  throw new DOMException('Too many redirects', 'AbortError');
}

async function runAttempt(target: TargetConfig, options: Required<ProbeOptions>): Promise<AttemptResult> {
  const started = options.nowMs();
  try {
    const signal = AbortSignal.timeout(options.timeoutMs);
    const response = await fetchWithRedirects(target.url, options.fetchImpl, signal);
    return {
      status: response.status,
      ms: Math.round(options.nowMs() - started),
    };
  } catch (error) {
    return {
      status: null,
      ms: Math.round(options.nowMs() - started),
      errorClass: classifyError(error),
    };
  }
}

export async function probe(target: TargetConfig, options: ProbeOptions = {}): Promise<ProbeRecord> {
  const resolved: Required<ProbeOptions> = {
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => new Date().toISOString()),
    nowMs: options.nowMs ?? (() => performance.now()),
    sleep: options.sleep ?? sleep,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    backoffMs: options.backoffMs ?? DEFAULT_BACKOFF_MS,
  };

  let result: AttemptResult = { status: null, ms: 0, errorClass: 'conn' };

  for (let attempt = 0; attempt <= resolved.backoffMs.length; attempt += 1) {
    result = await runAttempt(target, resolved);
    if (result.status === target.expect && result.errorClass === undefined) {
      break;
    }

    if (attempt < resolved.backoffMs.length) {
      await resolved.sleep(resolved.backoffMs[attempt]);
    }
  }

  const record: ProbeRecord = {
    t: resolved.now(),
    id: target.id,
    s: result.status,
    ms: result.ms,
  };

  if (result.errorClass !== undefined) {
    record.e = result.errorClass;
  }

  return record;
}
