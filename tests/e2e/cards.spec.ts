import { expect, test } from '@playwright/test';
import { login, origin } from './env';

test('le module Cartes règle le nombre de cartes, leur durée et leur taille', async ({ page }) => {
  await login(page, '/admin');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  try {
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    const summary = page.locator('#module-cards > summary');
    await expect(summary).toContainText('3 cartes · 1 minute');
    await summary.click();
    await page.getByLabel('Cartes à l’écran').selectOption('2');
    await expect(summary).toContainText('2 cartes · 1 minute');
    await page.getByLabel('Disparition après').selectOption('300000');
    await expect(summary).toContainText('2 cartes · 5 minutes');
    const compact = page.getByRole('switch', { name: 'Raccourcir les cartes au second plan' });
    await expect(compact).toBeChecked();
    await compact.click();
    await expect(compact).not.toBeChecked();
    await page.getByLabel('Cartes à l’écran').selectOption('1');
    await expect(compact).toBeDisabled();
    await page.reload();
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await expect(page.locator('#module-cards > summary')).toContainText('1 carte · 5 minutes');
  } finally {
    await page.request.patch('/api/admin/cards', {
      headers: { origin },
      data: { maxCards: 3, compactSecondary: true, lifetimeMs: 60_000 },
    });
  }
});
