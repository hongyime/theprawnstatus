import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, Filter, Layers3 } from 'lucide-react';

import type { HealthHistoryLine, HealthReport, RepoHealth } from '@shared/types';
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

function groupRows(rows: RepoHealth[], mode: GroupMode, flatLabel: string): Array<[string, RepoHealth[]]> {
  if (mode === 'none') {
    return [[flatLabel, rows]];
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

function ScoreTrend({ history }: { history: HealthHistoryLine[] }): ReactNode {
  const recent = history.slice(-90);
  const last = recent.at(-1);
  const pointCount = recent.length;

  return (
    <div className="min-w-0 lg:w-52">
      <div className="mb-1 flex items-center justify-between gap-2 font-display text-[10px] font-bold uppercase tabular opacity-70">
        <span>Trend</span>
        <span>{pointCount === 0 ? 'No samples' : `${pointCount} sample${pointCount === 1 ? '' : 's'}`}</span>
      </div>
      <div className="flex items-end gap-2">
        <svg
          role="img"
          aria-label={`Repo score trend with ${pointCount} data sample${pointCount === 1 ? '' : 's'}.`}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-10 min-w-0 flex-1 overflow-visible"
        >
          <line x1="0" y1="96" x2="100" y2="96" stroke="#a3a3a3" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <polyline points={pointsFor(recent)} fill="none" stroke="#000000" strokeWidth="4" vectorEffect="non-scaling-stroke" />
          {last !== undefined ? (
            <circle
              cx={recent.length === 1 ? 50 : 98}
              cy={100 - last.org_score * 100}
              r="3"
              fill="#ffffff"
              stroke="#000000"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <line x1="0" y1="96" x2="100" y2="96" stroke="#000000" strokeWidth="4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <span>{formatPercent(last?.org_score ?? null)}</span>
      </div>
    </div>
  );
}

function RepoCard({ repo, stale }: { repo: RepoHealth; stale: boolean }): ReactNode {
  return (
    <article className="flex min-h-[118px] flex-col justify-between gap-3 border-3 border-ink bg-paper p-3 shadow-hardSm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-display text-base font-bold uppercase leading-tight">
          <span className="block truncate">{repo.name}</span>
        </div>
        <div className="shrink-0 pt-0.5 font-display text-xs font-bold uppercase tabular opacity-70">
          {stale ? '-' : `${repo.score}/${repo.max}`}
        </div>
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
    </article>
  );
}

export function HealthTable({
  report,
  history,
  loading,
  stale,
}: {
  report: HealthReport | null;
  history: HealthHistoryLine[];
  loading: boolean;
  stale: boolean;
}): ReactNode {
  const [nonCompliantOnly, setNonCompliantOnly] = useState(true);
  const [sort, setSort] = useState<SortMode>('score');
  const [group, setGroup] = useState<GroupMode>('none');
  const failingCount = report?.repos.filter((repo) => repo.fail.length > 0).length ?? 0;
  const flatGroupLabel = nonCompliantOnly ? 'Repos needing fixes' : 'All repos';

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

  const scopeSummary = nonCompliantOnly
    ? `showing ${failingCount}/${report.repos.length} repos - fixes only`
    : `showing all ${report.repos.length} repos - ${failingCount} need fixes`;

  return (
    <section className="space-y-3">
      <div className="grid gap-3 border-3 border-ink bg-paper p-3 shadow-hard lg:grid-cols-[minmax(0,1fr)_208px_auto] lg:items-center">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold uppercase">Repo Standards</h2>
          <p className="mt-1 font-display text-xs font-bold uppercase tabular opacity-70">
            {stale ? 'stale' : formatPercent(report.org_score)} score - {scopeSummary} - checked{' '}
            {formatRelativeTime(report.generated_at)}
          </p>
        </div>
        <ScoreTrend history={history} />
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <ShellButton
            type="button"
            aria-pressed={nonCompliantOnly}
            className={nonCompliantOnly ? 'bg-neo shadow-none translate-x-[2px] translate-y-[3px]' : ''}
            onClick={() => setNonCompliantOnly((value) => !value)}
          >
            <Filter aria-hidden="true" className="h-4 w-4" />
            {nonCompliantOnly ? 'Fixes Only' : 'All Repos'}
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
        groupRows(rows, group, flatGroupLabel).map(([label, groupedRows]) => (
          <div key={label} className="space-y-3">
            <div className="border-b-3 border-ink bg-neo px-3 py-2 font-display text-xs font-bold uppercase">
              {checkLabel(label)} - {groupedRows.length}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groupedRows.map((repo) => (
                <RepoCard key={`${label}-${repo.name}`} repo={repo} stale={stale} />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
