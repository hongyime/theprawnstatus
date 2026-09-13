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
the collector: the hosted endpoint keeps platform JWT verification and also
requires `X-Status-Collector-Authorization: Bearer <private collector secret>`.
The private secret grants collection access only; the database credential stays
inside the Edge runtime. Callers cannot supply target URLs.

At 400,000,000 application database bytes, the claim refuses new collection
before any probes or data writes. Existing history stays available and the UI
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
3. Deploy `status-uptime-collector` with JWT verification enabled. Configure a
   dedicated `STATUS_COLLECTOR_SECRET` in Edge secrets and Supabase Vault through
   parameterized requests, never in source, migration history or logs. The Cron
   request carries a platform JWT plus the separate private collector header.
   Install the supported Cron and HTTP extensions.
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
applied with all original rows preserved. Scheduling remains disabled until
the dedicated-secret hosted authentication checks and cutover checks pass.
