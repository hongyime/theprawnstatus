# Implementation Plan — theprawnstatus

**Companion to:** `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md`
**Intended executor:** a coding agent, one task at a time
**Date:** 2026-08-09

---

## How to use this document

Tasks are executed **in order**. Each has explicit files, steps, and a **Done when** clause that is machine-verifiable or observable — no task is complete because it feels complete.

**STOP gates** require a human. The agent halts, reports, and waits. It does not proceed on assumption. Gates exist where a wrong decision is expensive to unwind or where information only the human has is required.

---

## Agent operating rules

These apply to every task without exception.

1. **Never push to the `data` branch from a development machine.** CI writes it. A local push will desync `summary.json` from the shards.
2. **Never force-push `main`.** Never rewrite `main`'s history.
3. **No `.sh` files. No bash-only npm scripts.** Local environment is Windows 11 / PowerShell. Git plumbing goes in Node via `child_process`, not in workflow YAML. Every `npm run` script must work in both PowerShell and `ubuntu-latest`.
4. **Never add `SHELL_IDENTITY`, or any identity value, as a secret, fixture, test constant, or comment in this repository.** Not temporarily. This is a public repo. See TDD §10.
5. **This repo is read-only against the rest of the estate.** No token here gets write permission on any other repo.
6. **Pin third-party GitHub Actions to a commit SHA**, not a tag.
7. **Do not invent the SHELL standard.** If `standard.json` needs a threshold that `STANDARD.md` does not specify, stop and ask.
8. **Commit per task**, message `M<phase>-<n>: <goal>`. Do not batch phases into one commit.
9. If a **Done when** clause cannot be satisfied, stop and report why. Do not weaken the criterion.

---

## Phase M0 — Foundation

*Target: 0.5 day. Outcome: a SHELL-compliant repo with the data contract fixed and the data branch alive.*

### M0-1 — Create the repo, compliant from birth

**Files:** `LICENSE`, `NOTICE`, `README.md`, `SECURITY.md`, `.gitignore`
**Do:**
- Create `hongyime/theprawnstatus`, public, default branch `main`.
- `LICENSE`: Apache-2.0, full text, unmodified.
- `NOTICE`: copyright attributed to **The Prawn Organisation** — not a legal personal name.
- `SECURITY.md`: disclosure contact and supported-versions statement.
- `README.md`: one-liner, link to the three docs, "sampled every ~15 min — indicative, not an SLA" note.
- `.gitignore`: Node defaults plus `data-wt/` (the data branch working tree) and `.keepalive`.

**Done when:** the repo would pass its own `standard.json` on every check that does not require code to exist yet. No personal name appears in any file.

---

### M0-2 — Toolchain

**Files:** `package.json`, `tsconfig.json`, `.editorconfig`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`
**Do:**
- Node 20, `"type": "module"`, TypeScript strict mode.
- Dev deps: `typescript`, `tsx`, `vitest`, `eslint`, `prettier`, `@types/node`.
- Scripts: `check:uptime`, `rebuild:summary`, `check:health`, `test`, `lint`, `dev`, `build`.
- Every script is `tsx scripts/<x>.ts` — no shell operators, no `&&` chains that depend on POSIX.

**Done when:** `npm run lint` and `npm test` both exit 0 on an empty test suite, **run from PowerShell on Windows**. This is a real check, not a formality — it is where cross-platform assumptions break.

---

### M0-3 — The data contract

**Files:** `shared/types.ts`
**Do:** Define and export, matching TDD §5.3 and §7.4 exactly:
- `ProbeRecord` — `{ t, id, s: number | null, ms, e?: ErrorClass }`
- `ErrorClass` — `'timeout' | 'dns' | 'tls' | 'conn' | 'abort'`
- `DayBucket` — `{ d, n, ok, p50 }`
- `TargetSummary`, `Summary` (with `schema: 1`)
- `DayState` — `'up' | 'degraded' | 'down' | 'no-data'`
- `RepoHealth`, `HealthReport`, `HealthHistoryLine`
- `TargetConfig`, `StandardConfig`

Also export `dayState(bucket): DayState` implementing the thresholds in TDD §5.3, so the collector and the UI cannot disagree about what amber means.

**Done when:** `shared/types.ts` compiles under `strict`, and is the only place any of these shapes is declared. `grep` finds no duplicate interface definitions elsewhere.

---

### M0-4 — Target configuration ⚠️ needs human input

**Files:** `config/targets.json`, `scripts/lib/config.ts`
**Do:**
- Schema: `[{ id, name, url, expect?: number }]`, `expect` defaulting to 200.
- Populate with all 14 deployments.
- `config.ts` loads and validates: unique ids, absolute `https://` URLs, `id` matching `^[a-z0-9-]+$` (it becomes a filename-safe key and a DOM id).

**Done when:** validation rejects a duplicate id, a relative URL, and an uppercase id, each with a distinct error. All 14 real targets load clean.

> **Requires from human:** the list of 14 — id, display name, URL, and any target that legitimately returns something other than 200. Known so far: `smuseats`, `dejavista`, `swiperboxd`.

---

### M0-5 — Orphan data branch

**Files:** *(on branch `data` only)*
**Do:**
```
git checkout --orphan data
git rm -rf .
```
Seed: `summary.json` (`{"generated_at":null,"window_days":90,"schema":1,"targets":[]}`), an empty `history/.gitkeep`, and a `README.md` on the branch saying **"Machine-written. Do not edit by hand. Do not merge into main."**
Push. Return to `main`.

**Done when:** `git log data --oneline` shows exactly one commit with no shared ancestry with `main` (`git merge-base main data` returns nothing). `main`'s tree is unchanged.

---

### M0-6 — Data branch helper

**Files:** `scripts/lib/data-branch.ts`, `scripts/lib/data-branch.test.ts`
**Do:** Export `withDataBranch(opts, fn)` handling:
- Sparse shallow clone per TDD §5.5 (`--depth=1 --filter=blob:none --no-checkout`, `sparse-checkout set` with explicit paths).
- A `full: true` option that skips sparse-checkout for the rebuild job.
- Commit with a bot identity (`github-actions[bot]`).
- **Push with rebase-retry: up to 3 attempts, `git pull --rebase` between them.**
- Guaranteed cleanup of the working tree on both success and failure.
- All git invocation via `child_process` with argument arrays — never a shell string, never a path with unescaped separators. This is what makes it work on Windows.

**Done when:** unit tests cover the retry path with a mocked failing push. Manually invoking it against a scratch branch from PowerShell completes and cleans up.

---

### 🛑 STOP 1 — Foundation review

Agent halts. Human verifies: `data` branch exists and is orphaned; `main` history is clean; all 14 targets configured; toolchain runs from PowerShell.

---

## Phase M1 — Uptime collection

*Target: 1 day. Outcome: data accumulating on the `data` branch, unattended.*

### M1-1 — Probe

**Files:** `scripts/lib/probe.ts`
**Do:** `probe(target): Promise<ProbeRecord>` per TDD §6.1 — `GET`, 10s `AbortSignal.timeout`, follow redirects (max 5), the project User-Agent, 3 total attempts with 1s/3s backoff, **one record returned regardless of attempt count**. Classify thrown errors into `ErrorClass`. `s` is `null` when no HTTP response was received. Latency measured on the final attempt, to response headers.

**Done when:** the function never returns more than one record, and never returns a non-null `s` alongside an `e`.

---

### M1-2 — Probe tests

**Files:** `scripts/lib/probe.test.ts`
**Do:** With `fetch` mocked, cover: 200 first try; 502 with `expect: 200`; timeout → `e: 'timeout'`, `s: null`; DNS failure → `e: 'dns'`; **transient failure that succeeds on attempt 2 → recorded as success**; all three attempts fail → one failure record.

**Done when:** all six pass. The fifth is the one that matters — it is the retry logic doing its job.

---

### M1-3 — Summary engine

**Files:** `scripts/lib/summary.ts`
**Do:** Two pure functions, no I/O:
- `applyIncrement(summary, records, now)` — update today's bucket and `current`, drop day-buckets outside the 90-day window, bump `generated_at`. Recompute today's `p50` from that day's records.
- `rebuild(shards, targets, now)` — full recompute of every bucket, `uptime_90d`, `p50_ms`, `p95_ms`.

Both must handle: a target with zero samples today; a target newly added to config with no history; a target removed from config (drop it); a day with a partial sample count.

**Done when:** for a fixed fixture of shards, `applyIncrement` applied sequentially and `rebuild` applied once produce **identical output for every field except `p95_ms`** (which is rebuild-only by design, per TDD §5.4). Assert this equivalence as a test — it is the guarantee that the self-heal path and the fast path agree.

---

### M1-4 — Summary tests

**Files:** `scripts/lib/summary.test.ts`
**Do:** Cover the equivalence property above, the 90-day eviction boundary (day 90 kept, day 91 dropped), all four `dayState` thresholds including the 0.95 boundary exactly, a new target appearing mid-window, and an empty-history cold start.

**Done when:** all pass, including the exact-boundary cases.

---

### M1-5 — Uptime entry point

**Files:** `scripts/check-uptime.ts`
**Do:** Load targets → probe all with concurrency cap 5 → `withDataBranch` (sparse: `summary.json` + today's shard) → append records to `history/<today>.jsonl` → `applyIncrement` → write `summary.json` → commit `"chore(data): uptime <ISO timestamp>"` → push.

Exit non-zero if the push ultimately fails. Exit **zero** if individual targets failed to respond — that is data, not an error, and a red workflow badge for a genuinely down site trains you to ignore the badge.

**Done when:** run locally from PowerShell against a scratch branch, the shard gains 14 lines and `summary.json` reflects them. Run twice: the shard has 28 lines and `summary.json` still has exactly one day-bucket for today with `n: 2` per target.

---

### M1-6 — Uptime workflow

**Files:** `.github/workflows/uptime.yml`
**Do:** Per TDD §6.2 — cron `3,18,33,48 * * * *`, `workflow_dispatch`, `concurrency: { group: data-branch, cancel-in-progress: false }`, `permissions: { contents: write }`, Node 20, npm cache, `npm ci`, `npm run check:uptime`. Actions pinned to SHA.

**Done when:** `workflow_dispatch` succeeds and the resulting `data` commit is authored by the bot. Three scheduled runs land ~15 min apart.

---

### M1-7 — Rebuild and prune

**Files:** `scripts/rebuild-summary.ts`, job added to `.github/workflows/uptime.yml`
**Do:** Daily job (cron `20 0 * * *`), same concurrency group: full checkout → read all shards → `rebuild` → write `summary.json` → `git rm` shards older than 90 days → commit `"chore(data): daily rebuild + prune"`.

**Done when:** running it immediately after `check-uptime` produces a `summary.json` differing only in `p95_ms` and `generated_at`. Seed a shard dated 100 days ago and confirm it is deleted.

---

### M1-8 — Keepalive

**Files:** `.github/workflows/keepalive.yml`
**Do:** Monthly cron (`0 6 1 * *`). Write the current ISO date into `.keepalive` on `main`, commit `"chore: keepalive"`, push. Per TDD §6.4.

**Done when:** `workflow_dispatch` produces exactly one commit on `main` and touches nothing else.

---

### 🛑 STOP 2 — Collection review

Agent halts. Human waits for **three consecutive scheduled runs** (~45 min) and verifies: shards appended correctly; `summary.json` internally consistent; `main` has no cron commits; nothing on the `data` branch contains a secret.

---

## Phase M2 — The board

*Target: 1.5 days.*

### M2-1 — Frontend scaffold

**Files:** `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `tailwind.config.js`, `src/index.css`
**Do:** Vite + React + TS + Tailwind in the existing repo root (one `package.json` — do not create a workspace). `src/` may import from `shared/` via a tsconfig path alias.

**Done when:** `npm run dev` serves from PowerShell and `npm run build` produces `dist/`. A type imported from `shared/types.ts` resolves in a component.

---

### M2-2 — Visual language

**Files:** `src/index.css`, `tailwind.config.js`, `src/components/primitives.tsx`
**Do:** Neobrutalist tokens per TDD §8.2 — thick borders, hard zero-blur offset shadows, flat saturated fills, grotesk display + mono numerics with `font-variant-numeric: tabular-nums`. Define semantic colours for `up` / `degraded` / `down` / `no-data`. `font-display: swap`.

**Done when:** the four state colours are defined once as tokens and referenced nowhere else by literal value.

---

### M2-3 — Data loading ⚠️ verify CORS here

**Files:** `src/hooks/useStatusData.ts`, `public/snapshot.json`, build step in `package.json`
**Do:** Per TDD §8.1 — fetch `summary.json` from raw.githubusercontent; on failure fall back to `/snapshot.json` with a banner; independently, flag `generated_at` older than 45 minutes as stale. Build step copies the current `summary.json` into `public/snapshot.json` at build time.

**Confirm CORS works from the Vercel origin before building on this.** If it does not, stop and report — TDD §11 alternative 4 is the fallback.

**Done when:** all three states are demonstrable — live, snapshot-fallback, stale. **Stale data does not render green under any of them.** (PRD S6.)

---

### M2-4 — Uptime strip

**Files:** `src/components/UptimeStrip.tsx`
**Do:** 90 bars, oldest → newest, coloured by `dayState`. Missing days render as `no-data`, not omitted — a gap must occupy space. Hover/focus tooltip with date, `n`, `ok`, uptime %, `p50`.

Accessibility per TDD §8.4: the strip is one `role="img"` with a summary label; state is doubled in a non-colour channel (height or fill pattern) so it reads in greyscale.

**Done when:** it renders correctly with 90 days, 3 days, and 0 days of data; the greyscale test passes; a screen reader announces one summary rather than ninety bars.

---

### M2-5 — Target row

**Files:** `src/components/TargetRow.tsx`
**Do:** Display name (linking to the live URL), current-status pill containing the **word** not just the colour, the strip, uptime % and `p50` right-aligned in tabular figures.

**Done when:** rows align across all 14 targets regardless of name length or latency digit count.

---

### M2-6 — Board assembly

**Files:** `src/App.tsx`, `src/components/Banner.tsx`
**Do:** Header with title and last-checked time; staleness/snapshot banner; the 14 rows; footer with the "sampled every ~15 min — indicative, not an SLA" note and a link to the repo. Handle loading, error, and empty states explicitly — no bare spinner that persists forever on failure.

**Done when:** all four states (loading / loaded / stale / failed) are reachable and visually distinct.

---

### M2-7 — Deploy

**Files:** `vercel.json`
**Do:** Deploy to Vercel from `main`. Static build, no serverless functions. Set caching headers so `index.html` is not cached but hashed assets are.

**Done when:** the board is live, and a `data`-branch update appears on it within ~5 minutes **without a redeploy**.

---

### 🛑 STOP 3 — Outage test (PRD S2)

Agent halts. Human pauses one Vercel project, waits 30 minutes, confirms the board goes red and the day-bucket degrades, then unpauses and confirms recovery. **If this fails, do not proceed to M3.**

---

## Phase M3 — Polish

*Target: 0.5 day.*

### M3-1 — Latency display
**Files:** `src/components/TargetRow.tsx`
Show `p50` with `p95` on hover. Format `<1000ms` as `412ms`, `≥1000ms` as `3.0s`.
**Done when:** both formats render, and a `null` latency shows an em dash rather than `NaN`.

### M3-2 — Performance budget
**Files:** as needed
Measure cold-cache load. Budget: **<1s to interactive** (PRD S4).
**Done when:** measured and recorded in `README.md`. If over budget, report the cause rather than silently accepting it.

### M3-3 — README
**Files:** `README.md`
Screenshot, what the board measures, what it does not (not an SLA, not a pager), how to add a target, the `HEALTH_PAT` expiry date placeholder.
**Done when:** someone who has never seen the repo can add a 15th target from the README alone.

---

## Phase M4 — Health half

### 🛑 STOP 4 — Prerequisites ⚠️ blocks the entire phase

Agent halts until the human provides:
1. **`STANDARD.md`** — the definitive check list and thresholds (TDD Q2).
2. **`HEALTH_PAT`** — fine-grained PAT, owner `hongyime`, all repos, **read-only**: Metadata: Read, Contents: Read, Administration: Read. Stored as a repo secret. Record its expiry date.
3. **Exemptions** — which repos are legitimately exempt from which checks (TDD Q4).
4. **A decision on `identity_clean`** — does SHELL publish a consumable artefact, or does the field stay `null` in v1? (TDD Q3.)

**The agent does not invent the standard.** If a threshold is unspecified, stop and ask.

---

### M4-1 — Standard configuration
**Files:** `config/standard.json`, validation in `scripts/lib/config.ts`
Translate `STANDARD.md` into the declarative registry per TDD §7.3, including `known_default_description` (the sourcerepo placeholder) and the `exempt` map.
**Done when:** every check in `STANDARD.md` maps to exactly one entry, and validation rejects a check id with no corresponding module.

### M4-2 — GitHub client
**Files:** `scripts/lib/github.ts`
Paginated `GET /orgs/hongyime/repos?per_page=100&type=all`; per-repo `community/profile`, `readme`, `contents/{path}`. Serial requests with a small delay (TDD §7.2). Fail loudly and distinctly on 401 vs 403 vs 404.
**Done when:** it returns all ~69 repos, and a deliberately invalid token produces a clear "PAT invalid or expired" error, not a generic failure.

### M4-3 — Check modules
**Files:** `scripts/lib/checks/*.ts` + tests
One module per check id, signature `(repo, params) => { pass, detail? }`. Verify empirically whether `community/profile` covers `SECURITY.md` or a `contents/` call is needed (TDD Q5).
**Done when:** each module has a passing and a failing unit test. **No `detail` string can contain a path, line number, or value from another repo** (TDD §10.4) — assert this in a test.

### M4-4 — Health entry point
**Files:** `scripts/check-health.ts`
Fetch → evaluate → apply exemptions → score → write `health.json` and append one line to `health-history.jsonl` → commit via `withDataBranch`.
**Done when:** run locally against a scratch branch, output validates against `HealthReport`. Running twice on the same UTC day updates rather than duplicates the history line.

### M4-5 — Health workflow
**Files:** `.github/workflows/health.yml`
Daily cron (`0 2 * * *`), same `concurrency: { group: data-branch }`, `HEALTH_PAT` from secrets, `permissions: { contents: write }`.
**Done when:** it runs successfully and does not collide with an uptime run scheduled in the same minute.

### M4-6 — Compliance table
**Files:** `src/components/HealthTable.tsx`, `src/hooks/useHealthData.ts`
Org-wide score, per-repo rows, sortable by score/name, filter to non-compliant, group by failing check. Its own independent staleness check (48h threshold — a daily job, not a 15-minute one).
**Done when:** filtering to non-compliant on a report where every repo passes shows an empty state, not a broken table.

### M4-7 — Compliance trend
**Files:** `src/components/ComplianceTrend.tsx`
Simple line from `health-history.jsonl`. No chart library — an inline SVG polyline.
**Done when:** it renders with 1, 7, and 90 data points without breaking.

---

### 🛑 STOP 5 — Known-answer test and privacy audit

Agent halts. Human verifies, in this order:

1. **Known-answer test (PRD S5).** On a Tuesday, after sourcerepo's Monday sync, `description_is_not_default` should be failing at or near 69/69. Spot-check five repos manually against the report. **If the board disagrees with the manual check, the checker is wrong** — do not rationalise the discrepancy.
2. **Privacy audit (TDD §10.7).** `git grep` the entire `data` branch and the public Actions logs for every identity value. Zero hits required.
3. **Token audit.** Confirm `HEALTH_PAT` has no write permission on anything, and its expiry is recorded in `README.md`.

---

## Backlog — P2, not scheduled

Each needs a line in the PRD before it is built.

- Latency sparkline per target, from raw shards.
- Telegram/Discord webhook on `up → down`, with a 2-consecutive-failure debounce.
- Build-status column from the Vercel API.
- Public JSON endpoint so `theprawnprojects` can show a green dot per project.
- Annual `data` branch squash — document the procedure before it is needed, not during.
- **Auto-filing an issue on a repo when a check regresses.** ⚠️ This crosses from reporting into writing and violates operating rule 5 as currently written. It needs a separate write-scoped token and an explicit PRD amendment. Do not slip it in as a small feature.
