type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

/** Poll public dashboard data only while visible, with one request chain at a time. */
export function startVisiblePolling(
  load: () => Promise<boolean>,
  intervalMs: number,
  visibility: VisibilitySource = document,
): () => void {
  let stopped = false;
  let running = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  async function refresh(): Promise<void> {
    clearTimer();
    if (stopped || visibility.hidden || running) return;
    running = true;
    try {
      failures = (await load()) ? 0 : Math.min(failures + 1, 2);
    } catch {
      failures = Math.min(failures + 1, 2);
    } finally {
      running = false;
      if (!stopped && !visibility.hidden) {
        timer = setTimeout(() => void refresh(), intervalMs * 2 ** failures);
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
    clearTimer();
    visibility.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
