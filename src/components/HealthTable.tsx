import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, Filter, Layers3 } from 'lucide-react';

import type { HealthReport, RepoHealth } from '@shared/types';
import { formatPercent, formatRelativeTime } from '@/lib/format';
import { ShellButton } from './primitives';

type SortMode = 'score' | 'name';
type GroupMode = 'none' | 'check';

const CHECK_LABELS: Record<string, string> = {
  license_is_full_apache_2: 'Apache license',
  notice_names_organisation: 'NOTICE',
  description_is_real: 'Description',
  topics_match_vocabulary: 'Topics',
  readme_meets_standard: 'README',
  showcase_meets_standard: 'Project link',
};

function checkLabel(check: string): string {
  return CHECK_LABELS[check] ?? check.replaceAll('_', ' ');
}

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
  const failingCount = report?.repos.filter((repo) => repo.fail.length > 0).length ?? 0;

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
    return <div className="border-3 border-ink bg-paper p-4 font-display font-bold uppercase shadow-hard">Loading health data</div>;
  }

  if (report === null || report.generated_at === null) {
    return (
      <div className="border-3 border-ink bg-paper p-4 font-display font-bold uppercase shadow-hard">
        Health data pending
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 border-3 border-ink bg-paper p-3 shadow-hard lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold uppercase">Repo Standards</h2>
          <p className="mt-1 font-display text-xs font-bold uppercase tabular opacity-70">
            {stale ? 'stale' : formatPercent(report.org_score)} score - {report.repos.length} repos -{' '}
            {failingCount} need fixes - checked {formatRelativeTime(report.generated_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ShellButton
            type="button"
            aria-pressed={nonCompliantOnly}
            onClick={() => setNonCompliantOnly((value) => !value)}
          >
            <Filter aria-hidden="true" className="h-4 w-4" />
            Needs Fixes
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
            {group === 'none' ? 'By Issue' : 'Flat'}
          </ShellButton>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-3 border-ink bg-up p-4 font-display font-bold uppercase shadow-hard">
          All repos pass this report
        </div>
      ) : (
        groupRows(rows, group).map(([label, groupedRows]) => (
          <div key={label} className="border-3 border-ink bg-paper shadow-hard">
            <div className="border-b-3 border-ink bg-neo px-3 py-2 font-display text-xs font-bold uppercase">
              {checkLabel(label)} - {groupedRows.length}
            </div>
            <div className="divide-y-3 divide-ink">
              {groupedRows.map((repo) => (
                <div
                  key={`${label}-${repo.name}`}
                  className="grid grid-cols-1 gap-2 px-3 py-2 md:grid-cols-[minmax(150px,1fr)_72px_minmax(200px,2fr)] md:items-center"
                >
                  <div className="min-w-0 font-display text-base font-bold uppercase">
                    <span className="block truncate">{repo.name}</span>
                  </div>
                  <div className="font-display text-sm font-bold tabular">
                    {stale ? '-' : `${repo.score}/${repo.max}`}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {repo.fail.length === 0 ? (
                      <span className="border-2 border-ink bg-up px-2 py-0.5 font-display text-[10px] font-bold uppercase">
                        passing
                      </span>
                    ) : (
                      repo.fail.map((check) => (
                        <span
                          key={check}
                          title={check}
                          className="border-2 border-ink bg-down px-2 py-0.5 font-display text-[10px] font-bold uppercase text-paper"
                        >
                          {checkLabel(check)}
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
