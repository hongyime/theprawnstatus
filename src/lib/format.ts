export function formatLatency(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) {
    return '-';
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '-';
  }

  return `${(value * 100).toFixed(2)}%`;
}

export function formatRelativeTime(value: string | null): string {
  if (value === null) {
    return 'never';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function ageMinutes(value: string | null, now = new Date()): number | null {
  if (value === null) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return (now.getTime() - date.getTime()) / 60_000;
}
