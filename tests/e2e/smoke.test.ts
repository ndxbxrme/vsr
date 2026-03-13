import { expect, test } from '@playwright/test';

test('playwright is configured', async () => {
  expect(true).toBe(true);
});

test('google oauth flow redirects back into the explorer', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue with Google' }).click();

  await expect(page).toHaveURL(/\/explorer$/);
  await expect(page.getByRole('heading', { name: 'Property read model validation' })).toBeVisible();
  await expect(page.getByLabel('Bearer token')).not.toHaveValue('');
});

test('pilot readiness view is reachable from the home page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Open Pilot Readiness' }).click();

  await expect(page).toHaveURL(/\/pilot-readiness$/);
  await expect(page.getByRole('heading', { name: 'Pilot operations' })).toBeVisible();
  await expect(page.getByLabel('Tenant ID')).toBeVisible();
});
