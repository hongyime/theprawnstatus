create table if not exists public.status_runs (
  id bigint generated always as identity primary key,
  runner text not null default 'github-actions',
  generated_at timestamptz not null,
  window_days integer not null default 90,
  target_count integer not null,
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists status_runs_generated_at_idx
  on public.status_runs (generated_at desc);

create index if not exists status_runs_runner_generated_at_idx
  on public.status_runs (runner, generated_at desc);

create table if not exists public.status_samples (
  runner text not null default 'github-actions',
  checked_at timestamptz not null,
  target_id text not null,
  status integer,
  ms integer not null,
  error_class text,
  created_at timestamptz not null default now(),
  primary key (runner, checked_at, target_id)
);

create index if not exists status_samples_checked_at_idx
  on public.status_samples (checked_at desc);

create index if not exists status_samples_target_checked_at_idx
  on public.status_samples (target_id, checked_at desc);

create table if not exists public.health_runs (
  id bigint generated always as identity primary key,
  runner text not null default 'github-actions',
  generated_at timestamptz not null,
  standard_version text not null,
  repo_count integer not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists health_runs_generated_at_idx
  on public.health_runs (generated_at desc);

create table if not exists public.health_history (
  d date primary key,
  org_score double precision not null,
  repos integer not null,
  compliant integer not null,
  by_check jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.status_runs enable row level security;
alter table public.status_samples enable row level security;
alter table public.health_runs enable row level security;
alter table public.health_history enable row level security;

grant select on table public.status_runs to anon, authenticated;
grant select on table public.status_samples to anon, authenticated;
grant select on table public.health_runs to anon, authenticated;
grant select on table public.health_history to anon, authenticated;

grant select, insert, update, delete on table public.status_runs to service_role;
grant select, insert, update, delete on table public.status_samples to service_role;
grant select, insert, update, delete on table public.health_runs to service_role;
grant select, insert, update, delete on table public.health_history to service_role;

create policy "public can read status runs"
  on public.status_runs
  for select
  to anon, authenticated
  using (true);

create policy "public can read status samples"
  on public.status_samples
  for select
  to anon, authenticated
  using (true);

create policy "public can read health runs"
  on public.health_runs
  for select
  to anon, authenticated
  using (true);

create policy "public can read health history"
  on public.health_history
  for select
  to anon, authenticated
  using (true);
