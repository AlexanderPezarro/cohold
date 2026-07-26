import { test, expect, type Locator } from '@playwright/test';
import { login, selectOption } from '../fixtures/auth';

const run = Date.now();
const PROPERTY_NAME = `Smoke Property ${run}`;
const TENANT_FIRST = 'Smoke';
const TENANT_LAST = `Tenant ${run}`;
const TENANT_EMAIL = `smoke.tenant.${run}@test.invalid`;
const TRANSACTION_DESC = `Smoke Rent ${run}`;

// Option labels include extra info ("Name - Street, City" / "First Last - email"),
// so find the matching value by substring and select by value.
const selectByText = async (root: Locator, name: string, text: string) => {
  const sel = root.locator(`select[name="${name}"]`);
  await sel.locator('option:not([value=""])').first().waitFor({ state: 'attached' });
  const val = await sel.evaluate(
    (el: HTMLSelectElement, t: string) =>
      Array.from(el.options).find(o => o.text.includes(t))?.value ?? '',
    text,
  );
  await sel.selectOption(val);
};

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

  await expect(propDialog).not.toBeVisible();
  await expect(page.getByText(PROPERTY_NAME).first()).toBeVisible();

  // ── 3. Create tenant ──────────────────────────────────────────────────────
  await page.goto('/tenants');
  await page.getByRole('button', { name: 'Add Tenant' }).click();

  const tenantDialog = page.getByRole('dialog');
  await tenantDialog.getByLabel('First Name').fill(TENANT_FIRST);
  await tenantDialog.getByLabel('Last Name').fill(TENANT_LAST);
  await tenantDialog.getByLabel('Email').fill(TENANT_EMAIL);
  await tenantDialog.getByLabel('Phone', { exact: true }).fill('07700 900000');
  await tenantDialog.getByRole('button', { name: 'Create' }).click();

  await expect(tenantDialog).not.toBeVisible();
  await expect(page.getByText(`${TENANT_FIRST} ${TENANT_LAST}`).first()).toBeVisible();

  // ── 4. Create lease ───────────────────────────────────────────────────────
  await page.goto('/leases');
  await page.getByRole('button', { name: 'Add Lease' }).click();

  const leaseDialog = page.getByRole('dialog');
  await selectByText(leaseDialog, 'propertyId', PROPERTY_NAME);
  await selectByText(leaseDialog, 'tenantId', `${TENANT_FIRST} ${TENANT_LAST}`);

  const startDateInput = leaseDialog.getByLabel('Start Date');
  await startDateInput.click();
  await startDateInput.fill('01/06/2026');
  await page.keyboard.press('Tab'); // Tab away from datepicker; Escape would close the dialog

  await leaseDialog.getByLabel('Monthly Rent').fill('1000');
  await leaseDialog.getByLabel('Security Deposit', { exact: true }).fill('1000');
  await leaseDialog.getByRole('button', { name: 'Create' }).click();

  await expect(leaseDialog).not.toBeVisible();
  // Scoped to the lease card's <h3>, not getByText: the property filter
  // dropdown above the card grid also has an <option> with this text, and
  // it renders first in DOM order — getByText(...).first() would match that
  // hidden option instead of the visible card.
  await expect(page.locator('h3', { hasText: PROPERTY_NAME })).toBeVisible();

  // ── 5. Create transaction ─────────────────────────────────────────────────
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'New Transaction' }).click();

  const txDialog = page.getByRole('dialog');
  await selectByText(txDialog, 'property-selector', PROPERTY_NAME);
  await selectOption(txDialog, 'Transaction Type', 'Income');
  await selectOption(txDialog, 'Category', 'Rent');
  await txDialog.getByLabel('Amount').fill('1000');
  await txDialog.getByLabel('Transaction Date').fill('2026-06-01');
  await txDialog.getByLabel('Description').fill(TRANSACTION_DESC);
  await txDialog.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(txDialog).not.toBeVisible();
  // The transaction table has no Description column (Date/Property/Type/
  // Category/Amount/Actions only), and the description text isn't rendered
  // anywhere else — key off the property name in the row instead. Scoped to
  // `tr` because the page's Property filter dropdown also has an <option>
  // with this text.
  await expect(page.locator('tr', { hasText: PROPERTY_NAME })).toBeVisible();

  // ── Cleanup (reverse order) ───────────────────────────────────────────────

  // Delete transaction
  try {
    await page.goto('/transactions');
    await page
      .locator('tr', { hasText: PROPERTY_NAME })
      .getByRole('button', { name: 'Delete transaction' })
      .click();
    await page.getByRole('button', { name: 'Confirm' }).click();
  } catch (e) {
    console.warn('Cleanup: failed to delete transaction', e);
  }

  // Delete lease — leases render as cards, not table rows; find the card by
  // its property name and click its delete button
  try {
    await page.goto('/leases');
    await page
      .locator('h3', { hasText: PROPERTY_NAME })
      .locator('xpath=ancestor::div[contains(@class, "leaseCard")]')
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
      .first()
      .locator('xpath=ancestor::div[contains(@class, "propertyCard")]')
      .getByRole('button', { name: 'Delete property' })
      .click();
    await page.getByRole('button', { name: 'Permanently Delete' }).click();
  } catch (e) {
    console.warn('Cleanup: failed to delete property', e);
  }
});
