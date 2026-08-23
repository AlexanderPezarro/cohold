#!/usr/bin/env node
/**
 * Capture the screenshots used in README.md.
 *
 * Prerequisites: a seeded database and a running server.
 *
 *   npx prisma migrate deploy
 *   npm run db:seed
 *   npm run build
 *   npm start &
 *   node scripts/screenshots.mjs
 *
 * Override the target with BASE_URL, and the credentials with
 * SCREENSHOT_EMAIL / SCREENSHOT_PASSWORD (defaults match prisma/seed.ts).
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SCREENSHOT_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.SCREENSHOT_PASSWORD ?? 'admin123';
const OUT_DIR = path.resolve('docs/screenshots');

// Paths must match client/src/router.tsx.
const PAGES = [
  { name: 'dashboard', url: '/dashboard' },
  { name: 'properties', url: '/properties' },
  { name: 'transactions', url: '/transactions' },
  { name: 'tenants', url: '/tenants' },
  { name: 'leases', url: '/leases' },
  { name: 'events', url: '/events' },
  { name: 'reports', url: '/finances/reports' },
  // /documents is deliberately omitted: the seed creates no documents, so it
  // only ever renders the empty state.
];

await mkdir(OUT_DIR, { recursive: true });

// CHROMIUM_PATH allows using an already-downloaded browser when
// `npx playwright install` cannot run (e.g. an unsupported OS build).
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();

console.log(`Signing in to ${BASE_URL} as ${EMAIL}`);
await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
await page.getByLabel('Email Address').fill(EMAIL);
await page.getByLabel('Password').fill(PASSWORD);
await page.getByRole('button', { name: 'Sign In' }).click();
await page.waitForURL('**/dashboard', { timeout: 30_000 });
console.log('Signed in.');

const failures = [];

for (const { name, url } of PAGES) {
  try {
    await page.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle' });
    // Let charts and any entry animations settle before capturing.
    await page.waitForTimeout(1500);

    // Guard against silently capturing the 404 or the login page, which would
    // otherwise look like a successful capture.
    const body = await page.locator('body').innerText();
    if (/Page Not Found/i.test(body)) {
      throw new Error(`route ${url} rendered the 404 page — check client/src/router.tsx`);
    }
    if (/Sign In/i.test(body) && !/Logout/i.test(body)) {
      throw new Error(`route ${url} bounced to the login page — session was lost`);
    }

    const file = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  captured ${name}.png`);
  } catch (error) {
    console.error(`  FAILED ${name}: ${error.message}`);
    failures.push(name);
  }
}

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} page(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`\nDone. Screenshots written to ${OUT_DIR}`);
