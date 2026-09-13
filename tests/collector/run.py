"""Run synthetic storage and real HTTP contracts against an isolated local DB."""
from pathlib import Path
import os, subprocess, sys, tempfile, uuid

root=Path(__file__).resolve().parent
env={**os.environ, 'STATUS_TEST_ARTIFACT_DIR':os.environ.get('STATUS_TEST_ARTIFACT_DIR') or tempfile.mkdtemp(prefix='status-contract-')}
label='ci_'+uuid.uuid4().hex[:10]
for name in ('sql_contract.py','projection_parity.py','http_contract.py'):
    result=subprocess.run([sys.executable,str(root/name),label],env=env)
    if result.returncode: sys.exit(result.returncode)
print('All isolated collector contracts passed')
