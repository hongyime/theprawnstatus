import type { ReactNode } from 'react';

import type { DayBucket, DayState } from '@shared/types';
import { dayState } from '@shared/types';
import { formatLatency, formatPercent } from '@/lib/format';

const DAY_MS = 86_400_000;
const HEIGHT_BY_STATE: Record<DayState, string> = {
  up: 'h-7',
  degraded: 'h-6',
  down: 'h-4',
  'no-data': 'h-2',
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildWindow(endDate: Date): string[] {
  const start = addDays(
    new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())),
    -89,
  );

  return Array.from({ length: 90 }, (_, index) => dayString(addDays(start, index)));
}

export function UptimeStrip({
  days,
  generatedAt,
  stale,
  uptime,
}: {
  days: DayBucket[];
  generatedAt: string | null;
  stale: boolean;
  uptime: number | null;
}): ReactNode {
  const endDate = generatedAt === null ? new Date() : new Date(generatedAt);
  const byDay = new Map(days.map((bucket) => [bucket.d, bucket]));
  const states = buildWindow(endDate).map((day) => {
    const bucket = byDay.get(day) ?? { d: day, n: 0, ok: 0, p50: null };
    const state = stale ? 'no-data' : dayState(bucket);
    return { bucket, state };
  });
  const incidentDays = states.filter((item) => item.state === 'down').length;
  const ariaLabel = stale
    ? 'Status data is stale.'
    : `${formatPercent(uptime)} uptime over 90 days, ${incidentDays} down day${incidentDays === 1 ? '' : 's'}.`;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      className="focus-ring grid h-8 w-full min-w-0 grid-cols-[repeat(90,minmax(2px,1fr))] items-end gap-px"
    >
      {states.map(({ bucket, state }) => {
        const uptimePercent = bucket.n === 0 ? null : bucket.ok / bucket.n;
        const title =
          bucket.n === 0
            ? `${bucket.d}: no data`
            : `${bucket.d}: ${formatPercent(uptimePercent)}, ${bucket.ok}/${bucket.n} ok, p50 ${formatLatency(
                bucket.p50,
              )}`;

        return (
          <span
            key={bucket.d}
            aria-hidden="true"
            title={title}
            className={`block min-w-0 border border-ink state-${state} ${HEIGHT_BY_STATE[state]} ${
              state === 'degraded' ? 'pattern-degraded' : ''
            } ${state === 'down' ? 'pattern-down' : ''} ${state === 'no-data' ? 'pattern-no-data' : ''}`}
          />
        );
      })}
    </div>
  );
}
