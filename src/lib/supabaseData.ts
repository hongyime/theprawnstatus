import type { HealthHistoryLine, HealthReport, Summary } from '@shared/types';
import { requestJson } from './request';

interface SupabaseConfig {
  url: string;
  key: string;
}

interface StatusRunRow {
  summary: unknown;
}

interface HealthRunRow {
  report: unknown;
}

interface HealthHistoryRow {
  d: string;
  org_score: number;
  repos: number;
  compliant: number;
  by_check: Record<string, number>;
}

const env = import.meta.env as Record<string, string | undefined>;

function readConfig(): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY)?.trim();

  if (url === undefined || url === '' || key === undefined || key === '') {
    return null;
  }

  return { url: url.replace(/\/$/, ''), key };
}

export function hasSupabaseDataConfig(): boolean {
  return readConfig() !== null;
}

async function requestRows<T>(
  table: string,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<T[]> {
  const config = readConfig();
  if (config === null) {
    throw new Error('Supabase browser config is missing');
  }

  return requestJson<T[]>(`${config.url}/rest/v1/${table}?${query.toString()}`, signal, {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    Accept: 'application/json',
  });
}

export async function fetchLatestSummaryFromSupabase(signal?: AbortSignal): Promise<Summary> {
  const query = new URLSearchParams({
    select: 'summary',
    order: 'generated_at.desc',
    limit: '1',
  });
  const rows = await requestRows<StatusRunRow>('status_runs', query, signal);
  const summary = rows[0]?.summary;
  if (summary === undefined) {
    throw new Error('Supabase status data is empty');
  }
  return summary as Summary;
}

export async function fetchHealthSnapshotFromSupabase(signal?: AbortSignal): Promise<{
  report: unknown;
  reports: unknown[];
}> {
  const query = new URLSearchParams({ select: 'report', order: 'generated_at.desc', limit: '30' });
  const rows = await requestRows<HealthRunRow>('health_runs', query, signal);
  return { report: rows[0]?.report, reports: rows.map((row) => row.report).reverse() };
}

export async function fetchLatestHealthFromSupabase(): Promise<HealthReport> {
  const query = new URLSearchParams({
    select: 'report',
    order: 'generated_at.desc',
    limit: '1',
  });
  const rows = await requestRows<HealthRunRow>('health_runs', query);
  const report = rows[0]?.report;
  if (report === undefined) {
    throw new Error('Supabase health data is empty');
  }
  return report as HealthReport;
}

export async function fetchRecentHealthReportsFromSupabase(limit = 30): Promise<HealthReport[]> {
  const query = new URLSearchParams({
    select: 'report',
    order: 'generated_at.desc',
    limit: String(limit),
  });
  const rows = await requestRows<HealthRunRow>('health_runs', query);
  return rows
    .map((row) => row.report as HealthReport)
    .filter((report) => report.generated_at !== null)
    .reverse();
}

export async function fetchHealthHistoryFromSupabase(): Promise<HealthHistoryLine[]> {
  const query = new URLSearchParams({
    select: 'd,org_score,repos,compliant,by_check',
    order: 'd.asc',
  });
  const rows = await requestRows<HealthHistoryRow>('health_history', query);
  return rows.map((row) => ({
    d: row.d,
    org_score: row.org_score,
    repos: row.repos,
    compliant: row.compliant,
    by_check: row.by_check,
  }));
}
