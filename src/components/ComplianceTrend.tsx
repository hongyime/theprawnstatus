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
  const pointCount = recent.length;

  return (
    <div className="border-3 border-ink bg-paper p-3 shadow-hard">
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold uppercase">Repo Score Trend</h2>
          <p className="font-display text-[11px] font-bold uppercase opacity-70">
            {pointCount === 0 ? 'No daily points yet' : `${pointCount} daily point${pointCount === 1 ? '' : 's'}`}
          </p>
        </div>
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
        {last !== undefined ? (
          <circle
            cx={recent.length === 1 ? 50 : 98}
            cy={100 - last.org_score * 100}
            r="3"
            fill="#ffffff"
            stroke="#111111"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {recent.length === 0 ? (
          <line x1="0" y1="100" x2="100" y2="100" stroke="#111111" strokeWidth="4" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      {last !== undefined ? (
        <div className="mt-2 font-display text-[11px] font-bold uppercase tabular opacity-70">
          Passing repos {last.compliant}/{last.repos}
        </div>
      ) : null}
    </div>
  );
}
