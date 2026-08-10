import { describe, expect, it } from 'vitest';

import type { DayBucket, ProbeRecord, TargetConfig } from '../../shared/types';
import { dayState } from '../../shared/types';
import { applyIncrement, emptySummary, isExpiredShard, rebuild } from './summary';

const targets: TargetConfig[] = [
  { id: 'app', name: 'App', url: 'https://app.example.com', expect: 200 },
];

function record(day: string, status: number, ms = 100): ProbeRecord {
  return {
    t: `${day}T00:00:00.000Z`,
    id: 'app',
    s: status,
    ms,
  };
}

function withoutP95(summary: ReturnType<typeof rebuild>) {
  return {
    ...summary,
    targets: summary.targets.map((target) => ({ ...target, p95_ms: null })),
  };
}

describe('dayState', () => {
  it.each<[DayBucket, string]>([
    [{ d: '2026-08-10', n: 0, ok: 0, p50: null }, 'no-data'],
    [{ d: '2026-08-10', n: 100, ok: 100, p50: 100 }, 'up'],
    [{ d: '2026-08-10', n: 100, ok: 95, p50: 100 }, 'degraded'],
    [{ d: '2026-08-10', n: 100, ok: 94, p50: 100 }, 'down'],
  ])('maps %o to %s', (bucket, expected) => {
    expect(dayState(bucket)).toBe(expected);
  });
});

describe('summary', () => {
  it('keeps day 90 and evicts day 91', () => {
    const now = new Date('2026-08-10T00:00:00.000Z');
    expect(isExpiredShard('history/2026-05-13.jsonl', now)).toBe(false);
    expect(isExpiredShard('history/2026-05-12.jsonl', now)).toBe(true);
  });

  it('keeps incremental and rebuild output equivalent except p95', () => {
    const now = new Date('2026-08-10T00:00:00.000Z');
    const records = [
      record('2026-08-09', 200, 100),
      record('2026-08-09', 500, 200),
      record('2026-08-10', 200, 300),
    ];
    let summary = emptySummary();
    const seen: ProbeRecord[] = [];

    for (const item of records) {
      seen.push(item);
      summary = applyIncrement(summary, [item], now, targets, [...seen]);
    }

    expect(withoutP95(summary)).toEqual(withoutP95(rebuild(records, targets, now)));
  });

  it('adds a new target with no history', () => {
    const now = new Date('2026-08-10T00:00:00.000Z');
    const result = rebuild([record('2026-08-10', 200)], [
      ...targets,
      { id: 'new-app', name: 'New App', url: 'https://new.example.com', expect: 200 },
    ], now);

    expect(result.targets.find((target) => target.id === 'new-app')?.current.state).toBe('no-data');
  });

  it('handles an empty-history cold start', () => {
    const now = new Date('2026-08-10T00:00:00.000Z');
    expect(rebuild([], targets, now).targets[0]).toMatchObject({
      uptime_90d: null,
      p50_ms: null,
      p95_ms: null,
      days: [],
    });
  });
});
