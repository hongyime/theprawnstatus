## Portability maintenance - 2026-09-27

- Documented platform-neutral npm and optional PowerShell 7 maintenance invocation. Cleanup remains an explicit remote operation; no service or cleanup ran.

# Current production exception

2026-09-14 09:35 SGT emergency: status-uptime-5m Cron job 1 is now INACTIVE after the Vercel team reached 100% of its Fluid Active CPU allowance. This stops automatic external website probes; existing observations, the enabled collector lease and daily rebuild are retained. GitHub STATUS_COLLECTION_BACKEND remains atomic, so its recurring fallback jobs are skipped. Do not reactivate five-minute polling until CPU attribution and a budgeted cadence are reviewed. Historical data remains in Supabase. See the portfolio incident report; scheduled requests removed are not measured CPU savings.

## Live operations - 2026-11-14

`uptime.yml` is disabled and the Supabase `github-actions` lease is `enabled: false`, verified by the successful Pause status collector run 43602818732. Migration `20261114000000_status_expect_default` is applied to production and present in the live migration ledger. Vercel cleanup run 43655396431 made no list/delete decision because `VERCEL_TOKEN` was rejected as invalid; replace the repository secret with a complete newly generated token before rerunning. Do not re-enable either collector entry point without a reviewed capacity decision.

# Project State

2026-09-13: Supabase Cron and atomic storage are enabled; the 13:00 and 13:10 UTC runs each committed one batch of 22 observations. The 13:05 request failed before acquiring a lease: Supabase edge logs show HTTP 504 on claim_status_collection, returned as collector HTTP 503. Original sample, archived-summary and health fingerprints still match. A real full rebuild and desktop/mobile history checks pass. The follow-up retries HTTP 502/503/504 once after 250 ms within the original 15-second database deadline, using the exact same body. An uncertain claim can return busy without duplicate probes; identical commit retries use the existing idempotence contract. Authorization/rate-limit failures and invalid successful response bodies are not retried.

Next: pass hosted checks, merge and deploy the gateway-recovery fix, then observe two consecutive recurring slots and publish the HTML/Markdown checkpoint. Keep the original failed response in the evidence. All data stays in Supabase. At 400 MB the collector and only its two Cron jobs disable while history remains readable. Monthly quota fit and sustained growth remain unproven.

The pg_net installation has a public-extension namespace advisor warning; pg_net 0.20.4 reports non-relocatable. Its objects and permissions need inspection before considering a move; do not drop it or delete retained operational evidence. No Edge secret setting was applied after HTTP 403; the unused request secret remains in Vault.

## Maintenance hardening - 2026-11-14

Implemented and pushed the reviewed maintenance hardening: cleanup guard, collector normalization and forward migration, conflict recovery, tree-based Git health reads, enriched health history, dashboard efficiency, and obsolete keepalive removal. Unit (109), lint, type, production-build, browser (27 fixture-configured cases), offline PowerShell guard, and isolated PostgreSQL/Deno/PostgREST collector contracts pass. The forward migration is live and collector pause is verified; only the Vercel credential blocker remains.
