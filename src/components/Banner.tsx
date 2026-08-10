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
    info: 'bg-neo',
  }[tone];

  return (
    <div className={`border-3 border-ink px-3 py-2 font-display text-xs font-bold uppercase shadow-hardSm ${toneClass}`}>
      {children}
    </div>
  );
}
