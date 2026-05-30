import { test, expect } from '@playwright/test';
import { login, selectOption } from '../fixtures/auth';

const run = Date.now();
const PROPERTY_NAME = `Smoke Property ${run}`;
const TENANT_FIRST = 'Smoke';
const TENANT_LAST = `Tenant ${run}`;
const TENANT_EMAIL = `smoke.tenant.${run}@test.invalid`;
const TRANSACTION_DESC = `Smoke Rent ${run}`;

test('smoke: login → property → tenant → lease → transaction → cleanup', async ({ page }) => {
  // ── 1. Login ──────────────────────────────────────────────────────────────
  await login(page);
  await expect(page).toHaveURL(/\/dashboard/);

  // ── 2. Create property ────────────────────────────────────────────────────
  await page.goto('/properties');
  await page.getByRole('button', { name: 'Add Property' }).click();

  const propDialog = page.getByRole('dialog');
  await propDialog.getByLabel('Property Name').fill(PROPERTY_NAME);
  await propDialog.getByLabel('Street Address').fill('1 Smoke Street');
  await propDialog.getByLabel('City').fill('Smokebury');
  await propDialog.getByLabel('County').fill('Testshire');
  await propDialog.getByLabel('Postcode').fill('SM1 1AA');
  await propDialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText(PROPERTY_NAME)).toBeVisible();

  // ── 3. Create tenant ──────────────────────────────────────────────────────
  await page.goto('/tenants');
  await page.getByRole('button', { name: 'Add Tenant' }).click();

  const tenantDialog = page.getByRole('dialog');
  await tenantDialog.getByLabel('First Name').fill(TENANT_FIRST);
  await tenantDialog.getByLabel('Last Name').fill(TENANT_LAST);
  await tenantDialog.getByLabel('Email').fill(TENANT_EMAIL);
  await tenantDialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText(`${TENANT_FIRST} ${TENANT_LAST}`)).toBeVisible();

  // ── 4. Create lease ───────────────────────────────────────────────────────
  await page.goto('/leases');
  await page.getByRole('button', { name: 'Add Lease' }).click();

  const leaseDialog = page.getByRole('dialog');
  await leaseDialog.locator('select[name="propertyId"]').selectOption({ label: PROPERTY_NAME });
  await leaseDialog
    .locator('select[name="tenantId"]')
    .selectOption({ label: new RegExp(`${TENANT_FIRST} ${TENANT_LAST}`) });

  const startDateInput = leaseDialog.getByLabel('Start Date');
  await startDateInput.click();
  await startDateInput.fill('01/06/2026');
  await page.keyboard.press('Escape');

  await leaseDialog.getByLabel('Monthly Rent').fill('1000');
  await leaseDialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText(PROPERTY_NAME)).toBeVisible();

  // ── 5. Create transaction ─────────────────────────────────────────────────
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'New Transaction' }).click();

  const txDialog = page.getByRole('dialog');
  await txDialog
    .locator('select[name="property-selector"]')
    .selectOption({ label: new RegExp(PROPERTY_NAME) });
  await selectOption(txDialog, 'Transaction Type', 'Income');
  await selectOption(txDialog, 'Category', 'Rent');
  await txDialog.getByLabel('Amount').fill('1000');
  await txDialog.getByLabel('Transaction Date').fill('2026-06-01');
  await txDialog.getByLabel('Description').fill(TRANSACTION_DESC);
  await txDialog.getByRole('button', { name: 'Create Transaction' }).click();

  await expect(page.getByText(TRANSACTION_DESC)).toBeVisible();

  // ── Cleanup (reverse order) ───────────────────────────────────────────────

  // Delete transaction
  try {
    await page.goto('/transactions');
    await page
      .locator('tr', { hasText: TRANSACTION_DESC })
      .getByRole('button', { name: 'Delete transaction' })
      .click();
    await page.getByRole('button', { name: 'Confirm' }).click();
  } catch (e) {
    console.warn('Cleanup: failed to delete transaction', e);
  }

  // Delete lease
  try {
    await page.goto('/leases');
    await page
      .locator('tr', { hasText: PROPERTY_NAME })
      .getByRole('button', { name: 'Delete lease' })
      .click();
    await page.getByRole('button', { name: 'Confirm' }).click();
  } catch (e) {
    console.warn('Cleanup: failed to delete lease', e);
  }

  // Delete tenant — open edit dialog via card click → Delete → Permanently Delete
  try {
    await page.goto('/tenants');
    await page.getByText(`${TENANT_FIRST} ${TENANT_LAST}`).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Permanently Delete' }).click();
  } catch (e) {
    console.warn('Cleanup: failed to delete tenant', e);
  }

  // Delete property — find the card by name, click its delete button
  try {
    await page.goto('/properties');
    await page
      .getByText(PROPERTY_NAME)
      .locator('xpath=ancestor::div[contains(@class, "propertyCard")]')
      .getByRole('button', { name: 'Delete property' })
      .click();
    await page.getByRole('button', { name: 'Permanently Delete' }).click();
  } catch (e) {
    console.warn('Cleanup: failed to delete property', e);
  }
});
