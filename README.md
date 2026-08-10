# theprawnstatus

One board showing whether the Prawn deployments are running and whether the `hongyime` repos still meet the SHELL standard.

- Product requirements: [docs/prd](docs/prd)
- Technical design: [docs/technicaldesign.md](docs/technicaldesign.md)
- Implementation tasks: [docs/tasks](docs/tasks)

Uptime is sampled every ~15 minutes and is indicative, not an SLA.

Live deployment: <https://theprawnstatus.vercel.app>

## Local development

```powershell
npm install
npm test
npm run lint
npm run dev
```

## Adding a target

Add one entry to `config/targets.json`:

```json
{
  "id": "example-app",
  "name": "Example App",
  "url": "https://example-app.hong-yi.me",
  "expect": 200
}
```

`id` must be lowercase letters, numbers, and hyphens only. `expect` defaults to `200`.

The initial target list was derived by probing public `*.hong-yi.me` project subdomains. If a production deployment moves, update only `config/targets.json`.

## Data branch

Generated status data lives on the orphan `data` branch:

- `summary.json`: browser payload for the uptime board
- `history/YYYY-MM-DD.jsonl`: raw daily probe samples
- `health.json`: current repository compliance report
- `health-history.jsonl`: daily compliance trend

Do not merge `data` into `main`.

## Health token

The health checker needs a read-only fine-grained GitHub PAT stored as `HEALTH_PAT`.

Expiry date: none provided.

Required permissions: Metadata read, Contents read, Administration read, scoped to `hongyime` repositories.

## Performance

Current production build payload:

- JavaScript: 64.73 KB gzip
- CSS: 3.32 KB gzip

Budget: under 1 second to interactive on a cold cache.
