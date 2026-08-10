import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, Filter, Layers3 } from 'lucide-react';

import type { HealthReport, RepoHealth } from '@shared/types';
import { formatPercent, formatRelativeTime } from '@/lib/format';
import { ShellButton } from './primitives';

type SortMode = 'score' | 'name';
type GroupMode = 'none' | 'check';

function repoScore(repo: RepoHealth): number {
  return repo.max === 0 ? 1 : repo.score / repo.max;
}

function sortedRows(rows: RepoHealth[], sort: SortMode): RepoHealth[] {
  return [...rows].sort((a, b) => {
    if (sort === 'name') {
      return a.name.localeCompare(b.name);
    }

    const scoreDelta = repoScore(a) - repoScore(b);
    return scoreDelta === 0 ? a.name.localeCompare(b.name) : scoreDelta;
  });
}

function groupRows(rows: RepoHealth[], mode: GroupMode): Array<[string, RepoHealth[]]> {
  if (mode === 'none') {
    return [['All repos', rows]];
  }

  const groups = new Map<string, RepoHealth[]>();
  for (const repo of rows) {
    const keys = repo.fail.length === 0 ? ['Passing'] : repo.fail;
    for (const key of keys) {
      groups.set(key, [...(groups.get(key) ?? []), repo]);
    }
  }

  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function HealthTable({
  report,
  loading,
  stale,
}: {
  report: HealthReport | null;
  loading: boolean;
  stale: boolean;
}): ReactNode {
  const [nonCompliantOnly, setNonCompliantOnly] = useState(true);
  const [sort, setSort] = useState<SortMode>('score');
  const [group, setGroup] = useState<GroupMode>('none');

  const rows = useMemo(() => {
    if (report === null) {
      return [];
    }

    const filtered = nonCompliantOnly
      ? report.repos.filter((repo) => repo.fail.length > 0)
      : report.repos;
    return sortedRows(filtered, sort);
  }, [nonCompliantOnly, report, sort]);

  if (loading) {
    return <div className="border-3 border-ink bg-paper p-6 font-display uppercase shadow-hard">Loading health data</div>;
  }

  if (report === null || report.generated_at === null) {
    return (
      <div className="border-3 border-ink bg-paper p-6 font-display uppercase shadow-hard">
        Health data pending
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 border-3 border-ink bg-paper p-4 shadow-hard lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-3xl uppercase">Repo Health</h2>
          <p className="mt-1 font-mono text-sm tabular">
            {stale ? 'stale' : formatPercent(report.org_score)} org score - {report.repos.length} repos - checked{' '}
            {formatRelativeTime(report.generated_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ShellButton
            type="button"
            aria-pressed={nonCompliantOnly}
            onClick={() => setNonCompliantOnly((value) => !value)}
          >
            <Filter aria-hidden="true" className="h-4 w-4" />
            Failing
          </ShellButton>
          <ShellButton
            type="button"
            onClick={() => setSort((value) => (value === 'score' ? 'name' : 'score'))}
          >
            <ArrowUpDown aria-hidden="true" className="h-4 w-4" />
            {sort}
          </ShellButton>
          <ShellButton
            type="button"
            onClick={() => setGroup((value) => (value === 'none' ? 'check' : 'none'))}
          >
            <Layers3 aria-hidden="true" className="h-4 w-4" />
            {group === 'none' ? 'Group' : 'Flat'}
          </ShellButton>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-3 border-ink bg-up p-6 font-display uppercase shadow-hard">
          No non-compliant repos in this report
        </div>
      ) : (
        groupRows(rows, group).map(([label, groupedRows]) => (
          <div key={label} className="border-3 border-ink bg-paper shadow-hard">
            <div className="border-b-3 border-ink bg-cyan px-4 py-2 font-display text-sm uppercase">
              {label} - {groupedRows.length}
            </div>
            <div className="divide-y-3 divide-ink">
              {groupedRows.map((repo) => (
                <div
                  key={`${label}-${repo.name}`}
                  className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_100px_minmax(220px,2fr)] md:items-center"
                >
                  <div className="min-w-0 font-display text-lg uppercase">
                    <span className="block truncate">{repo.name}</span>
                  </div>
                  <div className="font-mono text-sm font-black tabular">
                    {stale ? '-' : `${repo.score}/${repo.max}`}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {repo.fail.length === 0 ? (
                      <span className="border-2 border-ink bg-up px-2 py-1 font-display text-xs uppercase">
                        passing
                      </span>
                    ) : (
                      repo.fail.map((check) => (
                        <span
                          key={check}
                          className="border-2 border-ink bg-down px-2 py-1 font-display text-xs uppercase text-paper"
                        >
                          {check}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
