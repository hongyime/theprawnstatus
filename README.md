# theprawnstatus

One board showing whether the Prawn deployments are running and whether the `hongyime` repos still meet the SHELL standard.

- Product requirements: [docs/prd](docs/prd)
- Technical design: [docs/technicaldesign.md](docs/technicaldesign.md)
- Implementation tasks: [docs/tasks](docs/tasks)

Uptime is sampled every ~15 minutes and is indicative, not an SLA.

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

## Health token

The health checker needs a read-only fine-grained GitHub PAT stored as `HEALTH_PAT`.

Expiry date: `TODO`
