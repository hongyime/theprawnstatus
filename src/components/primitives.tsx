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
      className={`focus-ring inline-flex h-10 items-center justify-center gap-2 border-3 border-ink bg-paper px-3 font-display text-sm uppercase shadow-hardSm transition-transform hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
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
      className={`inline-flex h-8 min-w-24 items-center justify-center border-3 border-ink px-3 font-display text-xs uppercase text-ink shadow-hardSm state-${visualState} ${
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
    <div className="min-w-20 text-right" title={title}>
      <div className="font-mono text-lg font-black leading-none tabular">{value}</div>
      <div className="mt-1 font-display text-[10px] uppercase">{label}</div>
    </div>
  );
}
