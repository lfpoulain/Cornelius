import { expect, test } from '@playwright/test';
import { login, screenshots } from './env';

test('les délais se règlent en secondes, persistent et restent modifiables après une erreur', async ({
  page,
}) => {
  await login(page, '/admin#voice');
  // Les délais vivent dans le repli « Réglages avancés », fermé par défaut : une carte dont les
  // valeurs se règlent dans « Réglage fin », comme partout ailleurs.
  const advanced = page.locator('summary').filter({ hasText: 'Réglages avancés' });
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { level: 4, name: 'Délais de présence' }) });
  const summary = card.locator('summary').filter({ hasText: 'Réglage fin' });
  const accordion = summary.locator('..');
  await expect(advanced.locator('..')).not.toHaveAttribute('open');
  await advanced.click();
  await expect(accordion).not.toHaveAttribute('open');
  await summary.click();
  const departure = page.getByLabel('Confirmer un départ (s)', { exact: true });
  const gaze = page.getByLabel('Terminer après la perte du regard (s)', { exact: true });
  const identity = page.getByLabel('Garder l’identité sans nouvelle preuve (s)', { exact: true });
  // Barre commune « Enregistrer / Annuler », affichée seulement quand une valeur a changé.
  const bar = page.getByRole('region', {
    name: 'Délais de présence : modifications non enregistrées',
  });
  const save = bar.getByRole('button', { name: 'Enregistrer', exact: true });
  // Séparateur décimal à la française, clavier décimal sur téléphone.
  await expect(departure).toHaveValue('1,5');
  await expect(departure).toHaveAttribute('inputmode', 'decimal');
  await expect(bar).toHaveCount(0);
  await departure.fill('31');
  await expect(save).toBeDisabled();
  await expect(bar).toContainText('hors limites');
  await departure.fill('');
  await expect(save).toBeDisabled();
  // Revenir à la valeur enregistrée efface la barre, avec le point comme avec la virgule.
  await departure.fill('1.5');
  await expect(bar).toHaveCount(0);
  await expect(identity).toHaveValue('8');
  await departure.fill('4,5');
  await gaze.fill('12');
  await identity.fill('5');
  await save.click();
  await expect(page.getByText('Délais de présence enregistrés.', { exact: true })).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(accordion.locator('summary')).toContainText('Départ : 4,5 s');
  await expect(accordion.locator('summary')).toContainText('Identité : 5 s');
  await page.reload();
  await advanced.click();
  await summary.click();
  await expect(departure).toHaveValue('4,5');
  await expect(gaze).toHaveValue('12');
  await expect(identity).toHaveValue('5');
  await page.route(
    '**/api/admin/presence-timings',
    (route) =>
      route.fulfill({ status: 500, json: { error: 'Enregistrement indisponible (test).' } }),
    { times: 1 },
  );
  await departure.fill('6');
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Enregistrement indisponible (test).');
  await expect(departure).toHaveValue('6');
  await expect(accordion.locator('summary')).toContainText('Départ : 4,5 s');
  await save.click();
  await expect(accordion.locator('summary')).toContainText('Départ : 6 s');
  await page.screenshot({ path: `${screenshots}/admin-presence-timings.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(departure).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Valeurs par défaut' }).click();
  await expect(departure).toHaveValue('1,5');
  await expect(gaze).toHaveValue('8');
  await expect(identity).toHaveValue('8');
  await save.click();
  await expect(accordion.locator('summary')).toContainText('Départ : 1,5 s');
});
