from pathlib import Path
from datetime import datetime,timezone,timedelta
import argparse,importlib.util,json,subprocess,re
import os
import lab
from lab import out, root
parser=argparse.ArgumentParser();parser.add_argument('label');args=parser.parse_args();assert re.fullmatch('[a-z0-9_]+',args.label)
report_path=out/('status-projection-parity-'+args.label+'.json');assert not report_path.exists()
lab.sql('create database status_parity_'+args.label);lab.config['database']='status_parity_'+args.label
lab.sql((root/'supabase/migrations/20260811000000_status_store.sql').read_text())
lab.sql('grant all on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role;')
lab.sql((root/'supabase/migrations/20260913100307_status_atomic_collector.sql').read_text())
targets=[{'id':'alpha','name':'Alpha ☃','url':'https://alpha.invalid','expect':200},{'id':'beta','name':'Beta','url':'https://beta.invalid','expect':204},{'id':'empty','name':'Empty','url':'https://empty.invalid','expect':200}]
now=datetime(2026,9,13,12,tzinfo=timezone.utc)
stamp=lambda d:d.isoformat(timespec='milliseconds').replace('+00:00','Z')
records=[]
for day in [91,90,89,60,34,12,2,1,0]:
    for target in targets[:2]:
        for i,ms in enumerate([1,20,105,500,9999]):
            r={'id':target['id'],'t':stamp(now-timedelta(days=day,minutes=30-i)),'s':target['expect'] if i<3 else 503,'ms':ms}
            if i==4:r.update(s=None,e='timeout')
            records.append(r)
records.extend([{'id':'alpha','t':stamp(now+timedelta(days=1)),'s':200,'ms':777}, {'id':'removed','t':stamp(now-timedelta(days=1)),'s':200,'ms':17}])
legacy=records[:len(records)//2];batched=records[len(records)//2:]
def insert_native(rows):
    lab.sql('insert into public.status_samples(runner,checked_at,target_id,status,ms,error_class) select \'fixture\', (r->>\'t\')::timestamptz,r->>\'id\',(r->>\'s\')::integer,(r->>\'ms\')::integer,r->>\'e\' from jsonb_array_elements('+lab.json_literal(rows)+') r')
insert_native(legacy)
cfg=lab.json_literal(targets)
lab.sql('insert into public.status_target_configs(hash,targets) values (sha256(convert_to('+cfg+"::text,'UTF8')),"+cfg+')')
groups={}
for row in batched:groups.setdefault(row['t'],[]).append(row)
for checked_at,group in groups.items():
    value=lab.json_literal(group);t=lab.literal(checked_at)+'::timestamptz'
    lab.sql("insert into public.status_probe_batches(runner,slot,token,first_checked_at,last_checked_at,target_config_hash,records) values ('fixture',"+t+",gen_random_uuid(),"+t+','+t+",sha256(convert_to("+cfg+"::text,'UTF8')),"+value+')')
lab.sql('insert into public.status_collector_leases(runner,targets) values (\'fixture\','+cfg+')')
node=os.environ.get('STATUS_TEST_NODE','node')
def reference(label,payload):
    path=out/('status-projection-fixture-'+args.label+'-'+label+'.json');path.write_text(json.dumps(payload))
    result=subprocess.run([node,'node_modules/tsx/dist/cli.mjs','scripts/collector-projection-reference.ts',str(path)],cwd=root,capture_output=True,text=True,encoding='utf-8',timeout=30)
    assert result.returncode==0,result.stderr
    return json.loads(result.stdout)
report={'at':datetime.now(timezone.utc).isoformat(),'checks':[],'stage':'running','synthetic_only':True,'production_mutations':False}
def compare(label,actual,expected):
    if actual!=expected:
        (out/('status-projection-difference-'+args.label+'-'+label+'.json')).write_text(json.dumps({'actual':actual,'expected':expected},indent=2))
        raise AssertionError('Projection mismatch: '+label)
    report['checks'].append(label);print(label,flush=True)
def projection(when,full):return lab.value("set role service_role; select public.build_status_projection('fixture',"+lab.literal(stamp(when))+'::timestamptz,'+cfg+','+str(full).lower()+')')
try:
    full=projection(now,True);expected=reference('full',{'targets':targets,'records':records,'now':stamp(now)})
    compare('full window across legacy and batched rows, day edges, failures and empty targets',full,expected)
    lab.sql('insert into public.status_current(runner,generated_at,summary) values (\'fixture\','+lab.literal(stamp(now))+'::timestamptz,'+lab.json_literal(full)+')')
    later=now+timedelta(minutes=10)
    new=[{'id':'alpha','t':stamp(later),'s':200,'ms':112},{'id':'beta','t':stamp(later),'s':204,'ms':17}]
    insert_native(new);records.extend(new)
    affected=[r for r in records if r['t'][:10]==stamp(later)[:10]]
    compare('increment preserves earlier buckets and published rolling percentiles',projection(later,False),reference('increment',{'targets':targets,'records':records,'now':stamp(later),'previous':full,'affected':affected}))
    midnight=now.replace(hour=0)+timedelta(days=1,seconds=35)
    crossing=[{'id':'alpha','t':stamp(midnight-timedelta(seconds=50)),'s':200,'ms':98},{'id':'beta','t':stamp(midnight),'s':None,'ms':10000,'e':'tls'}]
    insert_native(crossing);records.extend(crossing)
    affected=[r for r in records if stamp(midnight-timedelta(seconds=125))[:10]<=r['t'][:10]<=stamp(midnight)[:10]]
    compare('midnight increment recomputes both affected days',projection(midnight,False),reference('midnight',{'targets':targets,'records':records,'now':stamp(midnight),'previous':full,'affected':affected}))
    lab.sql("update status_samples set status=503; update status_probe_batches set records=(select jsonb_agg(r || '{\"s\":503}'::jsonb order by ord) from jsonb_array_elements(records) with ordinality as x(r,ord));")
    failed=[dict(r,s=503) for r in records]
    compare('all-failure histories retain the original weighted median fallback',projection(midnight,True),reference('failed',{'targets':targets,'records':failed,'now':stamp(midnight)}))
    report['stage']='passed'
except Exception as error:report.update(stage='failed',error_type=type(error).__name__,error=str(error));raise
finally:
    report.update(finished_at=datetime.now(timezone.utc).isoformat(),check_count=len(report['checks']));report_path.write_text(json.dumps(report,indent=2)+'\n')
