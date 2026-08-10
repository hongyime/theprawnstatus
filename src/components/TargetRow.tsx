import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

import type { TargetSummary } from '@shared/types';
import { formatCompactDateTime, formatLatency, formatPercent } from '@/lib/format';
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
    <article className="flex h-full min-h-[190px] flex-col gap-3 border-3 border-ink bg-paper p-3 shadow-hard transition-transform hover:translate-x-[3px] hover:translate-y-[4px] hover:shadow-hardSm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            className="focus-ring inline-flex max-w-full items-center gap-2 border-b-3 border-transparent font-display text-lg font-bold uppercase leading-tight hover:border-ink"
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
      </div>

      <UptimeStrip
        days={target.days}
        generatedAt={generatedAt}
        stale={stale}
        uptime={target.uptime_90d}
      />

      <div className="mt-auto grid grid-cols-3 gap-2 border-t-3 border-ink pt-3">
        <Metric label="uptime" value={stale ? '-' : formatPercent(target.uptime_90d)} />
        <Metric
          label="median"
          value={stale ? '-' : formatLatency(target.p50_ms)}
          title={stale ? 'data is stale' : p95Title}
        />
        <Metric label="checked" value={formatCompactDateTime(target.current.checked_at)} />
      </div>
    </article>
  );
}
