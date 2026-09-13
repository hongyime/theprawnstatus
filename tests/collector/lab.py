"""Isolated PostgreSQL fixture client. Only loopback databases are accepted."""
from pathlib import Path
import json, os, subprocess, tempfile

root = Path(__file__).resolve().parents[2]
out = Path(os.environ.get('STATUS_TEST_ARTIFACT_DIR') or tempfile.mkdtemp(prefix='status-contract-'))
out.mkdir(parents=True, exist_ok=True)
assert os.environ.get('PGHOST', '127.0.0.1') in ('127.0.0.1', 'localhost'), 'Tests require a loopback PostgreSQL fixture'
config = {'database':'postgres', 'port':int(os.environ.get('PGPORT','5432')), 'binary':str(Path(os.environ.get('STATUS_TEST_PSQL','psql')).parent)}
env = {**os.environ, 'PGCONNECT_TIMEOUT':'5', 'PGCLIENTENCODING':'UTF8'}

def sql(query, check=True, timeout=45):
    assert config['database']=='postgres' or config['database'].startswith('status_')
    result = subprocess.run([os.environ.get('STATUS_TEST_PSQL','psql'), '-X','-qAt','-v','ON_ERROR_STOP=1',
        '-h','127.0.0.1','-p',str(config['port']),'-U',os.environ.get('PGUSER','postgres'),'-d',config['database']],
        input=query, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout,
        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if check and result.returncode: raise RuntimeError(result.stderr)
    return result

def value(query): return json.loads(sql(query).stdout.strip())
def literal(value): return "'"+str(value).replace("'","''")+"'"
def json_literal(value): return literal(json.dumps(value,ensure_ascii=False))+'::jsonb'
