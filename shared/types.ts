export type ErrorClass = 'timeout' | 'dns' | 'tls' | 'conn' | 'abort';

export type DayState = 'up' | 'degraded' | 'down' | 'no-data';

export type Severity = 'low' | 'medium' | 'high';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ProbeRecord {
  t: string;
  id: string;
  s: number | null;
  ms: number;
  e?: ErrorClass;
}

export interface DayBucket {
  d: string;
  n: number;
  ok: number;
  p50: number | null;
}

export interface CurrentStatus {
  state: DayState;
  status: number | null;
  ms: number | null;
  checked_at: string | null;
  error_class?: ErrorClass;
}

export interface TargetSummary {
  id: string;
  name: string;
  url: string;
  current: CurrentStatus;
  uptime_90d: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  days: DayBucket[];
}

export interface Summary {
  generated_at: string | null;
  window_days: 90;
  schema: 1;
  targets: TargetSummary[];
}

export interface RepoHealth {
  name: string;
  score: number;
  max: number;
  archived: boolean;
  identity_clean: boolean | null;
  fail: string[];
}

export interface HealthReport {
  generated_at: string | null;
  standard_version: string;
  schema: 1;
  org_score: number;
  repos: RepoHealth[];
}

export interface HealthHistoryLine {
  d: string;
  org_score: number;
  repos: number;
  compliant: number;
  by_check: Record<string, number>;
}

export interface TargetConfig {
  id: string;
  name: string;
  url: string;
  expect: number;
  follow_redirects?: boolean;
}

export interface StandardCheckConfig {
  id: string;
  weight: number;
  severity: Severity;
  params?: Record<string, JsonValue>;
}

export interface StandardConfig {
  standard_version: string;
  source: string;
  known_default_description: string;
  checks: StandardCheckConfig[];
  exempt: Record<string, string[]>;
}

export function dayState(bucket: DayBucket): DayState {
  if (bucket.n === 0) {
    return 'no-data';
  }

  const ratio = bucket.ok / bucket.n;
  if (ratio === 1) {
    return 'up';
  }

  if (ratio >= 0.95) {
    return 'degraded';
  }

  return 'down';
}
