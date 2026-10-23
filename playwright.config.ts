import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { ...(process.env.CI ? {} : { channel: 'chrome' }), baseURL: 'http://localhost:5240', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5240', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(process.env.CI ? {} : { channel: 'chrome' }) } },
    { name: 'phone', use: { ...devices['Pixel 7'], ...(process.env.CI ? {} : { channel: 'chrome' }) } },
  ],
});
