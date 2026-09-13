import { useEffect, useState } from 'react';

import type { HealthReport } from '@shared/types';
import { ageMinutes } from '@/lib/format';
import { startVisiblePolling } from '@/lib/visiblePolling';
import { preferLoaded, requestJson, REFRESH_TIMEOUT_MS, withDeadline } from '@/lib/request';
import { fetchHealthSnapshotFromSupabase, hasSupabaseDataConfig } from '@/lib/supabaseData';

const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ??
  'https://raw.githubusercontent.com/hongyime/theprawnstatus/data';
const REFRESH_MS = 900_000;

export interface HealthDataState {
  report: HealthReport | null;
  reportHistory: HealthReport[];
  error: string | null;
  loading: boolean;
  source: 'live' | 'snapshot' | null;
  stale: boolean;
}

function isHealthReport(value: unknown): value is HealthReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as HealthReport).schema === 1 &&
    Array.isArray((value as HealthReport).repos)
  );
}

async function fetchJson<T>(
  url: string,
  guard: (value: unknown) => value is T,
  signal: AbortSignal,
): Promise<T> {
  const data = await requestJson<unknown>(url, signal);
  if (!guard(data)) {
    throw new Error('health data has an invalid schema');
  }
  return data;
}

async function fetchSupabaseHealth(signal: AbortSignal): Promise<{
  report: HealthReport;
  reportHistory: HealthReport[];
}> {
  const { report, reports } = await fetchHealthSnapshotFromSupabase(signal);
  if (!isHealthReport(report) || !reports.every(isHealthReport)) {
    throw new Error('Supabase health data has an invalid schema');
  }

  return { report, reportHistory: reports.filter((row) => row.generated_at !== null) };
}

async function fetchLiveHealth(signal: AbortSignal): Promise<{
  report: HealthReport;
  reportHistory: HealthReport[];
}> {
  if (hasSupabaseDataConfig()) {
    try {
      return await fetchSupabaseHealth(signal);
    } catch {
      signal.throwIfAborted();
      // Fall through to the existing Git-backed feed during migration.
    }
  }

  const report = await fetchJson(`${DATA_BASE}/health.json`, isHealthReport, signal);
  return { report, reportHistory: [report] };
}

export function useHealthData(): HealthDataState {
  const [state, setState] = useState<HealthDataState>({
    report: null,
    reportHistory: [],
    error: null,
    loading: true,
    source: null,
    stale: true,
  });

  useEffect(() => {
    let alive = true;

    async function load(signal: AbortSignal): Promise<boolean> {
      setState((previous) => {
        if (previous.report === null) return previous;
        const stale = (ageMinutes(previous.report.generated_at) ?? Infinity) > 48 * 60;
        return stale === previous.stale ? previous : { ...previous, stale };
      });
      try {
        const result = await withDeadline(signal, REFRESH_TIMEOUT_MS, async (refreshSignal) => {
          try {
            return {
              ...(await fetchLiveHealth(refreshSignal)),
              source: 'live' as const,
              error: null,
            };
          } catch (liveError) {
            refreshSignal.throwIfAborted();
            const report = await fetchJson('/health-snapshot.json', isHealthReport, refreshSignal);
            return {
              report,
              reportHistory: [report],
              source: 'snapshot' as const,
              error: liveError instanceof Error ? liveError.message : 'live health unavailable',
            };
          }
        });
        if (alive && !signal.aborted) {
          setState((previous) => {
            const retained =
              result.source === 'snapshot' && preferLoaded(previous.report, result.report);
            const report = retained ? previous.report : result.report;
            return {
              report,
              reportHistory: retained ? previous.reportHistory : result.reportHistory,
              source: retained ? previous.source : result.source,
              error: result.error,
              loading: false,
              stale: (ageMinutes(report?.generated_at ?? null) ?? Infinity) > 48 * 60,
            };
          });
        }
        return result.source === 'live';
      } catch (error) {
        if (alive && !signal.aborted) {
          setState((previous) => ({
            ...previous,
            error: error instanceof Error ? error.message : 'health data unavailable',
            loading: false,
            stale: (ageMinutes(previous.report?.generated_at ?? null) ?? Infinity) > 48 * 60,
          }));
        }
        return false;
      }
    }

    const stopPolling = startVisiblePolling(load, REFRESH_MS);

    return () => {
      alive = false;
      stopPolling();
    };
  }, []);

  return state;
}
