# Collector contract fixtures

`python3 tests/collector/run.py` runs the SQL permission, lease, rollback,
summary parity and real Deno/PostgREST HTTP checks. All probe traffic goes to a
synthetic loopback server. Existing production URLs and credentials are excluded
from the fixture processes.

Use a disposable PostgreSQL instance on loopback, with `PGPORT`, `PGUSER` and
`PGPASSWORD` set for its administrator. The harness creates new `status_*`
databases and fixture roles; it does not drop existing databases. Never point it
at a production database or tunnel. Set `STATUS_TEST_POSTGREST` to PostgREST 14.5;
`deno`, `node` and `psql` must be on PATH or selected through `STATUS_TEST_DENO`,
`STATUS_TEST_NODE` and `STATUS_TEST_PSQL`. Ports 54385–54387 must be free. Only
processes started by the fixture are stopped afterward.

CI supplies PostgreSQL 17.6, Deno 2.9.6 and a checksum-verified PostgREST 14.5
binary. JSON reports and synthetic server logs are saved to
`STATUS_TEST_ARTIFACT_DIR`. Capacity benchmarks are separate from this fast
contract suite; passing fixtures do not establish production usage or uptime.
