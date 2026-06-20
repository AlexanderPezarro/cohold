import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.STAGING_URL ?? 'http://localhost:3000';

// When tunnelling to the staging container over plain HTTP, Express won't set
// Secure session cookies because req.secure is false. Trust proxy is already
// enabled (trust proxy: 1), so forwarding X-Forwarded-Proto: https makes
// express-session emit Set-Cookie for the HTTP connection.
const extraHTTPHeaders = baseURL.startsWith('http://')
  ? { 'X-Forwarded-Proto': 'https' }
  : {};

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    extraHTTPHeaders,
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
