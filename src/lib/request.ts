export const REQUEST_TIMEOUT_MS = 8_000;
export const REFRESH_TIMEOUT_MS = 20_000;

/** Keep headers and body consumption inside the same cancellable deadline. */
export async function withDeadline<T>(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  const cancel = (): void => controller.abort(parent?.reason);
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('Data refresh timed out', 'TimeoutError')),
    timeoutMs,
  );
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    return await Promise.race([work(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}

export function requestJson<T>(
  url: string,
  signal?: AbortSignal,
  headers?: HeadersInit,
): Promise<T> {
  return withDeadline(signal, REQUEST_TIMEOUT_MS, async (requestSignal) => {
    const response = await fetch(url, { signal: requestSignal, headers, cache: 'no-store' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Data request returned ${response.status}`);
    }
    return (await response.json()) as T;
  });
}

/** A failed refresh should never replace newer loaded data with an older snapshot. */
export function preferLoaded(
  loaded: { generated_at: string | null } | null,
  snapshot: { generated_at: string | null },
): boolean {
  if (loaded === null) return false;
  const timestamp = (value: string | null): number => {
    const parsed = Date.parse(value ?? '');
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  return timestamp(loaded.generated_at) >= timestamp(snapshot.generated_at);
}
