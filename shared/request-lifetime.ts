/** Wait for an operation only while its owning request is alive. */
export async function abortable<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let stop!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    return await Promise.race([task(), aborted]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
