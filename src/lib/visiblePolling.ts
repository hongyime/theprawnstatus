type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

/** Poll public dashboard data only while visible, with one request chain at a time. */
export function startVisiblePolling(
  load: (signal: AbortSignal) => Promise<boolean>,
  intervalMs: number,
  visibility: VisibilitySource = document,
): () => void {
  let stopped = false;
  let running = false;
  let failures = 0;
  let dueAt = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  async function refresh(): Promise<void> {
    clearTimer();
    if (stopped || visibility.hidden || running) return;
    const remaining = dueAt - Date.now();
    if (remaining > 0) {
      timer = setTimeout(() => void refresh(), remaining);
      return;
    }
    running = true;
    controller = new AbortController();
    try {
      failures = (await load(controller.signal)) ? 0 : Math.min(failures + 1, 2);
    } catch {
      failures = Math.min(failures + 1, 2);
    } finally {
      running = false;
      controller = undefined;
      dueAt = Date.now() + intervalMs * 2 ** failures;
      if (!stopped && !visibility.hidden) {
        timer = setTimeout(() => void refresh(), dueAt - Date.now());
      }
    }
  }

  function onVisibilityChange(): void {
    clearTimer();
    if (!visibility.hidden) void refresh();
  }

  visibility.addEventListener('visibilitychange', onVisibilityChange);
  void refresh();

  return () => {
    stopped = true;
    controller?.abort();
    clearTimer();
    visibility.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
