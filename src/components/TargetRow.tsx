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
    <article className="grid grid-cols-1 gap-3 border-3 border-ink bg-paper p-3 shadow-hard transition-transform hover:translate-x-[3px] hover:translate-y-[4px] hover:shadow-hardSm md:grid-cols-[minmax(140px,1.1fr)_96px_minmax(220px,2.5fr)_76px_76px] md:items-center">
      <div className="min-w-0">
        <a
          className="focus-ring inline-flex max-w-full items-center gap-2 border-b-3 border-transparent font-display text-lg font-bold uppercase hover:border-ink"
          href={target.url}
          target="_blank"
          rel="noreferrer"
        >
          <span className="truncate">{target.name}</span>
          <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
        </a>
        <div className="mt-1 truncate font-display text-[11px] font-bold uppercase opacity-70">
          {target.url.replace(/^https:\/\//, '')}
        </div>
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

      <div className="font-display text-[11px] font-bold uppercase opacity-70 md:col-span-5">
        Last check: {formatRelativeTime(target.current.checked_at)}
      </div>
    </article>
  );
}
