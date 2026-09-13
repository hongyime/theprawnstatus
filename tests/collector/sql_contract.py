from pathlib import Path
from datetime import datetime,timezone
from concurrent.futures import ThreadPoolExecutor
import json,argparse,re,time
import os
import lab
from lab import out, root
parser=argparse.ArgumentParser();parser.add_argument('label');args=parser.parse_args();assert re.fullmatch('[a-z0-9_]+',args.label)
assert not (out/('status-scheduler-sql-'+args.label+'.json')).exists()
lab.sql('create database status_'+args.label)
lab.config['database']='status_'+args.label
report={'at':datetime.now(timezone.utc).isoformat(),'stage':'running','checks':[],'synthetic_only':True,'production_mutations':False}
def checked(name):report['checks'].append(name);print(name,flush=True)
def svc(query):return lab.value('set role service_role; '+query)
targets=[{'id':'alpha','name':'Alpha','url':'https://alpha.invalid','expect':200},{'id':'beta','name':'Beta','url':'https://beta.invalid','expect':204}]
def claim():return svc("select public.claim_status_collection('fixture')")
def records():
    stamp=lab.value("select to_json(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))")
    return [{'t':stamp,'id':'alpha','s':200,'ms':105,'extra':{'preserve':'雪 ☃','value':None}}, {'t':stamp,'id':'beta','s':None,'ms':10000,'e':'timeout'}]
def commit(token,rows,check=True):
    return lab.sql('set role service_role; select public.commit_status_collection(\'fixture\','+lab.literal(token)+'::uuid,'+lab.json_literal(rows)+')',check=check)
def counts():return lab.value("select json_build_array((select count(*) from public.status_probe_batches),(select count(*) from public.status_current),(select count(*) from public.status_samples),(select count(*) from public.status_runs_legacy))")
try:
    assert lab.value("select to_json(to_regclass('public.status_collector_leases') is null)")
    lab.sql("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end$$;")
    lab.sql((root/'tests/collector/rls-auto-enable-fixture.sql').read_text())
    lab.sql((root/'supabase/migrations/20260811000000_status_store.sql').read_text())
    lab.sql('grant all on public.status_runs,public.status_samples,public.health_runs,public.health_history to service_role; grant usage,select on all sequences in schema public to service_role;')
    lab.sql((root/'supabase/migrations/20260913100307_status_atomic_collector.sql').read_text())
    assert lab.value("select json_build_array(has_function_privilege('anon','public.rls_auto_enable()','execute'),has_function_privilege('authenticated','public.rls_auto_enable()','execute'))")==[False,False]
    lab.sql('create table public.fixture_auto_rls_proof(id integer)')
    assert lab.value("select to_json(relrowsecurity) from pg_class where oid='public.fixture_auto_rls_proof'::regclass")
    checked('automatic table RLS still works after removing public execution grants from the event trigger')
    checked('additive migration applies on the original schema')
    lab.sql("insert into public.status_collector_leases(runner,targets) values ('fixture',"+lab.json_literal(targets)+")")
    assert claim()=={'state':'disabled'} and counts()==[0,0,0,0]
    checked('disabled collector performs no batch or projection write')
    for role in ['anon','authenticated']:
        for operation in ["select public.claim_status_collection('fixture')", "select * from public.status_probe_batches", "select * from public.status_target_configs", "select * from public.status_collector_leases", "select * from public.status_raw_window('fixture',now(),now())"]:
            denied=lab.sql('set role '+role+'; '+operation,check=False)
            assert denied.returncode and 'permission denied' in denied.stderr
        assert lab.value('set role '+role+'; select to_json(count(*)) from public.status_latest')==0
    checked('public readers can read projections but cannot access collector state, raw batches or RPCs')
    lab.sql("update public.status_collector_leases set enabled=true where runner='fixture'")
    lab.sql("update public.status_collector_leases set capacity_limit_bytes=1000000 where runner='fixture'")
    assert claim()=={'state':'capacity'} and counts()==[0,0,0,0]
    assert lab.value("select to_json(lease_token is null) from status_collector_leases where runner='fixture'")
    lab.sql("update public.status_collector_leases set capacity_limit_bytes=400000000 where runner='fixture'")
    checked('database capacity guard stops new collection before a lease or data write')
    with ThreadPoolExecutor(max_workers=6) as pool:claims=list(pool.map(lambda _:claim(),range(6)))
    assert sorted(c['state'] for c in claims)==['busy']*5+['claimed']
    first=next(c for c in claims if c['state']=='claimed')
    checked('six concurrent claims produce one owner')
    assert svc("select public.rebuild_status_projection('fixture')")=={'state':'busy'}
    checked('daily rebuild yields to an active collection lease')
    original_records=records()
    lab.sql("update public.status_collector_leases set lease_expires_at=now()-interval '1 second' where runner='fixture'")
    second=claim();assert second['state']=='claimed' and second['token']!=first['token']
    assert commit(first['token'],original_records,False).returncode and counts()==[0,0,0,0]
    checked('expired owner cannot publish after a replacement claim')
    rows=records()
    changed_targets=[dict(t,name=t['name']+' renamed',expect=500) for t in targets]
    lab.sql('update public.status_collector_leases set targets='+lab.json_literal(changed_targets)+" where runner='fixture'")
    variants=[rows[:1], [rows[0],rows[0]], [dict(rows[0],id='unknown'),rows[1]], [dict(rows[0],ms=-1),rows[1]], [dict(rows[0],s=600),rows[1]], [dict(rows[0],e='invalid'),rows[1]], [dict(rows[0],t='1900-01-01T00:00:00.000Z'),rows[1]], [dict(rows[0],t='invalid'),rows[1]]]
    for invalid in variants:assert commit(second['token'],invalid,False).returncode and counts()==[0,0,0,0]
    checked('invalid, incomplete, duplicate and out-of-lease observations roll back')
    lab.sql("create function public.fixture_projection_failure() returns trigger language plpgsql as $$begin raise exception 'fixture projection failure'; end$$; create trigger fixture_failure before insert or update on public.status_current for each row execute function public.fixture_projection_failure();")
    failed=commit(second['token'],rows,False)
    assert failed.returncode and 'fixture projection failure' in failed.stderr and counts()==[0,0,0,0],failed.stderr
    lab.sql('drop trigger fixture_failure on public.status_current')
    checked('projection failure rolls back raw batch and lease completion together')
    with ThreadPoolExecutor(max_workers=6) as pool:commits=list(pool.map(lambda _:commit(second['token'],rows),range(6)))
    assert all(json.loads(r.stdout)['state']=='complete' for r in commits) and counts()==[1,1,0,0]
    checked('concurrent retries commit one raw batch and one projection')
    assert lab.value('select records from public.status_probe_batches')==rows
    assert lab.value('select c.targets from public.status_probe_batches b join public.status_target_configs c on c.hash=b.target_config_hash')==targets
    checked('all raw fields and the claimed target configuration survive later configuration edits')
    projection=lab.value('set role anon; select summary from public.status_latest order by generated_at desc limit 1')
    assert [t['current']['state'] for t in projection['targets']]==['up','down']
    assert [t['days'][0]['n'] for t in projection['targets']]==[1,1]
    checked('the same commit publishes its observations in the public projection')
    assert lab.value('set role anon; select coalesce(json_agg(summary),\'[]\'::json) from (select summary from public.status_runs order by generated_at desc limit 1) latest')==[projection]
    checked('already-open clients using the original status_runs API see the current projection')
    fingerprint="select json_build_array((select array_agg(xmin::text||ctid::text) from public.status_probe_batches),(select array_agg(xmin::text||ctid::text) from public.status_current),(select array_agg(xmin::text||ctid::text) from public.status_collector_leases))"
    before=lab.value(fingerprint);commit(second['token'],rows);assert lab.value(fingerprint)==before
    assert commit(second['token'],[dict(rows[0],ms=106),rows[1]],False).returncode
    assert lab.value(fingerprint)==before and claim()=={'state':'complete'}
    checked('identical retry has no row churn and conflicting retry cannot rewrite a batch')
    fetched=svc("select json_agg(r order by target_id) from public.status_raw_window('fixture',now()-interval '1 hour',now()+interval '1 hour') r")
    assert len(fetched)==2 and [r['ms'] for r in fetched]==[105,10000]
    checked('raw history reads include the new batch')
    with ThreadPoolExecutor(max_workers=1) as pool:
        holding=pool.submit(lab.sql,"begin; select runner from status_collector_leases where runner='fixture' for update; select pg_sleep(3); commit;")
        for _ in range(50):
            locked=lab.value("select to_json(exists(select 1 from pg_locks where relation='public.status_collector_leases'::regclass and mode='RowShareLock' and pid<>pg_backend_pid() and granted))")
            if locked: break
            time.sleep(.02)
        assert locked
        started=time.monotonic()
        assert claim()=={'state':'busy'} and svc("select public.rebuild_status_projection('fixture')")=={'state':'busy'}
        assert time.monotonic()-started<2
        holding.result()
    checked('claim and rebuild yield promptly to a held row lock')
    report['stage']='passed'
except Exception as error:
    report.update(stage='failed',error_type=type(error).__name__,error=str(error));raise
finally:
    report['finished_at']=datetime.now(timezone.utc).isoformat();report['check_count']=len(report['checks'])
    (out/('status-scheduler-sql-'+args.label+'.json')).write_text(json.dumps(report,indent=2)+'\n')
