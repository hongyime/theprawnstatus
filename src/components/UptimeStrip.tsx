import { useState, type ReactNode } from 'react';

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
  const [expanded, setExpanded] = useState(false);
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
    <div className="space-y-2">
      <div
        role="img"
        aria-label={ariaLabel}
        className="grid h-8 w-full min-w-0 grid-cols-[repeat(90,minmax(0,1fr))] items-end gap-[0.5px] sm:gap-px"
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
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className="focus-ring cursor-pointer font-display text-xs font-bold underline underline-offset-4">
          Daily history
        </summary>
        {expanded ? (
          <div
            role="region"
            aria-label="Daily uptime history"
            tabIndex={0}
            className="focus-ring mt-2 max-h-64 overflow-y-auto border-3 border-ink p-2"
          >
            <p className="mb-2 text-xs">
              Dates are in UTC.
              {stale ? ' This is historical data; the current status is stale.' : ''}
            </p>
            <dl className="space-y-2 text-xs tabular">
              {[...states].reverse().map(({ bucket }) => (
                <div key={bucket.d} className="border-b border-ink pb-2 last:border-0">
                  <dt className="font-bold">
                    <time dateTime={bucket.d}>{bucket.d}</time>
                  </dt>
                  <dd>
                    {bucket.n === 0
                      ? 'No data'
                      : `${dayState(bucket)} — ${formatPercent(bucket.ok / bucket.n)}, ${bucket.ok}/${bucket.n} checks successful, median ${formatLatency(bucket.p50)}`}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </details>
    </div>
  );
}
