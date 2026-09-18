'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, Filter } from 'lucide-react';

import type { TargetSummary } from '@shared/types';
import { ShellButton } from './primitives';
import { TargetRow } from './TargetRow';

type FilterMode = 'all' | 'issues';
type SortMode = 'name' | 'uptime' | 'latency';

function sortTargets(targets: TargetSummary[], sort: SortMode): TargetSummary[] {
  return [...targets].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'uptime') {
      const ua = a.uptime_90d ?? -1;
      const ub = b.uptime_90d ?? -1;
      return ua === ub ? a.name.localeCompare(b.name) : ua - ub;
    }
    // latency: ascending (fastest first), nulls last
    const la = a.p50_ms ?? Infinity;
    const lb = b.p50_ms ?? Infinity;
    return la === lb ? a.name.localeCompare(b.name) : la - lb;
  });
}

export function DeploymentSection({
  targets,
  generatedAt,
  stale,
  loading,
}: {
  targets: TargetSummary[];
  generatedAt: string | null;
  stale: boolean;
  loading: boolean;
}): ReactNode {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('name');

  const issueCount = useMemo(
    () => targets.filter((t) => t.current.state !== 'up').length,
    [targets],
  );

  const displayed = useMemo(() => {
    const filtered =
      filterMode === 'issues' ? targets.filter((t) => t.current.state !== 'up') : targets;
    return sortTargets(filtered, sort);
  }, [targets, filterMode, sort]);

  return (
    <section className="space-y-3">
      <div className="border-3 border-ink bg-paper p-3 text-center shadow-hard">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-2xl font-bold uppercase">Deployments</h2>
          <p className="font-display text-xs font-bold uppercase tabular opacity-70">
            {targets.length} targets · scheduled every 5 min · stale after 20 min · page refreshes
            every 2 min while visible
          </p>
        </div>
      </div>

      {!loading && targets.length > 0 && (
        <div className="flex flex-col gap-3 border-b-3 border-ink bg-neo px-3 py-2 md:flex-row md:items-center md:justify-between">
          <div className="font-display text-xs font-bold uppercase">
            {filterMode === 'issues'
              ? `Issues — ${displayed.length}`
              : `All targets — ${displayed.length}`}
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <ShellButton
              type="button"
              aria-pressed={filterMode === 'issues'}
              className={
                filterMode === 'issues'
                  ? 'bg-neo shadow-none translate-x-[2px] translate-y-[3px]'
                  : ''
              }
              onClick={() => setFilterMode((v) => (v === 'all' ? 'issues' : 'all'))}
            >
              <Filter aria-hidden="true" className="h-4 w-4" />
              {filterMode === 'issues' ? `Issues (${issueCount})` : 'All'}
            </ShellButton>
            <ShellButton
              type="button"
              onClick={() =>
                setSort((v) => (v === 'name' ? 'uptime' : v === 'uptime' ? 'latency' : 'name'))
              }
            >
              <ArrowUpDown aria-hidden="true" className="h-4 w-4" />
              {sort}
            </ShellButton>
          </div>
        </div>
      )}

      {loading ? (
        <div className="border-3 border-ink bg-paper p-4 font-display font-bold uppercase shadow-hard">
          Loading status data
        </div>
      ) : displayed.length === 0 && filterMode === 'issues' ? (
        <div className="border-3 border-ink bg-up p-4 font-display font-bold uppercase shadow-hard">
          All deployments are up
        </div>
      ) : displayed.length === 0 ? (
        <div className="border-3 border-ink bg-paper p-4 font-display font-bold uppercase shadow-hard">
          No deployment samples yet
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {displayed.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              generatedAt={generatedAt}
              stale={stale}
            />
          ))}
        </div>
      )}
    </section>
  );
}
