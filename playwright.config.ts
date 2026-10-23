import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...(process.env.CI ? {} : { channel: 'chrome' }),
    baseURL: 'http://localhost:5240',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5240', reuseExistingServer: true },
  projects: [
    {
      name: 'desktop',
      testMatch: /solo-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...(process.env.CI ? {} : { channel: 'chrome' }) },
    },
    {
      name: 'shared',
      testMatch: /shared-.*.spec.ts/,
      use: { ...devices['Desktop Chrome'], ...(process.env.CI ? {} : { channel: 'chrome' }) },
    },
    {
      name: 'phone',
      testMatch: /solo-.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], ...(process.env.CI ? {} : { channel: 'chrome' }) },
    },
  ],
});
