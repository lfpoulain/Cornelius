import { test, expect } from '@playwright/test';
import { login, origin } from './env';

test('l’écran Actions enregistre une commande HTTP et teste sa destination', async ({ page }) => {
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-commands > summary').click();
  await expect(page.getByRole('button', { name: 'Nouvelle commande' })).toBeVisible();

  await page.getByRole('button', { name: 'Nouvelle commande' }).click();
  await page.getByLabel('Nom affiché').fill('Santé serveur');
  await page.getByLabel('Identifiant', { exact: true }).fill('sante');
  await page.getByLabel('Adresse (http ou https)').fill(`${origin}/api/health`);
  await page.getByLabel('Confirmation').selectOption('none');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Santé serveur')).toBeVisible();

  await page.getByRole('button', { name: 'Tester' }).click();
  await expect(page.getByText(/Destination joignable/)).toBeVisible();
});

test('l’identifiant se tape librement, suit le nom puis signale un doublon', async ({ page }) => {
  await login(page, '/admin');
  await expect(page.getByRole('button', { name: 'Modules', exact: true })).toBeVisible();
  const existing = await page.request.post('/api/admin/actions', {
    headers: { origin },
    data: {
      ref: 'portail-test',
      label: 'Portail existant',
      method: 'GET',
      url: `${origin}/api/health`,
      profileId: null,
      headers: {},
      body: null,
      confirmation: 'required',
    },
  });
  expect(existing.status()).toBe(201);
  const created = await existing.json();
  try {
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-commands > summary').click();
    await page.getByRole('button', { name: 'Nouvelle commande' }).click();
    const name = page.getByLabel('Nom affiché');
    const identifier = page.getByLabel('Identifiant', { exact: true });
    // Tant qu’il n’est pas modifié, l’identifiant suit le nom, accents retirés.
    await name.fill('Entrée principale');
    await expect(identifier).toHaveValue('entree-principale');
    // Bogue d’origine : le tiret et l’espace disparaissaient à la frappe, « entrée » perdait son é.
    await identifier.fill('');
    await identifier.pressSequentially('porte-');
    await expect(identifier).toHaveValue('porte-');
    await identifier.pressSequentially('garage entrée');
    await expect(identifier).toHaveValue('porte-garage-entrée');
    await identifier.blur();
    await expect(identifier).toHaveValue('porte-garage-entree');
    // Modifié à la main, il ne suit plus le nom.
    await name.fill('Autre nom');
    await expect(identifier).toHaveValue('porte-garage-entree');
    await identifier.fill('portail-test');
    await expect(
      page.getByText('Identifiant déjà utilisé par « Portail existant ».'),
    ).toBeVisible();
    await expect(identifier).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Ajouter', exact: true })).toBeDisabled();
  } finally {
    await page.request.delete('/api/admin/actions/' + created.id, { headers: { origin } });
  }
});

test('une commande à valider apparaît seule, se compte sur le module et se refuse', async ({
  page,
}) => {
  await login(page, '/admin');
  const response = await page.request.post('/api/admin/actions', {
    headers: { origin },
    data: {
      ref: 'portail-validation',
      label: 'Portail à valider',
      method: 'POST',
      url: `${origin}/api/health`,
      profileId: null,
      headers: {},
      body: '{}',
      confirmation: 'required',
    },
  });
  expect(response.status()).toBe(201);
  const action = await response.json();
  // La demande naît d’une conversation : la page doit la voir sans être actualisée.
  let waiting: unknown[] = [];
  const rejected: string[] = [];
  await page.route('**/api/admin/actions/confirmations', (route) =>
    route.fulfill({ json: waiting }),
  );
  await page.route('**/api/admin/actions/confirmations/*/reject', async (route) => {
    rejected.push(route.request().url());
    waiting = [];
    await route.fulfill({ json: { ok: true } });
  });
  try {
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-commands > summary').click();
    await expect(page.getByRole('button', { name: 'Nouvelle commande' })).toBeVisible();
    await expect(page.getByText('Commandes à valider')).toHaveCount(0);
    waiting = [
      {
        id: 'demande-test',
        actionId: action.id,
        profileId: null,
        interactionId: 'conversation-test',
        approvedAt: null,
        expiresAt: Date.now() + 120_000,
      },
    ];
    const card = page
      .locator('.admin-module-content [data-slot="card"]')
      .filter({ hasText: 'Commandes à valider' });
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText(`POST ${origin}/api/health`, { exact: true })).toBeVisible();
    await expect(page.locator('#module-commands > summary')).toContainText('1 à valider');
    await card.getByRole('button', { name: 'Refuser', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('#module-commands > summary')).not.toContainText('à valider');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('/api/admin/actions/confirmations/demande-test/reject');
  } finally {
    await page.request.delete('/api/admin/actions/' + action.id, { headers: { origin } });
  }
});

test('options avancées : un nom d’en-tête invalide bloque l’envoi, un secret absent est expliqué', async ({
  page,
}) => {
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-commands > summary').click();
  await page.getByRole('button', { name: 'Nouvelle commande' }).click();
  await page.getByLabel('Nom affiché').fill('Volet e2e');
  await page.getByLabel('Adresse (http ou https)').fill(`${origin}/api/health`);
  // Méthode, en-têtes et corps sont repliés sous « Options avancées ».
  await expect(page.getByLabel('Méthode', { exact: true })).toBeHidden();
  const advanced = page.locator('form summary').filter({ hasText: 'Options avancées' });
  await expect(advanced).toContainText('GET');
  await advanced.click();
  await page.getByLabel('Méthode', { exact: true }).selectOption('POST');
  await expect(page.getByLabel('Corps de la requête')).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un en-tête' }).click();
  const name = page.getByLabel('Nom d’en-tête 1');
  await name.fill('Mon en-tête');
  await expect(
    page.getByText('Nom invalide : lettres, chiffres et tirets, sans espace ni accent.'),
  ).toBeVisible();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const add = page.getByRole('button', { name: 'Ajouter', exact: true });
  await expect(add).toBeDisabled();
  await name.fill('Authorization');
  await page.getByLabel('Valeur d’en-tête 1').fill('Bearer ${secret:E2E_ABSENT}');
  await expect(add).toBeEnabled();
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/actions') && response.request().method() === 'POST',
  );
  await add.click();
  const action = await (await posted).json();
  try {
    expect(action.missingSecrets).toEqual(['E2E_ABSENT']);
    const row = page.locator('.rounded-lg.border.p-4').filter({ hasText: 'Volet e2e' });
    await expect(row.getByRole('note')).toContainText(
      'Un secret manque : ajoutez CORNELIUS_SECRET_E2E_ABSENT dans le fichier .env puis redémarrez Cornelius.',
    );
    await row.getByRole('button', { name: 'Tester la commande Volet e2e', exact: true }).click();
    await expect(row.getByText('Secret « E2E_ABSENT » introuvable.')).toBeVisible();
  } finally {
    await page.request.delete('/api/admin/actions/' + action.id, { headers: { origin } });
  }
});
