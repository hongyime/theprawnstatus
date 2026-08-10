import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import type { DayState } from '@shared/types';

const STATE_WORDS: Record<DayState | 'stale', string> = {
  up: 'up',
  degraded: 'degraded',
  down: 'down',
  'no-data': 'no data',
  stale: 'stale',
};

export function ShellButton({
  children,
  className = '',
  ...props
}: ComponentPropsWithoutRef<'button'>): ReactNode {
  return (
    <button
      className={`focus-ring inline-flex h-9 items-center justify-center gap-2 border-3 border-ink bg-paper px-3 font-display text-xs font-bold uppercase shadow-hardSm transition-transform hover:translate-x-[2px] hover:translate-y-[3px] hover:shadow-none active:translate-x-[3px] active:translate-y-[4px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function StatePill({
  state,
  stale = false,
}: {
  state: DayState;
  stale?: boolean;
}): ReactNode {
  const visualState = stale ? 'no-data' : state;
  const word = stale ? STATE_WORDS.stale : STATE_WORDS[state];

  return (
    <span
      className={`inline-flex h-7 min-w-20 items-center justify-center border-3 border-ink px-2 font-display text-[11px] font-bold uppercase text-ink shadow-hardSm state-${visualState} ${
        visualState === 'degraded' ? 'pattern-degraded' : ''
      } ${visualState === 'down' ? 'pattern-down text-paper' : ''} ${
        visualState === 'no-data' ? 'pattern-no-data' : ''
      }`}
    >
      {word}
    </span>
  );
}

export function Metric({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}): ReactNode {
  return (
    <div className="min-w-16 text-right" title={title}>
      <div className="font-display text-base font-bold leading-none tabular">{value}</div>
      <div className="mt-0.5 font-display text-[10px] font-bold uppercase opacity-70">{label}</div>
    </div>
  );
}
