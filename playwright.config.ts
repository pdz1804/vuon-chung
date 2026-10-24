import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

// The garden is WebGL. CI runners have no GPU, so CI Chromium renders with the
// SwiftShader software rasteriser; locally we use the installed Chrome.
const browser = CI
  ? { launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } }
  : { channel: 'chrome' };

export default defineConfig({
  testDir: 'tests/e2e',
  // Software WebGL is slow: give CI more time and one worker so tests don't fight for CPU.
  timeout: CI ? 120_000 : 60_000,
  workers: CI ? 1 : undefined,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5240', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5240', reuseExistingServer: true },
  projects: [
    { name: 'desktop', testMatch: /solo-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], ...browser } },
    { name: 'shared', testMatch: /shared-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], ...browser } },
    { name: 'phone', testMatch: /solo-.*\.spec\.ts/, use: { ...devices['Pixel 7'], ...browser } },
  ],
});
