import type {
  HealthHistoryLine,
  HealthReport,
  RepoHealth,
  StandardConfig,
} from '../../shared/types';
import type { RepoFacts } from './github';
import { checkModules } from './checks';

export function evaluateHealth(
  repos: RepoFacts[],
  standard: StandardConfig,
  now: Date,
): HealthReport {
  const repoHealth = repos
    .map((repo): RepoHealth => {
      const exempt = new Set(standard.exempt[repo.name] ?? []);
      const fail: string[] = [];
      let score = 0;
      let max = 0;

      for (const check of standard.checks) {
        if (exempt.has(check.id)) {
          continue;
        }

        const module = checkModules[check.id as keyof typeof checkModules];
        if (module === undefined) {
          throw new Error(`missing check module for ${check.id}`);
        }

        max += check.weight;
        const result = module({ repo, standard, check });
        if (result.pass) {
          score += check.weight;
        } else {
          fail.push(check.id);
        }
      }

      return {
        name: repo.name,
        score,
        max,
        archived: repo.archived,
        identity_clean: null,
        fail,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalScore = repoHealth.reduce((sum, repo) => sum + repo.score, 0);
  const totalMax = repoHealth.reduce((sum, repo) => sum + repo.max, 0);

  return {
    generated_at: now.toISOString(),
    standard_version: standard.standard_version,
    schema: 1,
    org_score: totalMax === 0 ? 0 : totalScore / totalMax,
    repos: repoHealth,
  };
}

export function historyLineFromReport(report: HealthReport, now: Date): HealthHistoryLine {
  const byCheck: Record<string, number> = {};

  for (const repo of report.repos) {
    for (const checkId of repo.fail) {
      byCheck[checkId] = (byCheck[checkId] ?? 0) + 1;
    }
  }

  return {
    d: now.toISOString().slice(0, 10),
    org_score: report.org_score,
    repos: report.repos.length,
    compliant: report.repos.filter((repo) => repo.fail.length === 0).length,
    by_check: byCheck,
  };
}

export function upsertHealthHistoryLine(
  content: string,
  line: HealthHistoryLine,
): string {
  const existing = content
    .split(/\r?\n/)
    .filter((raw) => raw.trim() !== '')
    .map((raw) => JSON.parse(raw) as HealthHistoryLine)
    .filter((item) => item.d !== line.d);

  existing.push(line);
  existing.sort((a, b) => a.d.localeCompare(b.d));

  return existing.map((item) => JSON.stringify(item)).join('\n') + '\n';
}
