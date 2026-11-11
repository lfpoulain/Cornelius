import { expect, test } from '@playwright/test';
import { login, origin } from './env';
import { withModuleTokens } from './module-tokens';

const created: string[] = [];
test.afterEach(async ({ page }) => {
  for (const path of created.splice(0)) {
    const response = await page.request.delete(path, {
      headers: { origin },
    });
    expect(response.ok()).toBe(true);
  }
});

test('une source créée désactivée le reste après actualisation', async ({ page }) => {
  await withModuleTokens(page);
  await login(page);
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-weather > summary').click();
  await page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText('Météo Concept', { exact: true }) })
    .getByRole('button', { name: 'Ajouter une source' })
    .click();
  await page.getByLabel('Nom affiché').fill('Météo désactivée audit');
  // Identifiant, propriétaire et état sont rangés sous « Options ».
  await page.locator('form summary').filter({ hasText: 'Options' }).click();
  await page.getByLabel('Identifiant', { exact: true }).fill('meteo-audit');
  await page.getByLabel('Code INSEE').fill('75056');
  await page.getByLabel('État', { exact: true }).selectOption('false');
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/addons/instances') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const response = await posted;
  const instance = await response.json();
  if (instance.id) created.push(`/api/admin/addons/instances/${instance.id}`);
  expect(response.status()).toBe(201);
  expect(instance.enabled).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-weather > summary').click();
  await expect(page.getByText('Météo désactivée audit', { exact: true })).toBeVisible();
  await expect(
    page.locator('#module-weather [data-slot="badge"]').filter({ hasText: /^Désactivée$/ }),
  ).toBeVisible();
});

test('une action créée désactivée respecte le choix enregistré', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-commands > summary').click();
  await page.getByRole('button', { name: 'Nouvelle commande' }).click();
  await page.getByLabel('Nom affiché').fill('Action désactivée audit');
  await page.getByLabel('Identifiant', { exact: true }).fill('action-audit');
  await page.getByLabel('Adresse (http ou https)').fill(`${origin}/api/health`);
  await page.getByLabel('État', { exact: true }).selectOption('false');
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/actions') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const response = await posted;
  const action = await response.json();
  if (action.id) created.push(`/api/admin/actions/${action.id}`);
  expect(response.status()).toBe(201);
  expect(action.enabled).toBe(false);
  await expect(page.getByText('Action désactivée audit', { exact: true })).toBeVisible();
});

test('changer un arrêt efface sa direction et les résultats liés à l’ancien arrêt', async ({
  page,
}) => {
  await withModuleTokens(page);
  await page.route('**/api/admin/addons/transit/search', async (route) => {
    const { kind, query } = route.request().postDataJSON();
    await route.fulfill({
      json: {
        results:
          kind === 'place'
            ? [{ id: `stop_area:${query}`, label: `Arrêt ${query}` }]
            : [{ id: 'route:audit', label: 'Direction audit' }],
      },
    });
  });
  await login(page);
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-transit > summary').click();
  await page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText('Île-de-France Mobilités', { exact: true }) })
    .getByRole('button', { name: 'Ajouter une source' })
    .click();
  await page.getByLabel('Nom affiché').fill('Bus audit');
  await page.getByLabel('Arrêt', { exact: true }).fill('A');
  await page.getByRole('button', { name: 'Chercher', exact: true }).first().click();
  await page.getByRole('button', { name: 'Arrêt A', exact: true }).click();
  await page.getByRole('button', { name: 'Chercher', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Direction audit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ajouter', exact: true })).toBeEnabled();
  await page.getByLabel('Arrêt', { exact: true }).fill('B');
  await page.getByRole('button', { name: 'Chercher', exact: true }).first().click();
  await page.getByRole('button', { name: 'Arrêt B', exact: true }).click();
  await expect(page.getByText('Direction audit', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ajouter', exact: true })).toBeEnabled();
});
