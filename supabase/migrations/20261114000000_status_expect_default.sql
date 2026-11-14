-- Trusted target JSON predates required client-side normalization in some rows.
create or replace function public.build_status_projection(p_runner text, p_now timestamptz, p_targets jsonb, p_full boolean)
returns jsonb language sql stable security invoker set search_path = '' as $$
with bounds as (
  select (p_now at time zone 'UTC')::date as today,
    (p_now at time zone 'UTC')::date - 89 as oldest,
    case when p_full then (p_now at time zone 'UTC')::date - 89
      else ((p_now - interval '150 seconds') at time zone 'UTC')::date end as first_day
), previous as (
  select summary from public.status_latest where runner = p_runner and generated_at <= p_now
    order by generated_at desc limit 1
), targets as (
  select t, ord, t->>'id' as id, coalesce((t->>'expect')::integer, 200) as expect,
    (select old from previous, jsonb_array_elements(summary->'targets') old where old->>'id' = t->>'id' limit 1) as old
  from jsonb_array_elements(p_targets) with ordinality config(t, ord)
), records as materialized (
  select r.* from bounds b cross join lateral public.status_raw_window(p_runner,
    b.first_day::timestamp at time zone 'UTC', (b.today + 1)::timestamp at time zone 'UTC') r
), fresh_days as (
  select r.target_id as id, (r.checked_at at time zone 'UTC')::date as d,
    count(*) as n, count(*) filter (where r.status = t.expect and r.error_class is null) as ok,
    percentile_disc(0.5) within group (order by r.ms) as p50
  from records r join targets t on t.id = r.target_id group by r.target_id, (r.checked_at at time zone 'UTC')::date
), days as (
  select id, d, n, ok, p50 from fresh_days
  union all
  select t.id, (d->>'d')::date, (d->>'n')::bigint, (d->>'ok')::bigint, (d->>'p50')::integer
  from targets t cross join bounds b cross join lateral jsonb_array_elements(coalesce(t.old->'days', '[]'::jsonb)) d
  where not p_full and (d->>'d')::date >= b.oldest and (d->>'d')::date < b.first_day
), day_lists as (
  select id, jsonb_agg(jsonb_build_object('d', d::text, 'n', n, 'ok', ok, 'p50', p50) order by d) as days,
    sum(n) as total, sum(ok) as ok, bool_or(d < (select first_day from bounds)) as has_old_days
  from days group by id
), ok_percentiles as (
  select t.id, percentile_disc(0.5) within group (order by r.ms) as p50,
    percentile_disc(0.95) within group (order by r.ms) as p95
  from targets t join records r on r.target_id = t.id and r.status = t.expect and r.error_class is null group by t.id
), weighted as (
  select id, p50, sum(n) over (partition by id order by p50 rows unbounded preceding) as cumulative,
    sum(n) over (partition by id) as total from days where p50 is not null
), fallback as (
  select id, min(p50) as p50 from weighted where cumulative >= ceil(total * 0.5) group by id
), latest as (
  select distinct on (target_id) target_id as id, checked_at, status, ms, error_class
    from records order by target_id, checked_at desc
), result as (
  select t.ord, jsonb_build_object(
    'id', t.id, 'name', t.t->>'name', 'url', t.t->>'url',
    'current', case when l.checked_at is not null then
      jsonb_build_object('state', case when l.status = t.expect and l.error_class is null then 'up' else 'down' end,
        'status', l.status, 'ms', l.ms, 'checked_at', to_char(l.checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        || case when l.error_class is null then '{}'::jsonb else jsonb_build_object('error_class', l.error_class) end
      when not p_full and (t.old->'current'->>'checked_at')::timestamptz >= (select oldest::timestamp at time zone 'UTC' from bounds)
        then t.old->'current'
      else jsonb_build_object('state', 'no-data', 'status', null, 'ms', null, 'checked_at', null) end,
    'uptime_90d', case when d.total > 0 then d.ok / d.total else null end,
    'p50_ms', case when not p_full and d.has_old_days then coalesce((t.old->>'p50_ms')::numeric, p.p50, f.p50)
      else coalesce(p.p50, f.p50) end,
    'p95_ms', case when p_full then p.p95 else coalesce((t.old->>'p95_ms')::numeric, p.p95) end,
    'days', coalesce(d.days, '[]'::jsonb)) as value
  from targets t left join day_lists d on d.id = t.id left join ok_percentiles p on p.id = t.id
    left join fallback f on f.id = t.id left join latest l on l.id = t.id
)
select jsonb_build_object('generated_at', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'window_days', 90, 'schema', 1, 'targets', coalesce(jsonb_agg(value order by ord), '[]'::jsonb)) from result;
$$;

revoke all on function public.build_status_projection(text, timestamptz, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.build_status_projection(text, timestamptz, jsonb, boolean) to service_role;
