import { useEffect, useState } from 'react';

import type { Summary } from '@shared/types';
import { ageMinutes } from '@/lib/format';
import { fetchLatestSummaryFromSupabase, hasSupabaseDataConfig } from '@/lib/supabaseData';

const SUMMARY_URL =
  import.meta.env.VITE_SUMMARY_URL ??
  'https://raw.githubusercontent.com/hongyime/theprawnstatus/data/summary.json';
const REFRESH_MS = 60_000;
const STALE_MINUTES = 20;

type Source = 'live' | 'snapshot';

export interface StatusDataState {
  data: Summary | null;
  error: string | null;
  loading: boolean;
  source: Source | null;
  stale: boolean;
}

function isSummary(value: unknown): value is Summary {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Summary).schema === 1 &&
    (value as Summary).window_days === 90 &&
    Array.isArray((value as Summary).targets)
  );
}

async function fetchSummary(url: string): Promise<Summary> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`status data returned ${response.status}`);
  }

  const data = await response.json();
  if (!isSummary(data)) {
    throw new Error('status data has an invalid schema');
  }

  return data;
}

async function fetchSupabaseSummary(): Promise<Summary> {
  const data = await fetchLatestSummaryFromSupabase();
  if (!isSummary(data)) {
    throw new Error('Supabase status data has an invalid schema');
  }

  return data;
}

async function fetchLiveSummary(): Promise<Summary> {
  if (hasSupabaseDataConfig()) {
    try {
      return await fetchSupabaseSummary();
    } catch {
      // Fall through to the existing Git-backed feed during migration.
    }
  }

  return fetchSummary(SUMMARY_URL);
}

export function useStatusData(): StatusDataState {
  const [state, setState] = useState<StatusDataState>({
    data: null,
    error: null,
    loading: true,
    source: null,
    stale: false,
  });

  useEffect(() => {
    let alive = true;

    async function load(): Promise<void> {
      try {
        const live = await fetchLiveSummary();
        if (alive) {
          setState({
            data: live,
            error: null,
            loading: false,
            source: 'live',
            stale: (ageMinutes(live.generated_at) ?? Infinity) > STALE_MINUTES,
          });
        }
      } catch (liveError) {
        try {
          const snapshot = await fetchSummary('/snapshot.json');
          if (alive) {
            setState({
              data: snapshot,
              error: liveError instanceof Error ? liveError.message : 'live data unavailable',
              loading: false,
              source: 'snapshot',
              stale: (ageMinutes(snapshot.generated_at) ?? Infinity) > STALE_MINUTES,
            });
          }
        } catch (snapshotError) {
          if (alive) {
            setState({
              data: null,
              error:
                snapshotError instanceof Error ? snapshotError.message : 'status data unavailable',
              loading: false,
              source: null,
              stale: true,
            });
          }
        }
      }
    }

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, REFRESH_MS);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  return state;
}
