import { expect, test } from '@playwright/test';

test('local iPhone request shows comparison code and approval controls', async ({ page }) => {
  let pending = [{ id: 'test-phone', name: 'iPhone du foyer', code: 'A1B2C3D4' }];
  await page.route('**/api/admin/mobile', (route) => route.fulfill({ json: { devices: [], pending, remoteConfigured: false } }));
  const decisions: boolean[] = [];
  await page.route('**/api/admin/mobile/requests/test-phone', async (route) => {
    decisions.push(route.request().postDataJSON().approve);
    pending = [];
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/admin');
  await page.getByLabel('Mot de passe administrateur').fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await expect(page.getByText('iPhone du foyer — code')).toBeVisible();
  await expect(page.getByText('A1B2C3D4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approuver', exact: true }).click();
  await expect(page.getByText('A1B2C3D4', { exact: true })).toHaveCount(0);
  expect(decisions).toEqual([true]);
  pending = [{ id: 'test-phone', name: 'iPhone inconnu', code: 'DEADBEEF' }];
  await expect(page.getByText('DEADBEEF', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refuser', exact: true }).click();
  await expect(page.getByText('DEADBEEF', { exact: true })).toHaveCount(0);
  expect(decisions).toEqual([true, false]);
});
