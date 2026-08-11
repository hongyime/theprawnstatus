import type {
  HealthHistoryLine,
  HealthReport,
  JsonValue,
  ProbeRecord,
  Summary,
} from '../../shared/types';

const DEFAULT_PAGE_SIZE = 1000;
const MAX_INSERT_ROWS = 500;
const DEFAULT_RUNNER = 'github-actions';

interface SupabaseConfig {
  url: string;
  key: string;
}

interface StatusRunRow {
  summary: JsonValue;
}

interface StatusSampleRow {
  checked_at: string;
  target_id: string;
  status: number | null;
  ms: number;
  error_class: string | null;
}

interface HealthRunRow {
  report: JsonValue;
}

interface HealthHistoryRow {
  d: string;
  org_score: number;
  repos: number;
  compliant: number;
  by_check: Record<string, number>;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

function supabaseUrl(): string | null {
  return env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
}

function supabaseServerKey(): string | null {
  return env('SUPABASE_SECRET_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY');
}

function supabaseReadKey(): string | null {
  return (
    env('SUPABASE_PUBLISHABLE_KEY') ??
    env('SUPABASE_ANON_KEY') ??
    env('VITE_SUPABASE_PUBLISHABLE_KEY') ??
    env('VITE_SUPABASE_ANON_KEY') ??
    supabaseServerKey()
  );
}

function runner(): string {
  return env('STATUS_RUNNER') ?? DEFAULT_RUNNER;
}

function configFor(kind: 'read' | 'write'): SupabaseConfig {
  const url = supabaseUrl();
  const key = kind === 'write' ? supabaseServerKey() : supabaseReadKey();

  if (url === null || key === null) {
    throw new Error(
      kind === 'write'
        ? 'SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY are required'
        : 'SUPABASE_URL and a Supabase read key are required',
    );
  }

  return { url: url.replace(/\/$/, ''), key };
}

export function hasSupabaseWriteConfig(): boolean {
  return supabaseUrl() !== null && supabaseServerKey() !== null;
}

export function hasSupabaseReadConfig(): boolean {
  return supabaseUrl() !== null && supabaseReadKey() !== null;
}

function restUrl(config: SupabaseConfig, table: string, query?: URLSearchParams): string {
  const suffix = query === undefined || query.size === 0 ? '' : `?${query.toString()}`;
  return `${config.url}/rest/v1/${table}${suffix}`;
}

async function requestJson<T>(
  config: SupabaseConfig,
  table: string,
  query: URLSearchParams | undefined,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('apikey', config.key);
  headers.set('Authorization', `Bearer ${config.key}`);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(restUrl(config, table, query), {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} request failed with ${response.status}: ${body}`);
  }

  const text = await response.text();
  if (text.trim() === '') {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

async function selectRows<T>(
  table: string,
  query: URLSearchParams,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const config = configFor('read');
  const rows: T[] = [];
  let offset = 0;

  for (;;) {
    const pageQuery = new URLSearchParams(query);
    pageQuery.set('limit', String(pageSize));
    pageQuery.set('offset', String(offset));
    const page = await requestJson<T[]>(config, table, pageQuery);
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }

    offset += pageSize;
  }
}

async function insertRows(table: string, rows: unknown[], onConflict?: string): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const query = new URLSearchParams();
  if (onConflict !== undefined) {
    query.set('on_conflict', onConflict);
  }

  const config = configFor('write');
  for (let start = 0; start < rows.length; start += MAX_INSERT_ROWS) {
    await requestJson(config, table, query, {
      method: 'POST',
      headers: {
        Prefer:
          onConflict === undefined
            ? 'return=minimal'
            : 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows.slice(start, start + MAX_INSERT_ROWS)),
    });
  }
}

async function deleteRows(table: string, query: URLSearchParams): Promise<void> {
  await requestJson(configFor('write'), table, query, {
    method: 'DELETE',
    headers: {
      Prefer: 'return=minimal',
    },
  });
}

export async function readLatestSummaryFromSupabase(): Promise<Summary | null> {
  const query = new URLSearchParams({
    select: 'summary',
    order: 'generated_at.desc',
    limit: '1',
  });
  const rows = await selectRows<StatusRunRow>('status_runs', query, 1);
  const summary = rows[0]?.summary;
  return summary === undefined ? null : (summary as unknown as Summary);
}

export async function readProbeRecordsForDayFromSupabase(day: string): Promise<ProbeRecord[]> {
  const start = `${day}T00:00:00.000Z`;
  const end = `${day}T23:59:59.999Z`;
  const query = new URLSearchParams({
    select: 'checked_at,target_id,status,ms,error_class',
    checked_at: `gte.${start}`,
    order: 'checked_at.asc',
    runner: `eq.${runner()}`,
  });
  query.append('checked_at', `lte.${end}`);

  const rows = await selectRows<StatusSampleRow>('status_samples', query);
  return rows.map((row) => ({
    t: row.checked_at,
    id: row.target_id,
    s: row.status,
    ms: row.ms,
    ...(row.error_class === null ? {} : { e: row.error_class as ProbeRecord['e'] }),
  }));
}

export async function readProbeRecordsSinceFromSupabase(start: Date): Promise<ProbeRecord[]> {
  const query = new URLSearchParams({
    select: 'checked_at,target_id,status,ms,error_class',
    checked_at: `gte.${start.toISOString()}`,
    order: 'checked_at.asc',
    runner: `eq.${runner()}`,
  });

  const rows = await selectRows<StatusSampleRow>('status_samples', query);
  return rows.map((row) => ({
    t: row.checked_at,
    id: row.target_id,
    s: row.status,
    ms: row.ms,
    ...(row.error_class === null ? {} : { e: row.error_class as ProbeRecord['e'] }),
  }));
}

export async function writeStatusRunToSupabase(summary: Summary, generatedAt: Date): Promise<void> {
  await insertRows('status_runs', [
    {
      runner: runner(),
      generated_at: generatedAt.toISOString(),
      window_days: summary.window_days,
      target_count: summary.targets.length,
      summary: summary as unknown as JsonValue,
    },
  ]);
}

export async function writeProbeRecordsToSupabase(records: ProbeRecord[]): Promise<void> {
  await insertRows(
    'status_samples',
    records.map((record) => ({
      runner: runner(),
      checked_at: record.t,
      target_id: record.id,
      status: record.s,
      ms: record.ms,
      error_class: record.e ?? null,
    })),
    'runner,checked_at,target_id',
  );
}

export async function writeUptimeToSupabase(
  summary: Summary,
  records: ProbeRecord[],
  generatedAt: Date,
): Promise<void> {
  await writeProbeRecordsToSupabase(records);
  await writeStatusRunToSupabase(summary, generatedAt);
}

export async function pruneSupabaseSamplesBefore(cutoff: Date): Promise<void> {
  const query = new URLSearchParams({
    checked_at: `lt.${cutoff.toISOString()}`,
    runner: `eq.${runner()}`,
  });
  await deleteRows('status_samples', query);
}

export async function readLatestHealthFromSupabase(): Promise<HealthReport | null> {
  const query = new URLSearchParams({
    select: 'report',
    order: 'generated_at.desc',
    limit: '1',
  });
  const rows = await selectRows<HealthRunRow>('health_runs', query, 1);
  const report = rows[0]?.report;
  return report === undefined ? null : (report as unknown as HealthReport);
}

export async function readHealthHistoryFromSupabase(): Promise<HealthHistoryLine[]> {
  const query = new URLSearchParams({
    select: 'd,org_score,repos,compliant,by_check',
    order: 'd.asc',
  });
  const rows = await selectRows<HealthHistoryRow>('health_history', query);
  return rows.map((row) => ({
    d: row.d,
    org_score: row.org_score,
    repos: row.repos,
    compliant: row.compliant,
    by_check: row.by_check,
  }));
}

export async function writeHealthToSupabase(
  report: HealthReport,
  historyLine: HealthHistoryLine,
): Promise<void> {
  await writeHealthReportToSupabase(report);
  await writeHealthHistoryToSupabase([historyLine]);
}

export async function writeHealthReportToSupabase(report: HealthReport): Promise<void> {
  if (report.generated_at === null) {
    throw new Error('health report generated_at is required for Supabase writes');
  }

  await insertRows('health_runs', [
    {
      runner: runner(),
      generated_at: report.generated_at,
      standard_version: report.standard_version,
      repo_count: report.repos.length,
      report: report as unknown as JsonValue,
    },
  ]);
}

export async function writeHealthHistoryToSupabase(history: HealthHistoryLine[]): Promise<void> {
  await insertRows(
    'health_history',
    history.map((line) => ({
      d: line.d,
      org_score: line.org_score,
      repos: line.repos,
      compliant: line.compliant,
      by_check: line.by_check,
      updated_at: new Date().toISOString(),
    })),
    'd',
  );
}
