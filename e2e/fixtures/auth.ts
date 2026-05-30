import { Page, Locator } from '@playwright/test';

const SMOKE_EMAIL = 'smoke@cohold.app';
const SMOKE_PASSWORD = process.env.SMOKE_TEST_PASSWORD ?? '';

export async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email Address').fill(SMOKE_EMAIL);
  await page.getByLabel('Password').fill(SMOKE_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/dashboard');
}

/**
 * Select an option in the custom Select component.
 * The Select component's label is not associated via htmlFor, so we traverse
 * from the label to its sibling selectContainer div to reach the native <select>.
 */
export async function selectOption(root: Page | Locator, labelText: string, value: string) {
  await root
    .locator('label', { hasText: new RegExp(`^${labelText}$`) })
    .locator('xpath=following-sibling::div//select')
    .selectOption(value);
}
