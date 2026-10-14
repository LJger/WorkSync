import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 35_000,
  expect: { timeout: 8000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npx tsx tests/e2e/server.ts', url: 'http://127.0.0.1:4173/api/health', reuseExistingServer: false, timeout: 60_000 },
});
