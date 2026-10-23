import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/admin#start');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
}

test('un jeton de module se saisit dans Mise en route, compte aussitôt et s’efface', async ({
  page,
}) => {
  await login(page);
  const card = page.locator('#secrets');
  await expect(card.getByRole('heading', { name: 'Clés et jetons' })).toBeVisible();
  const providers = card.getByRole('region', { name: 'Fournisseurs IA' });
  const modules = card.getByRole('region', { name: 'Modules' });
  await expect(providers.getByRole('heading', { name: 'Clé OpenAI' })).toBeVisible();
  await expect(modules.getByRole('heading', { name: 'Jeton Météo Concept' })).toBeVisible();
  await expect(
    modules.getByRole('heading', { name: 'Jeton PRIM d’Île-de-France Mobilités' }),
  ).toBeVisible();
  const field = modules.getByLabel('Jeton Météo Concept', { exact: true });
  await field.fill('meteo-e2e-token-0123456789wxyz');
  try {
    await field
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: 'Enregistrer' })
      .click();
    await expect(card.getByText('Dans l’administration (se termine par wxyz)')).toBeVisible();
    // La valeur ne revient jamais dans la page.
    await expect(page.locator('body')).not.toContainText('meteo-e2e-token');

    // Le module Météo n’affiche plus le jeton manquant, sans redémarrage.
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    const weather = page
      .locator('[data-slot="card"]')
      .filter({ has: page.locator('#module-weather') });
    await expect(weather.getByText('Jeton manquant', { exact: true })).toHaveCount(0);
  } finally {
    await page.request.delete('/api/admin/secrets/CORNELIUS_METEO_CONCEPT_TOKEN', {
      headers: { origin: new URL(page.url()).origin },
    });
  }
});

for (const width of [390, 1440]) {
  test(`les cartes et le formulaire du module restent accessibles à ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    const cards = page.locator('#secrets article');
    await expect(cards.first()).toBeVisible();
    for (const card of await cards.all()) {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    await page.goto('/admin#modules');
    await page.locator('#module-weather > summary').click();
    const weather = page
      .locator('[data-slot="card"]')
      .filter({ has: page.locator('#module-weather') });
    const field = weather.getByLabel('Jeton Météo Concept', { exact: true });
    await field.fill('meteo-inline-test-0123456789');
    await field
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: 'Enregistrer' })
      .click();
    try {
      await expect(weather.getByText('Jeton manquant', { exact: true })).toHaveCount(0);
    } finally {
      await page.request.delete('/api/admin/secrets/CORNELIUS_METEO_CONCEPT_TOKEN', {
        headers: { origin: new URL(page.url()).origin },
      });
    }
  });
}
