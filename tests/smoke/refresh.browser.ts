import { test, expect, type Page } from '@playwright/test';

const now = new Date('2026-09-13T02:00:00.000Z');
const summary = (name = 'Fixture deployment', date = now.toISOString()) => ({
  generated_at: date,
  window_days: 90,
  schema: 1,
  targets: [
    {
      id: 'fixture',
      name,
      url: 'https://example.invalid/',
      current: { state: 'up', status: 200, ms: 125, checked_at: date },
      uptime_90d: 1,
      p50_ms: 125,
      p95_ms: 250,
      days: [{ d: '2026-09-13', n: 20, ok: 20, p50: 125 }],
    },
  ],
});
const health = (name = 'fixture-repo', date = now.toISOString()) => ({
  generated_at: date,
  standard_version: '1.0.0',
  schema: 1,
  org_score: 0.5,
  repos: [{ name, score: 5, max: 10, archived: false, identity_clean: true, fail: ['readme'] }],
});

async function fixture(page: Page) {
  const calls: string[] = [],
    errors: string[] = [],
    unexpected: string[] = [];
  const mode = {
    failLive: false,
    failSnapshots: false,
    stallPrimary: false,
    stallAll: false,
    failSupabase: false,
  };
  await page.clock.install({ time: new Date(now.getTime() - 1000) });
  await page.clock.pauseAt(now);
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    Object.defineProperty(window, 'setFixtureHidden', {
      value: (value: boolean) => {
        hidden = value;
        document.dispatchEvent(new Event('visibilitychange'));
      },
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const supabase = path.startsWith('/rest/v1/');
    const snapshot = ['/snapshot.json', '/health-snapshot.json'].includes(path);
    const git = url.hostname === 'raw.githubusercontent.com';
    if (supabase || snapshot || git) {
      calls.push(path.split('/').at(-1)!);
      const statusRequest =
        path.endsWith('/status_runs') ||
        path.endsWith('/summary.json') ||
        path === '/snapshot.json';
      if (statusRequest && (mode.stallAll || (mode.stallPrimary && supabase))) return;
      if (
        (snapshot && mode.failSnapshots) ||
        (!snapshot && mode.failLive) ||
        (supabase && mode.failSupabase)
      ) {
        await route.fulfill({ status: 503, body: 'synthetic unavailable' });
        return;
      }
      if (path.endsWith('/status_runs')) {
        await route.fulfill({ json: [{ summary: summary() }] });
        return;
      }
      if (path.endsWith('/health_runs')) {
        const count = Number(url.searchParams.get('limit') ?? '1');
        const rows = Array.from({ length: Math.min(count, 30) }, (_, index) => ({
          report: health('fixture-repo', new Date(now.getTime() - index * 86400000).toISOString()),
        }));
        await route.fulfill({ json: rows });
        return;
      }
      if (path.endsWith('/health_history')) {
        await route.fulfill({ json: [] });
        return;
      }
      if (path.endsWith('/health-history.jsonl')) {
        await route.fulfill({ body: '' });
        return;
      }
      if (path.endsWith('/summary.json')) {
        await route.fulfill({ json: summary('Git fixture deployment') });
        return;
      }
      if (path.endsWith('/health.json')) {
        await route.fulfill({ json: health('git-fixture-repo') });
        return;
      }
      const date = new Date(now.getTime() - 30 * 86400000).toISOString();
      await route.fulfill({
        json:
          path === '/snapshot.json'
            ? summary('Older snapshot deployment', date)
            : health('older-snapshot-repo', date),
      });
      return;
    }
    const appOrigin = new URL(process.env.STATUS_BROWSER_URL ?? 'http://127.0.0.1:4483').origin;
    if (url.hostname === 'fonts.googleapis.com') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (url.origin === appOrigin && request.method() === 'GET') {
      await route.continue();
      return;
    }
    unexpected.push(url.origin + path);
    await route.fulfill({ status: 204, body: '' });
  });
  const hidden = (value: boolean) =>
    page.evaluate((hidden) => {
      (window as unknown as { setFixtureHidden: (value: boolean) => void }).setFixtureHidden(
        hidden,
      );
    }, value);
  const ready = async () => {
    await expect(page.getByText('Fixture deployment', { exact: true })).toBeVisible();
    await expect(page.getByText('fixture-repo', { exact: true })).toBeVisible();
  };
  const healthy = async () => {
    await page.goto('/');
    await ready();
  };
  const verify = async () => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  };
  return { calls, mode, hidden, ready, healthy, verify };
}

test.afterEach(async ({ page }, testInfo) => {
  // DOM evidence avoids screenshot/trace teardown waiting on simulated time.
  await page.clock.resume();
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('failure-page', { body: await page.content(), contentType: 'text/html' });
  }
});

test('uses one health query for the current report and trend, without unused history', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.healthy();
  console.log('Initial snapshot reads:', JSON.stringify(f.calls));
  expect(f.calls.filter((path) => path === 'status_runs')).toHaveLength(1);
  expect(f.calls.filter((path) => path === 'health_runs')).toHaveLength(1);
  expect(f.calls).not.toContain('health_history');
  await expect(
    page.getByRole('img', { name: 'fixture-repo standards trend with 14 samples.' }),
  ).toBeVisible();
  await f.verify();
});

test('brief tab switches preserve due times and hidden tabs do not poll', async ({ page }) => {
  const f = await fixture(page);
  await f.healthy();
  await page.clock.runFor(10000);
  await f.hidden(true);
  await page.clock.runFor(10000);
  await f.hidden(false);
  await page.clock.runFor(1000);
  expect(f.calls).toHaveLength(2);
  await f.hidden(true);
  await page.clock.runFor(900000);
  expect(f.calls).toHaveLength(2);
  await f.hidden(false);
  await expect.poll(() => f.calls.length).toBe(4);
  await f.verify();
});

test('a stalled primary read times out and falls back without reloading', async ({ page }) => {
  const f = await fixture(page);
  f.mode.stallPrimary = true;
  await page.goto('/');
  await expect.poll(() => f.calls.includes('status_runs')).toBe(true);
  await page.clock.runFor(8001);
  await expect(page.getByText('Git fixture deployment', { exact: true })).toBeVisible();
  expect(f.calls).not.toContain('snapshot.json');
  await f.verify();
});

test('returning after a long absence marks old data stale before a slow refresh finishes', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.healthy();
  await f.hidden(true);
  await page.clock.runFor(21 * 60000);
  f.mode.stallAll = true;
  await f.hidden(false);
  await expect.poll(() => f.calls.filter((path) => path === 'status_runs').length).toBe(2);
  await expect(
    page.getByText('Status data is stale. Current state is not green.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Fixture deployment', { exact: true })).toBeVisible();
  await f.verify();
});

test('the entire status fallback chain ends within twenty seconds', async ({ page }) => {
  const f = await fixture(page);
  f.mode.stallAll = true;
  await page.goto('/');
  await expect.poll(() => f.calls.includes('status_runs')).toBe(true);
  await page.clock.runFor(8001);
  await expect.poll(() => f.calls.includes('summary.json')).toBe(true);
  await page.clock.runFor(8001);
  await expect.poll(() => f.calls.includes('snapshot.json')).toBe(true);
  await page.clock.runFor(3999);
  await expect(page.getByText('Status data failed to load.', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading status data', { exact: true })).toHaveCount(0);
  await f.verify();
});

test('failed refreshes retain newer status and health data instead of old snapshots', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.healthy();
  f.mode.failLive = true;
  await page.clock.runFor(120000);
  await expect(
    page.getByText('Status refresh failed; showing the last loaded data.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Fixture deployment', { exact: true })).toBeVisible();
  await expect(page.getByText('Older snapshot deployment', { exact: true })).toHaveCount(0);
  await page.clock.runFor(780000);
  await expect(
    page.getByText('Health refresh failed; showing the last loaded data.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('fixture-repo', { exact: true })).toBeVisible();
  await expect(page.getByText('older-snapshot-repo', { exact: true })).toHaveCount(0);
  await f.verify();
});

test('last loaded data survives total source failure and becomes stale', async ({ page }) => {
  const f = await fixture(page);
  await f.healthy();
  f.mode.failLive = f.mode.failSnapshots = true;
  await page.clock.runFor(120000);
  await expect(
    page.getByText('Status refresh failed; showing the last loaded data.', { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(240000);
  await expect(page.getByText('Fixture deployment', { exact: true })).toBeVisible();
  // Move beyond the freshness limit and let the bounded retry update freshness.
  await page.clock.runFor(25 * 60000);
  await expect(
    page.getByText('Status data is stale. Current state is not green.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Fixture deployment', { exact: true })).toBeVisible();
  await f.verify();
});

test('Git fallback omits unused health history and retains its visible report', async ({
  page,
}) => {
  const f = await fixture(page);
  f.mode.failSupabase = true;
  await page.goto('/');
  await expect(page.getByText('git-fixture-repo', { exact: true })).toBeVisible();
  expect(f.calls).not.toContain('health-history.jsonl');
  expect(f.calls.filter((path) => path === 'health.json')).toHaveLength(1);
  await f.verify();
});

test('initial snapshot fallback recovers on the existing backoff schedule', async ({ page }) => {
  const f = await fixture(page);
  f.mode.failLive = true;
  await page.goto('/');
  await expect(page.getByText('Older snapshot deployment', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Live status data unavailable; showing the build snapshot.', { exact: true }),
  ).toBeVisible();
  f.mode.failLive = false;
  await page.clock.runFor(240000);
  await expect(page.getByText('Fixture deployment', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Live status data unavailable; showing the build snapshot.', { exact: true }),
  ).toHaveCount(0);
  await f.verify();
});
