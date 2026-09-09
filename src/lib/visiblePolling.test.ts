import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startVisiblePolling } from './visiblePolling';

class Visibility extends EventTarget {
  hidden = false;

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

describe('dashboard polling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([120_000, 900_000])('waits %i ms between successful request chains', async (interval) => {
    const load = vi.fn().mockResolvedValue(true);
    const stop = startVisiblePolling(load, interval, new Visibility());
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(interval - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not poll a hidden tab and refreshes once when it becomes visible', async () => {
    const visibility = new Visibility();
    visibility.hidden = true;
    const load = vi.fn().mockResolvedValue(true);
    const stop = startVisiblePolling(load, 120_000, visibility);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(load).not.toHaveBeenCalled();
    visibility.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    visibility.setHidden(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(load).toHaveBeenCalledTimes(1);
    visibility.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not overlap a slow request when the tab is revisited', async () => {
    const visibility = new Visibility();
    let finish!: (value: boolean) => void;
    const load = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const stop = startVisiblePolling(load, 120_000, visibility);
    await vi.advanceTimersByTimeAsync(600_000);
    visibility.setHidden(true);
    visibility.setHidden(false);
    expect(load).toHaveBeenCalledTimes(1);
    finish(true);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
    finish(true);
  });

  it('backs off failures to at most four intervals, then resets after recovery', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const stop = startVisiblePolling(load, 1_000, new Visibility());
    await vi.advanceTimersByTimeAsync(1_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(load).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(5);
    stop();
  });

  it('does not restart after disposal, including after an outstanding request finishes', async () => {
    const visibility = new Visibility();
    let finish!: (value: boolean) => void;
    const load = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const stop = startVisiblePolling(load, 120_000, visibility);
    stop();
    finish(true);
    visibility.setHidden(true);
    visibility.setHidden(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
