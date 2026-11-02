import { test, expect } from '@playwright/test';
import { origin, screenshots } from './env';

test('un minuteur créé dans l’administration sonne sur le miroir puis s’arrête', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-alarms > summary').click();
  await page.getByRole('button', { name: 'Minuteur', exact: true }).click();
  await page.getByLabel('Durée (minutes)').fill('0,1');
  await page.getByLabel('Nom (facultatif)').fill('pâtes');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/alarms') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const view = await (await created).json();
  const timer = view.alarms.find((alarm: { label: string }) => alarm.label === 'pâtes');
  expect(timer?.kind).toBe('timer');
  try {
    await page.goto('/');
    const ringing = page.getByRole('alert', { name: 'Ce qui sonne' });
    await expect(ringing).toContainText('Minuteur', { timeout: 15_000 });
    await expect(ringing).toContainText('pâtes');
    await page.screenshot({ path: `${screenshots}/alarme-miroir.png` });
    const stopped = await page.request.post(`/api/admin/alarms/${timer.id}/stop`, {
      headers: { origin },
      data: {},
    });
    expect(stopped.ok()).toBe(true);
    await expect(ringing).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/admin/alarms/${timer.id}`, { headers: { origin } });
  }
  expect(errors).toEqual([]);
});
