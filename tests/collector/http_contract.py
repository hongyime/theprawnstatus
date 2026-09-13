from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse, base64, hashlib, hmac, importlib.util, json, os, re, secrets, socket, subprocess, threading, time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import lab
from lab import out, root
parser = argparse.ArgumentParser(); parser.add_argument('label'); args = parser.parse_args()
assert re.fullmatch('[a-z0-9_]+', args.label)
report_path = out/f'status-collector-http-{args.label}.json'; assert not report_path.exists()
report = {'at':datetime.now(timezone.utc).isoformat(), 'stage':'running', 'checks':[], 'synthetic_only':True, 'production_mutations':False}
processes=[]; handles=[]; server=None
def checked(name):
    report['checks'].append(name); print(name, flush=True)
def request(url, method='GET', value=None, token=None, prefer=None):
    headers={}
    if token: headers['Authorization']='Bearer '+token
    if url.startswith('http://127.0.0.1:54386/') and token==service:
        headers['x-status-collector-authorization']='Bearer '+collector_secret
    if prefer: headers['Prefer']=prefer
    data=None if value is None else json.dumps(value).encode()
    if data is not None: headers['Content-Type']='application/json'
    req=Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=35) as response: return response.status, response.read()
    except HTTPError as error: return error.code, error.read()
def jwt(role, secret):
    encode=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).decode().rstrip('=')
    value=encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'role':role,'exp':int(time.time())+7200})
    return value+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),value.encode(),hashlib.sha256).digest()).decode().rstrip('=')
def launch(command, env, name):
    handle=(out/f'status-http-{args.label}-{name}.log').open('wb'); handles.append(handle)
    process=subprocess.Popen(command, env=env, cwd=root, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    processes.append(process); return process
def wait_http(url, process):
    for _ in range(100):
        assert process.poll() is None, 'Owned fixture server exited before readiness: '+str(process.returncode)
        try:
            code,_=request(url)
            if code in (200,401,405): return
        except OSError: pass
        time.sleep(.1)
    raise AssertionError('Fixture server readiness timeout')
def fingerprint(table):
    return lab.value("select json_build_object('rows',count(*),'hash',md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),''))) from public."+table+' t')
def counts():
    return lab.value('select json_build_array((select count(*) from status_probe_batches),(select count(*) from status_current))')
try:
    for port in (54385,54386,54387):
        with socket.socket() as sock: sock.bind(('127.0.0.1',port))
    database='status_http_'+args.label
    lab.sql('create database '+database); lab.config['database']=database
    lab.sql((root/'supabase/migrations/20260811000000_status_store.sql').read_text())
    lab.sql('grant all on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role;')
    lab.sql("insert into status_samples(checked_at,target_id,status,ms) values ('2026-08-20T00:00:00Z','retained',200,42); insert into status_runs(generated_at,target_count,summary) values ('2026-08-20T00:00:00Z',0,'{\"generated_at\":\"2026-08-20T00:00:00.000Z\",\"window_days\":90,\"targets\":[]}');")
    old_samples=fingerprint('status_samples'); old_runs=fingerprint('status_runs')
    password=secrets.token_urlsafe(32); jwt_secret=secrets.token_urlsafe(48)
    authenticator='status_http_'+args.label
    lab.sql('create role '+authenticator+' login password '+lab.literal(password)+'; grant anon, authenticated, service_role to '+authenticator)
    service=jwt('service_role',jwt_secret); anon=jwt('anon',jwt_secret);collector_secret=secrets.token_urlsafe(48)
    env={k:v for k,v in os.environ.items() if not k.startswith(('SUPABASE_','PGRST_'))}
    env['PATH']=str(lab.config['binary'])+os.pathsep+env.get('PATH','')
    env.update(PGRST_DB_URI=f"postgresql://{authenticator}:{password}@127.0.0.1:{lab.config['port']}/{database}",PGRST_DB_SCHEMAS='public',PGRST_DB_ANON_ROLE='anon',PGRST_JWT_SECRET=jwt_secret,PGRST_SERVER_HOST='127.0.0.1',PGRST_SERVER_PORT='54385',PGRST_DB_POOL='3')
    pgrst={'binary':os.environ['STATUS_TEST_POSTGREST'],'version':subprocess.check_output([os.environ['STATUS_TEST_POSTGREST'],'--version'],env=env,text=True).strip()}
    rest=launch([pgrst['binary']],env,'postgrest'); wait_http('http://127.0.0.1:54385/',rest)
    code, body=request('http://127.0.0.1:54385/status_runs?select=summary&order=generated_at.desc&limit=1')
    assert code==200 and json.loads(body)[0]['summary']['targets']==[]
    checked('original public endpoint reads existing data before migration')
    lab.sql('begin; '+(root/'supabase/migrations/20260913100307_status_atomic_collector.sql').read_text()+' commit;')
    for _ in range(60):
        code,body=request('http://127.0.0.1:54385/rpc/claim_status_collection','POST',{'p_runner':'github-actions'},service)
        if code==200: break
        time.sleep(.1)
    assert code==200 and json.loads(body)=={'state':'disabled'}
    assert fingerprint('status_samples')==old_samples and fingerprint('status_runs_legacy')==old_runs
    checked('warm PostgREST reload preserves old rows and exposes disabled RPC')
    for endpoint in ('status_probe_batches','status_target_configs','status_collector_leases'):
        assert request('http://127.0.0.1:54385/'+endpoint,token=anon)[0] in (401,403)
    assert request('http://127.0.0.1:54385/rpc/claim_status_collection','POST',{'p_runner':'github-actions'},anon)[0] in (401,403)
    checked('real anonymous JWT cannot read raw collector data or claim a run')
    imported={'generated_at':'2026-08-21T00:00:00.000Z','target_count':0,'summary':{'generated_at':'2026-08-21T00:00:00.000Z','window_days':90,'targets':[]}}
    code,body=request('http://127.0.0.1:54385/status_runs','POST',imported,service,'return=representation')
    assert code==201, (code,body.decode()[:300])
    inserted=json.loads(body)[0]
    assert inserted['runner']=='github-actions' and inserted['window_days']==90 and inserted['id']>0
    archive=fingerprint('status_runs_legacy')
    checked('legacy REST insert preserves generated identity and default columns')
    activity={'rpc':0,'probe':0,'active':0,'max_active':0,'credential_leaks':0}; lock=threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_GET(self): self.respond()
        def do_HEAD(self): self.respond()
        def do_POST(self): self.respond()
        def respond(self):
            if self.path.startswith('/rest/v1/'):
                with lock: activity['rpc']+=1
                data=self.rfile.read(int(self.headers.get('Content-Length','0')))
                value=json.loads(data) if data else None
                token=self.headers.get('Authorization','').removeprefix('Bearer ')
                status,body=request('http://127.0.0.1:54385'+self.path.removeprefix('/rest/v1'),self.command,value,token)
                self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
                return
            with lock:
                if any(self.headers.get(k) for k in ['Authorization','apikey','x-status-collector-authorization']):activity['credential_leaks']+=1
                activity['probe']+=1; activity['active']+=1; activity['max_active']=max(activity['max_active'],activity['active'])
            try:
                time.sleep(.08)
                status=503 if self.path=='/failure' else 302 if self.path=='/redirect' else 200
                self.send_response(status)
                if status==302:self.send_header('Location','/ok')
                self.send_header('Content-Length','0'); self.end_headers()
            finally:
                with lock: activity['active']-=1
    server=ThreadingHTTPServer(('127.0.0.1',54387),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    targets=[{'id':f'target-{i}','name':f'Fixture {i} 雪','url':f'http://127.0.0.1:54387/'+('failure' if i==21 else 'redirect' if i==20 else 'ok'),'expect':200} for i in range(22)]
    lab.sql("insert into status_collector_leases(runner,enabled,targets) values ('github-actions',true,"+lab.json_literal(targets)+')')
    harness=out/f'status-http-{args.label}-entry.ts'
    harness.write_text('import {createCollectorRpc,createStatusCollector} from '+json.dumps((root/'shared/status-collector.ts').as_uri())+';\nconst key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;\nDeno.serve({hostname:"127.0.0.1",port:54386},createStatusCollector({secret:Deno.env.get("STATUS_COLLECTOR_SECRET")!,authorizationHeader:"x-status-collector-authorization",rpc:createCollectorRpc(Deno.env.get("SUPABASE_URL")!,key)}));\n')
    deno_env={k:v for k,v in os.environ.items() if not k.startswith(('SUPABASE_','PGRST_'))}
    deno_env.update(SUPABASE_URL='http://127.0.0.1:54387',SUPABASE_SERVICE_ROLE_KEY=service,STATUS_COLLECTOR_SECRET=collector_secret)
    deno=launch([os.environ.get('STATUS_TEST_DENO','deno'),'run','--no-config','--allow-env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,STATUS_COLLECTOR_SECRET','--allow-net=127.0.0.1',str(harness)],deno_env,'deno')
    endpoint='http://127.0.0.1:54386/'
    wait_http(endpoint,deno)
    assert request(endpoint)[0]==405
    for token in (None,anon,'invalid'):
        assert request(endpoint,'POST',{},token)[0]==401
    assert activity['rpc']==0 and activity['probe']==0
    checked('actual Deno HTTP authentication denies callers before all database and probe work')
    lab.sql("create function fixture_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic failure';end$$;create trigger fixture_fail before insert or update on status_current for each row execute function fixture_fail();")
    code,body=request(endpoint,'POST',{},service)
    assert code==503 and json.loads(body)=={'error':'collection_incomplete'} and counts()==[0,0]
    assert fingerprint('status_samples')==old_samples and fingerprint('status_runs_legacy')==archive
    checked('real HTTP projection failure atomically rolls back batch and snapshot without changing old data')
    lab.sql("drop trigger fixture_fail on status_current;update status_collector_leases set lease_expires_at=now()-interval '1 second' where runner='github-actions'")
    before_probe=activity['probe']
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses=list(pool.map(lambda _:request(endpoint,'POST',{'targets':[{'url':'https://never-contact.invalid'}]},service),range(4)))
    assert all(code==200 for code,_ in responses),responses
    outcomes=[json.loads(body) for _,body in responses]
    assert sum(v['checked'] for v in outcomes)==22 and counts()==[1,1]
    assert activity['probe']-before_probe==25 and activity['max_active']<=8
    assert all(v['state'] in ('complete','busy') for v in outcomes)
    checked('four concurrent HTTP calls produce one 22-target batch with at most eight simultaneous probes')
    cfg=lab.value('select targets from status_target_configs')
    records=lab.value('select records from status_probe_batches')
    assert cfg==targets and len(records)==22 and records[-1]['s']==503 and 'e' not in records[-1]
    assert fingerprint('status_samples')==old_samples and fingerprint('status_runs_legacy')==archive
    code,body=request('http://127.0.0.1:54385/status_runs?select=summary&order=generated_at.desc&limit=1',token=anon)
    assert code==200 and len(json.loads(body)[0]['summary']['targets'])==22
    checked('original dashboard REST query sees committed data and original evidence stays unchanged')
    before_probe=activity['probe']; before_counts=counts()
    repeat=json.loads(request(endpoint,'POST',{},service)[1])
    after_repeat=counts();new_slots=after_repeat[0]-before_counts[0]
    assert new_slots in (0,1) and after_repeat[1]==1 and repeat['checked']==22*new_slots
    assert activity['probe']-before_probe==25*new_slots
    checked('repeat HTTP call reuses its completed slot or collects exactly one newly opened slot')
    before_probe=activity['probe'];before_counts=counts()
    node_harness=out/f'status-http-{args.label}-node.mts'
    node_harness.write_text('import {collectAtomicStatus,rebuildAtomicStatus,readProbeRecordsForDayFromSupabase,readProbeRecordsSinceFromSupabase} from '+json.dumps((root/'scripts/lib/supabase-store.ts').as_uri())+';\nawait collectAtomicStatus();\nawait rebuildAtomicStatus();\nconst day=new Date().toISOString().slice(0,10);\nconst today=await readProbeRecordsForDayFromSupabase(day);\nconst all=await readProbeRecordsSinceFromSupabase(new Date("2026-08-01T00:00:00Z"));\nconsole.log(JSON.stringify({today:today.length,all:all.length,retained:all.some(r=>r.id==="retained")}));\n')
    node_env={**deno_env,'STATUS_STORAGE':'supabase','STATUS_COLLECTION_BACKEND':'atomic','STATUS_RUNNER':'github-actions'}
    node_result=subprocess.run([os.environ.get('STATUS_TEST_NODE','node'),str(root/'node_modules/tsx/dist/cli.mjs'),str(node_harness)],cwd=root,env=node_env,capture_output=True,text=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    assert node_result.returncode==0, node_result.stderr[:600]
    expected_today=lab.value("select to_json(count(*)) from status_probe_batches cross join lateral jsonb_array_elements(records) r where (r->>'t')::timestamptz >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'")
    after_node=counts();new_slots=after_node[0]-before_counts[0]
    assert new_slots in (0,1) and after_node[1]==1 and activity['probe']-before_probe==25*new_slots
    assert json.loads(node_result.stdout.strip().splitlines()[-1])=={'today':expected_today,'all':22*after_node[0]+1,'retained':True}
    assert fingerprint('status_runs_legacy')==archive and fingerprint('status_samples')==old_samples
    checked('real Node recovery and rebuild use the atomic contract and read both preserved storage formats')
    assert activity['credential_leaks']==0
    checked('private collector and database credentials never reach synthetic provider requests')
    report.update(stage='passed',check_count=len(report['checks']),postgrest_version=pgrst['version'],postgres_version=lab.value("select to_json(version())"),deno_version=subprocess.check_output([os.environ.get('STATUS_TEST_DENO','deno'),'--version'],text=True).splitlines()[0],activity=activity,legacy_samples_preserved=old_samples,legacy_archive_preserved=archive)
except Exception as error:
    report.update(stage='failed',error_type=type(error).__name__,error=str(error)[:1000]); raise
finally:
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
    if server: server.shutdown();server.server_close()
    for handle in handles: handle.close()
    report['finished_at']=datetime.now(timezone.utc).isoformat();report['owned_http_servers_stopped']=all(p.poll() is not None for p in processes)
    report_path.write_text(json.dumps(report,indent=2)+'\n')
