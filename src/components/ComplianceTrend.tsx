import type { ReactNode } from 'react';

import type { HealthHistoryLine } from '@shared/types';
import { formatPercent } from '@/lib/format';

function pointsFor(history: HealthHistoryLine[]): string {
  if (history.length === 0) {
    return '';
  }

  if (history.length === 1) {
    const y = 100 - history[0].org_score * 100;
    return `0,${y} 100,${y}`;
  }

  return history
    .map((item, index) => {
      const x = (index / (history.length - 1)) * 100;
      const y = 100 - item.org_score * 100;
      return `${x},${y}`;
    })
    .join(' ');
}

export function ComplianceTrend({ history }: { history: HealthHistoryLine[] }): ReactNode {
  const recent = history.slice(-90);
  const last = recent.at(-1);

  return (
    <div className="border-3 border-ink bg-paper p-3 shadow-hard">
      <div className="mb-2 flex items-end justify-between gap-4">
        <h2 className="font-display text-xl font-bold uppercase">Compliance Trend</h2>
        <div className="font-display text-sm font-bold tabular">{formatPercent(last?.org_score ?? null)}</div>
      </div>
      <svg
        role="img"
        aria-label={`Compliance trend with ${recent.length} data point${recent.length === 1 ? '' : 's'}.`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-28 w-full border-3 border-ink bg-paper"
      >
        <polyline points={pointsFor(recent)} fill="none" stroke="#111111" strokeWidth="4" vectorEffect="non-scaling-stroke" />
        {recent.length === 0 ? (
          <line x1="0" y1="100" x2="100" y2="100" stroke="#111111" strokeWidth="4" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
    </div>
  );
}
