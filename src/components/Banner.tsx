import type { ReactNode } from 'react';

export function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'error' | 'info';
  children: ReactNode;
}): ReactNode {
  const toneClass = {
    warn: 'bg-degraded',
    error: 'bg-down text-paper',
    info: 'bg-cyan',
  }[tone];

  return (
    <div className={`border-3 border-ink px-4 py-3 font-display text-sm uppercase shadow-hard ${toneClass}`}>
      {children}
    </div>
  );
}
