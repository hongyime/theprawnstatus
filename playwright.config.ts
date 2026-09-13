import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '**/*.browser.ts',
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: process.env.STATUS_BROWSER_URL ?? 'http://127.0.0.1:4483',
    channel: process.env.STATUS_USE_SYSTEM_CHROME ? 'chrome' : undefined,
    screenshot: 'off',
    trace: 'off',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 900 } } },
    { name: 'narrow', use: { viewport: { width: 320, height: 900 } } },
  ],
  webServer: process.env.STATUS_BROWSER_URL
    ? undefined
    : {
        command:
          'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4483 --strictPort',
        url: 'http://127.0.0.1:4483',
        reuseExistingServer: false,
        timeout: 30000,
      },
});
