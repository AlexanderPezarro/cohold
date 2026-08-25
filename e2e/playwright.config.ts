import { defineConfig, devices } from '@playwright/test';

// SMOKE_BASE_URL is what CI sets now that the suite runs against a container on
// the runner. STAGING_URL is kept as a fallback for pointing the suite at a
// deployed environment by hand.
const baseURL = process.env.SMOKE_BASE_URL ?? process.env.STAGING_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
