import { useEffect, useState } from 'react';

import type { Summary } from '@shared/types';
import { ageMinutes } from '@/lib/format';
import { fetchLatestSummaryFromSupabase, hasSupabaseDataConfig } from '@/lib/supabaseData';
import { startVisiblePolling } from '@/lib/visiblePolling';
import { preferLoaded, requestJson, REFRESH_TIMEOUT_MS, withDeadline } from '@/lib/request';

const SUMMARY_URL =
  import.meta.env.VITE_SUMMARY_URL ??
  'https://raw.githubusercontent.com/hongyime/theprawnstatus/data/summary.json';
const REFRESH_MS = 120_000;
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

async function fetchSummary(url: string, signal: AbortSignal): Promise<Summary> {
  const data = await requestJson<unknown>(url, signal);
  if (!isSummary(data)) {
    throw new Error('status data has an invalid schema');
  }

  return data;
}

async function fetchSupabaseSummary(signal: AbortSignal): Promise<Summary> {
  const data = await fetchLatestSummaryFromSupabase(signal);
  if (!isSummary(data)) {
    throw new Error('Supabase status data has an invalid schema');
  }

  return data;
}

async function fetchLiveSummary(signal: AbortSignal): Promise<Summary> {
  if (hasSupabaseDataConfig()) {
    try {
      return await fetchSupabaseSummary(signal);
    } catch {
      signal.throwIfAborted();
      // Fall through to the existing Git-backed feed during migration.
    }
  }

  return fetchSummary(SUMMARY_URL, signal);
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

    async function load(signal: AbortSignal): Promise<boolean> {
      setState((previous) => {
        if (previous.data === null) return previous;
        const stale = (ageMinutes(previous.data.generated_at) ?? Infinity) > STALE_MINUTES;
        return stale === previous.stale ? previous : { ...previous, stale };
      });
      try {
        const result = await withDeadline(signal, REFRESH_TIMEOUT_MS, async (refreshSignal) => {
          try {
            return {
              data: await fetchLiveSummary(refreshSignal),
              source: 'live' as const,
              error: null,
            };
          } catch (liveError) {
            refreshSignal.throwIfAborted();
            return {
              data: await fetchSummary('/snapshot.json', refreshSignal),
              source: 'snapshot' as const,
              error: liveError instanceof Error ? liveError.message : 'live data unavailable',
            };
          }
        });
        if (alive && !signal.aborted) {
          setState((previous) => {
            const retained =
              result.source === 'snapshot' && preferLoaded(previous.data, result.data);
            const data = retained ? previous.data : result.data;
            return {
              data,
              source: retained ? previous.source : result.source,
              error: result.error,
              loading: false,
              stale: (ageMinutes(data?.generated_at ?? null) ?? Infinity) > STALE_MINUTES,
            };
          });
        }
        return result.source === 'live';
      } catch (error) {
        if (alive && !signal.aborted) {
          setState((previous) => ({
            ...previous,
            error: error instanceof Error ? error.message : 'status data unavailable',
            loading: false,
            stale: (ageMinutes(previous.data?.generated_at ?? null) ?? Infinity) > STALE_MINUTES,
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
