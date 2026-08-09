# Technical Design — theprawnstatus

**Repo:** `hongyime/theprawnstatus` (public)
**Companion to:** `docs/PRD.md`
**Status:** Approved — ready to build
**Date:** 2026-08-09

---

## 1. Scope of this document

The PRD says what and why. This says how, and records the decisions that would otherwise get re-litigated at 2am in month four. Where a decision has a real alternative, the alternative and the reason for rejecting it are written down in §11.

---

## 2. Constraints that shape everything

| # | Constraint | Consequence |
|---|---|---|
| C1 | Public repo | Unlimited Actions minutes. Also: every log line and output file is world-readable. Drives §10. |
| C2 | Local dev is Windows 11, PowerShell only, bash broken | No `.sh` files. No bash-only npm scripts. Git plumbing lives in Node, not workflow YAML. |
| C3 | `python`, not `python3` | Irrelevant here — this repo is Node-only. Noted so nobody "helpfully" adds a Python script. |
| C4 | $0 budget, no service that can expire or bill | GitHub + Vercel only. No KV, no Postgres, no hosted cron. |
| C5 | Minimal LLM inference | Every check is deterministic. Zero model calls at runtime. |
| C6 | Read-only against the estate | This repo writes to exactly one place: its own `data` branch. |
| C7 | Target org is `hongyime`, not the personal account `bryanseah234` | `/orgs/hongyime/repos`, and org-scoped fine-grained PAT. |

---

## 3. Stack

**Node 20 + TypeScript everywhere. Vite + React + Tailwind for the site. `tsx` to run scripts. Vitest for tests.**

The deciding argument is not preference, it is the data contract. `shared/types.ts` is imported by the script that *writes* `summary.json` and by the React component that *reads* it. Change the shape in one place and the other fails to compile. A Python collector plus a TypeScript frontend gives you two definitions of the same object and no compiler to keep them honest — and the whole failure mode of a status board is silently rendering stale or misparsed data.

Secondary reasons: `fetch` and `AbortSignal.timeout` are built into Node 20, so the probe has zero dependencies; one `package.json` and one lockfile; and `npm run check:uptime` behaves identically in PowerShell and on `ubuntu-latest`, which matters given C2.

`scan_identity.py` stays in SHELL. It is not vendored here and not called from here (§10).

---

## 4. Repository layout

```
theprawnstatus/                       # branch: main
├─ .github/workflows/
│  ├─ uptime.yml                      # cron */15
│  ├─ health.yml                      # cron daily
│  └─ keepalive.yml                   # cron monthly, no-op commit to main
├─ config/
│  ├─ targets.json                    # the 14 deployments
│  └─ standard.json                   # declarative SHELL checks
├─ scripts/
│  ├─ check-uptime.ts                 # entry: probe + append + update summary
│  ├─ check-health.ts                 # entry: GitHub API + evaluate + write health.json
│  ├─ rebuild-summary.ts              # entry: full recompute from shards (self-heal)
│  └─ lib/
│     ├─ data-branch.ts               # clone / sparse / commit / push-with-retry
│     ├─ probe.ts                     # single-target HTTP probe
│     ├─ summary.ts                   # incremental update + full rebuild + prune
│     ├─ github.ts                    # paginated API client
│     └─ checks/                      # one module per standard check
├─ shared/
│  └─ types.ts                        # THE data contract — imported by scripts and src
├─ src/                               # Vite + React board
├─ public/
│  └─ snapshot.json                   # build-time fallback copy of summary.json
├─ LICENSE                            # Apache-2.0
├─ NOTICE                             # copyright: The Prawn Organisation
├─ SECURITY.md
└─ README.md
```

```
                                      # branch: data (orphan)
├─ summary.json                       # ~60 KB — what the browser loads
├─ health.json                        # ~30 KB — current compliance
├─ health-history.jsonl               # 1 line/day — compliance trend
└─ history/
   ├─ 2026-08-09.jsonl                # ~94 KB/day
   └─ …                               # 90 files, oldest deleted daily
```

**theprawnstatus must itself pass `standard.json`.** The Apache-2.0 LICENSE, the NOTICE naming the organisation, and SECURITY.md are M0 tasks, not later cleanup.

---

## 5. Data architecture

This section contains the two decisions that determine whether the repo is still pleasant in a year.

### 5.1 Orphan `data` branch

A cron writing to `main` every 15 minutes produces ~35,000 commits a year and makes `git log` on the actual code unusable. An orphan branch keeps history separate and can be squashed or force-pushed periodically without touching code history.

Created once:

```
git checkout --orphan data
git rm -rf .
# seed files, commit, push
```

Nothing on `main` ever references it as a submodule. The site reads it over HTTPS (§8), not as a checkout.

### 5.2 Day-sharded history, not one appended file

**This is a correction to the original PRD.** "Append to `history.jsonl` and prune on every run" is the obvious design and it is quietly expensive. Two reasons:

1. **Blob churn.** Git stores a new blob per commit per changed file. A single 8.5 MB `history.jsonl` rewritten 96×/day is ~816 MB of new object data per day before garbage collection. Append-only files delta-compress well — but *pruning* mutates the head of the file, which defeats delta compression exactly when you need it.
2. **Transfer.** Each run would clone, download, and rewrite 8.5 MB to add ~1 KB.

Sharding by UTC day fixes both. Each run touches one ~94 KB file. Pruning is `git rm history/<old>.jsonl` — a deletion, not a rewrite. Cost per run drops from 8.5 MB to ~95 KB.

**`history/YYYY-MM-DD.jsonl`:**

```jsonl
{"t":"2026-08-09T04:15:02Z","id":"smuseats","s":200,"ms":412}
{"t":"2026-08-09T04:15:03Z","id":"dejavista","s":200,"ms":180}
{"t":"2026-08-09T04:15:04Z","id":"swiperboxd","s":502,"ms":3011}
{"t":"2026-08-09T04:15:14Z","id":"someapp","s":null,"ms":10000,"e":"timeout"}
```

Note `s` is nullable. A DNS failure, TLS error, or timeout has no HTTP status, and recording `0` or `500` for those would be a lie that shows up as a real server error on the board. `e` carries the error class (`timeout` | `dns` | `tls` | `conn` | `abort`) and is absent on success.

### 5.3 Pre-aggregated `summary.json`

**Also a correction to the original PRD.** 14 targets × 96 runs/day × 90 days ≈ 8.5 MB. The browser must never fetch that. The strip renders **one bar per day**, so per-ping resolution is thrown away on arrival anyway.

The collector maintains a rollup instead:

```json
{
  "generated_at": "2026-08-09T04:15:00Z",
  "window_days": 90,
  "schema": 1,
  "targets": [
    {
      "id": "smuseats",
      "name": "SMU Eats",
      "url": "https://smuseats.hong-yi.me",
      "current": { "state": "up", "status": 200, "ms": 412, "checked_at": "2026-08-09T04:15:02Z" },
      "uptime_90d": 0.9987,
      "p50_ms": 380,
      "p95_ms": 910,
      "days": [
        { "d": "2026-05-12", "n": 96, "ok": 96, "p50": 372 },
        { "d": "2026-05-13", "n": 94, "ok": 91, "p50": 401 }
      ]
    }
  ]
}
```

14 targets × 90 day-buckets × ~45 bytes ≈ **60 KB raw, under 10 KB gzipped.** That is the entire payload for the board.

**Day-bucket → bar colour:**

| Condition | State | Colour |
|---|---|---|
| `n == 0` | `no-data` | grey |
| `ok / n == 1` | `up` | green |
| `ok / n >= 0.95` | `degraded` | amber |
| `ok / n < 0.95` | `down` | red |

Colour is never the only signal — see §8.4.

### 5.4 Incremental update, daily self-heal

Recomputing `summary.json` from 90 shards on every run would reintroduce the 8.5 MB read. So:

- **Every 15 min:** read `summary.json`, update today's bucket and `current`, drop expired day entries, write back. O(1).
- **Daily (once, after midnight UTC):** `rebuild-summary.ts` recomputes the whole thing from the shards and overwrites. This is the self-healing path — a crashed mid-run or a botched increment gets corrected within 24 hours rather than persisting forever.

Percentiles (`p50_ms`, `p95_ms`) are computed over the full window during the daily rebuild only. The incremental path updates the current day's `p50` from that day's shard, which it already has open. Do not attempt to maintain a rolling percentile incrementally; it is not worth the bug surface.

### 5.5 Efficient checkout

The 15-minute job does not need 90 shards. It needs `summary.json` and today's shard.

```
git clone --depth=1 --filter=blob:none --no-checkout --branch data <url> data-wt
cd data-wt
git sparse-checkout init --no-cone
git sparse-checkout set summary.json history/<today>.jsonl
git checkout data
```

`--filter=blob:none` plus a two-path sparse set brings the per-run transfer to roughly 150 KB. The daily rebuild job skips sparse-checkout and takes the full tree.

All of this lives in `scripts/lib/data-branch.ts` driving `git` via `child_process`, **not** in workflow bash — so it is runnable and debuggable from PowerShell (C2).

### 5.6 Retention

- `history/*.jsonl` — delete shards with a date older than 90 days. Runs once daily, in the rebuild job.
- `summary.json` — bounded by construction at 90 day-buckets per target.
- `health-history.jsonl` — one line per day, ~120 bytes. 365 lines/year. Never pruned; it is the trend record and it is trivially small.
- `data` branch git history — squash annually. A single manual `git checkout --orphan data-new && git push --force` is fine; nothing depends on the branch's commit history.

---

## 6. Uptime collector

### 6.1 Probe

Per target, per run:

- `GET` (not `HEAD` — several static hosts and framework routes handle `HEAD` differently from `GET`, and you want to test what a user hits).
- `AbortSignal.timeout(10_000)`.
- `redirect: 'follow'`, max 5 hops. Record the final status.
- User-Agent: `theprawnstatus/1.0 (+https://github.com/hongyime/theprawnstatus)` — so that if a probe ever misbehaves, the source is identifiable.
- Success = final status matches the target's `expect` (default `200`).
- On failure: retry up to 2 more times with 1s then 3s backoff. **Record only the final attempt** — one line per target per run, no exceptions, or the day-bucket arithmetic breaks.
- Targets are probed with a concurrency cap of 5. Fourteen simultaneous requests from one runner is fine, but the cap keeps latency measurements from contending with each other, which matters because latency is a recorded metric.

Latency is measured on the *final* attempt and is wall-clock time to response headers, not to full body. Vercel cold starts inflate this legitimately; that is signal, not noise, and it is why latency is recorded separately from status (PRD §10).

### 6.2 Workflow

```yaml
# .github/workflows/uptime.yml
on:
  schedule: [{ cron: '*/15 * * * *' }]
  workflow_dispatch:
concurrency:
  group: data-branch
  cancel-in-progress: false
permissions:
  contents: write
```

`concurrency` is shared with `health.yml` under the same group name, which serialises anything that writes to the `data` branch. `cancel-in-progress: false` queues rather than drops — a cancelled uptime run is a data gap.

### 6.3 Cron reality

GitHub's scheduled workflows have a 5-minute minimum and are routinely delayed or skipped under platform load, especially on the hour. Therefore:

- Never assume evenly spaced samples. Every calculation reads real timestamps from the data.
- Uptime is `ok / n` within a day bucket, where `n` is however many samples actually landed. A day with 71 samples is as valid as one with 96 — it is just noisier.
- The board is labelled **"sampled every ~15 min — indicative, not an SLA."** This is not a disclaimer for other people; it is a note to you in eight months about what the number means.
- Cron is offset to `*/15` starting at minute 3 (`3,18,33,48 * * * *`) rather than on the quarter-hour, to avoid the platform's worst contention windows.

### 6.4 Keepalive

Scheduled workflows are disabled automatically after 60 days of repository inactivity. This repo commits to the `data` branch continuously, but it is not documented whether commits to a non-default branch reset that timer. Rather than find out the hard way after a silent two-month outage, `keepalive.yml` makes a monthly no-op commit to `main` (touching a timestamp in a `.keepalive` file). Cost: 12 commits a year on `main`. Cheap insurance.

---

## 7. Health checker

### 7.1 Auth

The `GITHUB_TOKEN` injected into Actions is scoped to the repository it runs in and **cannot read the other 68 repos' settings.** This needs a separate credential.

**Fine-grained PAT**, owner `hongyime`, all repositories, with the minimum that satisfies the checks:

| Permission | Level | Needed for |
|---|---|---|
| Metadata | Read | Baseline; required by everything else |
| Contents | Read | `NOTICE`, `SECURITY.md`, README size |
| Administration | Read | `has_discussions`, `default_branch`, visibility, archived |

Stored as secret `HEALTH_PAT`. **No write permission on anything** (C6). Fine-grained PATs expire — one year maximum. The expiry date goes in `README.md` and the workflow must fail loudly on 401 so it surfaces on the board (PRD G7) rather than freezing `health.json` at its last good value.

### 7.2 API usage

- `GET /orgs/hongyime/repos?per_page=100&type=all` — one page covers 69 repos. Paginate anyway.
- The repo object already carries `description`, `topics`, `license.spdx_id`, `has_discussions`, `default_branch`, `archived`, `visibility` — most checks cost zero extra requests.
- `GET /repos/hongyime/{repo}/community/profile` — one call per repo, covers several community-health files at once. Verify which fields it actually returns against the live response before relying on it; fall back to `GET /repos/…/contents/{path}` for anything it misses.
- `GET /repos/hongyime/{repo}/readme` — returns size without needing the content decoded.
- `NOTICE` — `GET /repos/…/contents/NOTICE`, then decode and confirm it names the organisation rather than a legal name.

Roughly 1 + (69 × 2–3) ≈ **150–210 requests/day** against 5,000/hour. Non-issue. Requests are made serially with a small delay rather than in a burst, because secondary rate limits punish concurrency more than volume.

### 7.3 Declarative checks

`config/standard.json` is the machine-readable projection of SHELL's `STANDARD.md`. Checks are data, not code, so that a change to the standard is a config edit:

```json
{
  "standard_version": "1.0.0",
  "source": "hongyime/sourcerepo → STANDARD.md",
  "known_default_description": "Give me 1 ⭐ if it's cool.",
  "checks": [
    { "id": "license_is_apache_2", "weight": 1, "severity": "high" },
    { "id": "notice_present", "weight": 1, "severity": "high" },
    { "id": "description_is_not_default", "weight": 1, "severity": "medium" },
    { "id": "topics_min_3", "weight": 1, "severity": "low", "params": { "min": 3 } },
    { "id": "readme_min_bytes", "weight": 1, "severity": "medium", "params": { "min": 500 } },
    { "id": "security_policy_present", "weight": 1, "severity": "high" },
    { "id": "discussions_matches", "weight": 1, "severity": "low", "params": { "expected": true } },
    { "id": "default_branch_matches", "weight": 1, "severity": "medium", "params": { "expected": "main" } }
  ],
  "exempt": {
    "some-archived-repo": ["readme_min_bytes", "topics_min_3"]
  }
}
```

Each `id` maps to a module in `scripts/lib/checks/` exporting `(repo, params) => { pass: boolean, detail?: string }`. Adding a check is a new module plus a config line. **`detail` must never contain identity data** (§10).

The `exempt` map exists because a compliance number nobody trusts gets ignored. Archived and deliberately-minimal repos need a documented way out, or you will start ignoring amber rows generally.

### 7.4 Output

`health.json`:

```json
{
  "generated_at": "2026-08-09T02:00:00Z",
  "standard_version": "1.0.0",
  "schema": 1,
  "org_score": 0.71,
  "repos": [
    {
      "name": "sgSchools2020",
      "score": 5, "max": 7,
      "archived": false,
      "identity_clean": null,
      "fail": ["description_is_not_default", "topics_min_3"]
    }
  ]
}
```

`health-history.jsonl`, one line per day:

```jsonl
{"d":"2026-08-09","org_score":0.71,"repos":69,"compliant":22,"by_check":{"description_is_not_default":69,"topics_min_3":31}}
```

This is what makes the sourcerepo Monday sawtooth visible as a trend rather than a thing you have to notice live.

---

## 8. Frontend

### 8.1 Data delivery — the decision

The site fetches at **runtime** from `raw.githubusercontent.com`, with a **build-time snapshot as fallback**.

```
https://raw.githubusercontent.com/hongyime/theprawnstatus/data/summary.json
```

Rejected alternatives are in §11. The short version: build-time-only means the board is stale until you redeploy, and redeploying 96×/day is absurd; a Vercel serverless proxy adds a moving part for a problem that a 5-minute CDN cache does not actually have, given a 15-minute collection interval.

Behaviour:

1. On mount, fetch `summary.json` from raw.githubusercontent.
2. On failure or non-2xx, fall back to `/snapshot.json` — a copy baked in at build time — and show a banner saying the data is a snapshot from *(timestamp)*.
3. Regardless of source, if `generated_at` is more than 45 minutes old, show the staleness banner. **Stale data must not render as green** (PRD G7, S6). This is the single most important behaviour on the page: a status board that lies about being current is worse than no status board.

Verify `Access-Control-Allow-Origin` on raw.githubusercontent during M2 rather than assuming it. If CORS turns out to be a problem, §11 alternative 4 is the fallback and it is a half-day of work, not a redesign.

### 8.2 Rendering

- Vite + React + TypeScript, Tailwind for utility styling.
- Neobrutalist: thick black borders, hard offset shadows with no blur, flat saturated fills, chunky grotesk display type with a monospace face for numbers. Numbers get tabular figures so latency values do not jitter between renders.
- One row per target: name, current-status pill, 90-bar strip, `p50` / uptime %.
- Health table (M4) is a separate section on the same page — sortable by score, filterable to non-compliant, groupable by failing check.
- No client-side router. It is one page.

### 8.3 Performance budget

<1s to interactive on a cold cache (PRD S4). Achievable comfortably: ~10 KB gzipped of data, one round trip to a CDN, no fonts blocking first paint (`font-display: swap`), no chart library — the strip is 90 divs, not a canvas.

### 8.4 Accessibility

The classic status strip is the worst common offender for colour-only encoding.

- Each bar carries an `aria-label` with date, uptime percentage, and state in words.
- State is doubled in a non-colour channel — bar height or fill pattern varies by state, so `up` / `degraded` / `down` / `no-data` are distinguishable in greyscale.
- Status pills contain the word, not just the colour.
- The whole strip is one `role="img"` with a summary label, so a screen reader gets "99.87% uptime over 90 days, 2 incidents" rather than ninety announcements.

---

## 9. Failure modes

| Failure | Detection | Behaviour |
|---|---|---|
| One target down | Probe non-2xx after 3 attempts | Recorded, bar reddens, board shows red pill |
| Runner network flaky | Retries exhausted, `e` set | Recorded as failure; retries make this rare enough to accept |
| Cron skipped by GitHub | Fewer samples in day bucket | Bucket has lower `n`; uptime still valid; no gap unless the run count hits zero |
| Cron dead >45 min | `generated_at` age | Staleness banner. **Not green.** |
| Two workflows push simultaneously | Push rejected | Rebase-retry ×3; distinct file paths make rebase always mergeable |
| `summary.json` corrupted by a half-run | Parse failure or bad arithmetic | Daily rebuild recomputes from shards |
| `HEALTH_PAT` expired | 401 from GitHub API | Workflow fails loudly; `health.json` ages; board shows health section as stale |
| Data branch grows unexpectedly | Manual check | Annual squash; day-sharding makes this unlikely to be needed |
| raw.githubusercontent unreachable | Fetch throws | Snapshot fallback + banner |

---

## 10. Security and privacy

Restating PRD §4 as engineering rules, because this is the one thing in this project that could actually hurt.

1. `$SHELL_IDENTITY` is **never** a secret in this repository. Not for a test run.
2. `scan_identity.py` is **never** invoked here and **never** vendored here.
3. `identity_clean` is a tri-state boolean consumed from an artefact SHELL publishes. `null` means "not checked" and renders as such.
4. No check's `detail` field, no log line, and no file on the `data` branch may contain a matched value, a file path within another repo, or a line number relating to identity data.
5. `HEALTH_PAT` is read-only on every scope. It never appears in a log — set `::add-mask::` on any derived value.
6. Actions logs on a public repo are public. Before M4's first run, confirm the checker logs repo names and check ids only.
7. `git grep` the entire `data` branch for the identity values before the site goes public. This is task M4-8 and it is a STOP gate.

Additionally: `permissions:` is declared explicitly per workflow at the minimum needed. Third-party actions are pinned to a commit SHA, not a tag.

---

## 11. Alternatives considered

**1. Cloudflare KV instead of a git branch.** Rejected. The free tier allows 1,000 writes/day; 96 runs × 14 targets = 1,344 writes/day. It fails on arithmetic before you get to whether it is a good idea. Committing to git is free and unlimited.

**2. Commit data to `main`.** Rejected. ~35,000 commits/year makes `git log` and `git blame` on the actual code unusable, and every code diff drowns in ping noise.

**3. A separate `hongyime/theprawnstatus-data` repo instead of an orphan branch.** Reasonable, and it isolates git history even more cleanly. Rejected because it doubles the setup, needs a cross-repo token where an orphan branch needs none, and splits the project across two places in the org listing for a benefit an annual squash already provides.

**4. Vercel serverless function proxying the data.** Rejected for v1. It would remove the raw.githubusercontent dependency and allow custom cache headers, but it adds a runtime component to a project whose main selling point is having none. Held in reserve if CORS or rate-limiting on raw.githubusercontent turns out to be a real problem (§8.1).

**5. Rebuild and redeploy the Vercel site on every data push.** Rejected. 96 deploys/day, a build queue that is never empty, and a board that is stale by exactly one build duration anyway.

**6. Single appended `history.jsonl` with prune-on-every-run** (the rev-2 design). Rejected on blob churn and transfer cost — see §5.2. This is the one place this document overrules the original PRD.

**7. Fetching raw history in the browser and aggregating client-side.** Rejected. 8.5 MB to render 90 coloured divs per row.

**8. UptimeRobot for the uptime half, build only the health half.** **Not rejected — this is a live option** and it is documented in PRD §12 as a kill criterion. If M4 is where the value is, and M1–M3 turn out to be a slog, taking UptimeRobot's free 50 monitors and building only the compliance reporter is a legitimate and cheaper outcome. Decide this consciously, not by drifting.

---

## 12. Open questions

| # | Question | Blocks | Owner |
|---|---|---|---|
| Q1 | Full list of 14 targets — ids, URLs, display names, any non-200 expected status | M0-4 | You |
| Q2 | `STANDARD.md` contents — the definitive check list and thresholds | M4-1 | You / SHELL |
| Q3 | Does SHELL publish a consumable identity-scan artefact, or does `identity_clean` stay `null` in v1? | M4-4 | You / SHELL |
| Q4 | Which repos are legitimately exempt from which checks? | M4-1 | You |
| Q5 | Does `community/profile` cover `SECURITY.md`, or is a `contents/` call needed? | M4-3 | Verify against live API |
| Q6 | Does CORS on raw.githubusercontent permit browser fetch from the Vercel origin? | M2-3 | Verify in M2 |
| Q7 | Do commits to a non-default branch reset the 60-day scheduled-workflow disable timer? | None — keepalive makes it moot | — |
