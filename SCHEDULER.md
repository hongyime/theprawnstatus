# Status collection and free-tier protection

GitHub's five-minute uptime schedule has created events hours apart. Successful
jobs alone do not establish timely monitoring. The atomic backend moves the
timer to Supabase Cron and retains a GitHub manual recovery path.

The storage migration preserves every original sample and summary. It renames
`status_runs` to `status_runs_legacy`, then exposes the same public API through a
view combining that archive and one current projection. Existing inserts retain
their generated IDs and defaults. New runs append immutable observation batches
and deduplicated target configurations. Raw readers combine both formats.

The collector claims one five-minute slot, probes at most 24 trusted targets with
eight workers, and commits the complete batch and projection in one transaction.
The 145-second lease fences expired writers. Identical commit retries do not
rewrite rows. The 140-second overall deadline includes bounded database requests,
probe retries and redirect handling. Public or ordinary user JWTs cannot invoke
the collector: Supabase's gateway verifies the JWT signature, and the handler
requires the service role, this project reference, the platform issuer and an
unexpired token. The gateway must remain enabled with `verify_jwt=true`; the
claim check is not a signature verifier. This supports existing service tokens
when the platform-managed database credential differs. Callers cannot supply
target URLs.

At 400,000,000 application database bytes, the claim refuses new collection
before any probes or observation writes. The Cron commands additionally disable
this collector and only its two named jobs at that threshold. Existing history stays available and the UI
will mark the old result stale. The threshold can be lowered in the private
collector configuration. It is not a guarantee against growth from health
audits, other writers or platform overhead; those still require usage checks.

The local 30-day fixture retained all 190,080 observations. With a full 90-day
summary per legacy run, the old layout occupied 274.8 MB and the batch layout
7.3 MB. A 90-day batch fixture held 570,240 observations in 22.1 MB and rebuilt
the projection in 26.8 seconds. A burst of 1,000 current-projection updates used
21.7 MB and generated 27.9 MB of WAL. These are synthetic PostgreSQL 17.11 Windows
measurements, not a hosted billing month; production uses PostgreSQL 17.6 Linux.
After vacuum, a second burst of 1,000 updates grew that relation by another
5.2 MB to 26.9 MB; the initial expectation of less than 2 MB extra growth failed.
This is additional evidence against treating the small fresh-layout measurement
as a sustained-usage guarantee. Autovacuum timing, cron history, health history, frontend egress and actual
traffic add uncertainty. Unlimited retention cannot fit a finite quota forever.

## Release order

1. Pass unit, build, browser, database, permission and real HTTP contracts, then
   review CI on the release commit. `tests/collector/README.md` describes the
   isolated fixtures. No fault test contacts production providers.
2. Capture production row counts and fingerprints, check schema dependencies and
   apply the storage migration transactionally. Configure the validated existing
   target list with collection disabled. Compare all original data again.
3. Deploy `status-uptime-collector` with JWT verification enabled. Store the
   existing project service JWT in Supabase Vault through a parameterized
   request, never in source, migration history or logs. The Cron request uses
   that JWT. No new Edge-secret setting is required. Install the supported Cron
   and HTTP extensions. Verify that forged and ordinary user tokens are rejected
   and an authorized request sees a disabled collector before enabling it.
4. Set `STATUS_COLLECTION_BACKEND=atomic` and keep `STATUS_STORAGE=supabase`.
   The checked GitHub workflow then skips its recurring uptime/rebuild jobs;
   manual dispatches use the same lease, batches and database rebuild. Allow any
   older in-flight uptime job to finish before enabling the new collector.
5. Enable one five-minute Cron job and one daily database rebuild, away from
   collection times. Observe actual scheduled slots, data preservation, public
   snapshot freshness, advisor results and the Vercel production deployment.

## Recovery

Disable the new Cron jobs before intervening. Keep the atomic backend variable,
the compatibility views and every archive/batch table. Use the GitHub `uptime`
workflow's manual `uptime` or `rebuild` option; the collector reads the trusted
database target configuration and will refuse a disabled or over-capacity
configuration. Re-enable collection only after the cause has been checked.
An Edge outage can therefore use the checked Node recovery collector without
switching storage formats or deleting evidence.

Do not roll back to an older legacy writer while batches exist: an old reader
would omit those observations. Do not drop the migration to roll back scheduling.
Health auditing remains on its existing workflow. The storage migration is
applied with all original rows preserved. Scheduling is enabled after the hosted
authentication checks. Recurring gateway recovery verification is in progress.

## Production scheduling and gateway recovery

2026-09-13: Supabase Cron and atomic storage are enabled; the 13:00 and 13:10 UTC runs each committed one batch of 22 observations. The 13:05 request failed before acquiring a lease: Supabase edge logs show HTTP 504 on claim_status_collection, returned as collector HTTP 503. Original sample, archived-summary and health fingerprints still match. A real full rebuild and desktop/mobile history checks pass. The follow-up retries HTTP 502/503/504 once after 250 ms within the original 15-second database deadline, using the exact same body. An uncertain claim can return busy without duplicate probes; identical commit retries use the existing idempotence contract. Authorization/rate-limit failures and invalid successful response bodies are not retried.

`supabase/operations/status-cron.sql` recreates the two reviewed jobs **inactive**.
Follow the release sequence before activation. Configure the existing validated
targets and Vault secret `status_collector_service_jwt` first. The Redirects target
expects HTTP 308 without following the redirect; the other targets default to 200.
No credential is embedded in the SQL. Keep the Edge JWT-signature gateway enabled.

Production uses pg_cron 1.6.4, pg_net 0.20.4 and Vault 0.3.1. Collection runs every
five minutes; the full rebuild runs at 03:03 UTC with a 60-second statement limit.
The commands were checked in local SQL fixtures for disabled configuration,
enabled execution and stopping only their own jobs at capacity. Hosted scheduling
and the full rebuild were verified separately. The full rebuild preserved raw
batches and completed in a 0.5-second management API round trip at the initial size.

The pg_net extension namespace currently produces a public-extension advisor
warning, and this version is non-relocatable. Retain its queue/response evidence
while reviewing that warning; do not drop the extension as an automatic fix.
