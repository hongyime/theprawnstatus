import { useEffect, useState } from 'react';

import type { HealthHistoryLine, HealthReport } from '@shared/types';
import { ageMinutes } from '@/lib/format';

const DATA_BASE =
  import.meta.env.VITE_DATA_BASE ??
  'https://raw.githubusercontent.com/hongyime/theprawnstatus/data';

export interface HealthDataState {
  report: HealthReport | null;
  history: HealthHistoryLine[];
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

async function fetchJson<T>(url: string, guard: (value: unknown) => value is T): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`health data returned ${response.status}`);
  }

  const data = await response.json();
  if (!guard(data)) {
    throw new Error('health data has an invalid schema');
  }
  return data;
}

async function fetchHistory(url: string): Promise<HealthHistoryLine[]> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    return [];
  }

  const text = await response.text();
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as HealthHistoryLine);
}

export function useHealthData(): HealthDataState {
  const [state, setState] = useState<HealthDataState>({
    report: null,
    history: [],
    error: null,
    loading: true,
    source: null,
    stale: true,
  });

  useEffect(() => {
    let alive = true;

    async function load(): Promise<void> {
      try {
        const [report, history] = await Promise.all([
          fetchJson(`${DATA_BASE}/health.json`, isHealthReport),
          fetchHistory(`${DATA_BASE}/health-history.jsonl`),
        ]);

        if (alive) {
          setState({
            report,
            history,
            error: null,
            loading: false,
            source: 'live',
            stale: (ageMinutes(report.generated_at) ?? Infinity) > 48 * 60,
          });
        }
      } catch (liveError) {
        try {
          const report = await fetchJson('/health-snapshot.json', isHealthReport);
          if (alive) {
            setState({
              report,
              history: [],
              error: liveError instanceof Error ? liveError.message : 'live health unavailable',
              loading: false,
              source: 'snapshot',
              stale: (ageMinutes(report.generated_at) ?? Infinity) > 48 * 60,
            });
          }
        } catch (snapshotError) {
          if (alive) {
            setState({
              report: null,
              history: [],
              error: snapshotError instanceof Error ? snapshotError.message : 'health data unavailable',
              loading: false,
              source: null,
              stale: true,
            });
          }
        }
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
