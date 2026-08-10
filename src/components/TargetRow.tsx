import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

import type { TargetSummary } from '@shared/types';
import { formatLatency, formatPercent, formatRelativeTime } from '@/lib/format';
import { Metric, StatePill } from './primitives';
import { UptimeStrip } from './UptimeStrip';

export function TargetRow({
  target,
  generatedAt,
  stale,
}: {
  target: TargetSummary;
  generatedAt: string | null;
  stale: boolean;
}): ReactNode {
  const p95Title = `p95 ${formatLatency(target.p95_ms)}`;

  return (
    <article className="grid min-h-24 grid-cols-1 gap-4 border-3 border-ink bg-paper p-4 shadow-hard md:grid-cols-[minmax(150px,1.2fr)_120px_minmax(260px,2.4fr)_96px_96px] md:items-center">
      <div className="min-w-0">
        <a
          className="focus-ring inline-flex max-w-full items-center gap-2 font-display text-xl uppercase underline decoration-3 underline-offset-4"
          href={target.url}
          target="_blank"
          rel="noreferrer"
        >
          <span className="truncate">{target.name}</span>
          <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
        </a>
        <div className="mt-2 truncate font-mono text-xs tabular">{target.url.replace(/^https:\/\//, '')}</div>
      </div>

      <StatePill state={target.current.state} stale={stale} />

      <UptimeStrip
        days={target.days}
        generatedAt={generatedAt}
        stale={stale}
        uptime={target.uptime_90d}
      />

      <Metric label="uptime" value={stale ? '-' : formatPercent(target.uptime_90d)} />
      <Metric
        label="p50"
        value={stale ? '-' : formatLatency(target.p50_ms)}
        title={stale ? 'data is stale' : p95Title}
      />

      <div className="font-mono text-xs tabular md:col-span-5">
        Last check: {formatRelativeTime(target.current.checked_at)}
      </div>
    </article>
  );
}
