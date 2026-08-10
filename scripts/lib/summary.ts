import type {
  CurrentStatus,
  DayBucket,
  ProbeRecord,
  Summary,
  TargetConfig,
  TargetSummary,
} from '../../shared/types';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;

export function emptySummary(): Summary {
  return {
    generated_at: null,
    window_days: WINDOW_DAYS,
    schema: 1,
    targets: [],
  };
}

export function utcDay(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

function utcDayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / DAY_MS);
}

function oldestKeptDay(now: Date): number {
  return utcDayNumber(utcDay(now)) - (WINDOW_DAYS - 1);
}

function inWindow(record: ProbeRecord, now: Date): boolean {
  const day = utcDay(record.t);
  const dayNumber = utcDayNumber(day);
  return dayNumber >= oldestKeptDay(now) && dayNumber <= utcDayNumber(utcDay(now));
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function isOk(record: ProbeRecord, target: TargetConfig): boolean {
  return record.e === undefined && record.s === target.expect;
}

function currentFromRecord(record: ProbeRecord | undefined, target: TargetConfig): CurrentStatus {
  if (record === undefined) {
    return {
      state: 'no-data',
      status: null,
      ms: null,
      checked_at: null,
    };
  }

  const current: CurrentStatus = {
    state: isOk(record, target) ? 'up' : 'down',
    status: record.s,
    ms: record.ms,
    checked_at: record.t,
  };

  if (record.e !== undefined) {
    current.error_class = record.e;
  }

  return current;
}

function buildDayBuckets(records: ProbeRecord[], target: TargetConfig, now: Date): DayBucket[] {
  const buckets = new Map<string, ProbeRecord[]>();

  for (const record of records) {
    if (record.id !== target.id || !inWindow(record, now)) {
      continue;
    }

    const day = utcDay(record.t);
    buckets.set(day, [...(buckets.get(day) ?? []), record]);
  }

  return [...buckets.entries()]
    .map(([d, bucketRecords]) => ({
      d,
      n: bucketRecords.length,
      ok: bucketRecords.filter((record) => isOk(record, target)).length,
      p50: percentile(bucketRecords.map((record) => record.ms), 50),
    }))
    .sort((a, b) => a.d.localeCompare(b.d));
}

function deriveWindowPercentileFromBuckets(
  buckets: DayBucket[],
  percentileValue: number,
): number | null {
  const weighted = buckets.flatMap((bucket) =>
    bucket.p50 === null ? [] : Array.from({ length: bucket.n }, () => bucket.p50 as number),
  );
  return percentile(weighted, percentileValue);
}

function buildTargetSummary(
  records: ProbeRecord[],
  target: TargetConfig,
  now: Date,
  p95Override?: number | null,
): TargetSummary {
  const targetRecords = records
    .filter((record) => record.id === target.id && inWindow(record, now))
    .sort((a, b) => a.t.localeCompare(b.t));
  const dayBuckets = buildDayBuckets(targetRecords, target, now);
  const total = dayBuckets.reduce((sum, bucket) => sum + bucket.n, 0);
  const ok = dayBuckets.reduce((sum, bucket) => sum + bucket.ok, 0);
  const okLatencies = targetRecords.filter((record) => isOk(record, target)).map((record) => record.ms);

  return {
    id: target.id,
    name: target.name,
    url: target.url,
    current: currentFromRecord(targetRecords.at(-1), target),
    uptime_90d: total === 0 ? null : ok / total,
    p50_ms: percentile(okLatencies, 50) ?? deriveWindowPercentileFromBuckets(dayBuckets, 50),
    p95_ms: p95Override === undefined ? percentile(okLatencies, 95) : p95Override,
    days: dayBuckets,
  };
}

function summaryToRecords(summary: Summary, targets: TargetConfig[], now: Date): ProbeRecord[] {
  const targetMap = new Map(targets.map((target) => [target.id, target]));
  const records: ProbeRecord[] = [];

  for (const targetSummary of summary.targets) {
    const target = targetMap.get(targetSummary.id);
    if (target === undefined) {
      continue;
    }

    for (const bucket of targetSummary.days) {
      if (utcDayNumber(bucket.d) < oldestKeptDay(now)) {
        continue;
      }

      for (let index = 0; index < bucket.n; index += 1) {
        records.push({
          t: `${bucket.d}T12:00:00.000Z`,
          id: target.id,
          s: index < bucket.ok ? target.expect : 500,
          ms: bucket.p50 ?? 0,
        });
      }
    }
  }

  return records;
}

export function applyIncrement(
  summary: Summary,
  records: ProbeRecord[],
  now: Date,
  targets: TargetConfig[],
  windowRecords?: ProbeRecord[],
): Summary {
  const syntheticRecords = windowRecords ?? [...summaryToRecords(summary, targets, now), ...records];
  const rebuilt = rebuild(syntheticRecords, targets, now);
  const previousP95 = new Map(summary.targets.map((target) => [target.id, target.p95_ms]));

  return {
    ...rebuilt,
    generated_at: now.toISOString(),
    targets: rebuilt.targets.map((target) => ({
      ...target,
      p95_ms: previousP95.get(target.id) ?? target.p95_ms,
    })),
  };
}

export function rebuild(records: ProbeRecord[], targets: TargetConfig[], now: Date): Summary {
  return {
    generated_at: now.toISOString(),
    window_days: WINDOW_DAYS,
    schema: 1,
    targets: targets
      .map((target) => buildTargetSummary(records, target, now))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function parseJsonl(content: string): ProbeRecord[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as ProbeRecord);
}

export function stringifyJsonl(records: ProbeRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '');
}

export function historyShardPath(day: string): string {
  return `history/${day}.jsonl`;
}

export function isExpiredShard(path: string, now: Date): boolean {
  const match = /^history\/(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(path.replaceAll('\\', '/'));
  if (match === null) {
    return false;
  }

  return utcDayNumber(match[1]) < oldestKeptDay(now);
}
