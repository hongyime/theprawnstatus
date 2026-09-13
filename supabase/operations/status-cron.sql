-- Creates the reviewed jobs INACTIVE. Follow SCHEDULER.md before enabling.
-- Existing observations are retained; credentials are resolved from Vault.
begin;
select cron.schedule_in_database('status-uptime-5m','*/5 * * * *','do $status_job$
declare v_limit bigint;
begin
  select capacity_limit_bytes into v_limit from public.status_collector_leases
    where runner = ''github-actions'' and enabled;
  if v_limit is null then return; end if;
  if pg_catalog.pg_database_size(current_database()) >= v_limit then
    update public.status_collector_leases set enabled = false where runner = ''github-actions'';
    perform cron.alter_job(jobid, active := false) from cron.job
      where jobname in (''status-uptime-5m'', ''status-rebuild-daily'') and database = current_database() and username = current_user;
    return;
  end if;
  perform net.http_post(
    url := ''https://esplfwgzljvdrnvqaisj.supabase.co/functions/v1/status-uptime-collector'',
    headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'',
      ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''status_collector_service_jwt'')),
    body := ''{}''::jsonb, timeout_milliseconds := 145000);
end $status_job$;
',current_database(),active:=false);
select cron.schedule_in_database('status-rebuild-daily','3 3 * * *','set statement_timeout = ''60s'';
do $status_job$
declare v_limit bigint;
begin
  select capacity_limit_bytes into v_limit from public.status_collector_leases
    where runner = ''github-actions'' and enabled;
  if v_limit is null then return; end if;
  if pg_catalog.pg_database_size(current_database()) >= v_limit then
    update public.status_collector_leases set enabled = false where runner = ''github-actions'';
    perform cron.alter_job(jobid, active := false) from cron.job
      where jobname in (''status-uptime-5m'', ''status-rebuild-daily'') and database = current_database() and username = current_user;
    return;
  end if;
  perform public.rebuild_status_projection(''github-actions'');
end $status_job$;
',current_database(),active:=false);
commit;