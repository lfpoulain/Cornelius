import { expect, test } from '@playwright/test';
import { origin, screenshots } from './env';
import { withModuleTokens } from './module-tokens';

test('les modules se filtrent par personne, se recherchent et gardent leurs favoris', async ({
  page,
}) => {
  await withModuleTokens(page);
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  // Connexion terminée avant la requête : sinon, lancé seul, le test crée le profil sans cookie.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const result = await page.request.post('/api/admin/profiles', {
    headers: { origin },
    data: { name: 'Profil modules test' },
  });
  const profile = await result.json();
  try {
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await expect(page.getByText('Vision', { exact: true }).first()).toBeVisible();
    await page.getByLabel('Sources de', { exact: true }).selectOption(profile.id);
    await page.getByLabel('Rechercher un module ou une source').fill('météo');
    // Masqué plutôt que retiré : une saisie en cours dans un autre module n’est pas perdue.
    await expect(page.getByText('Île-de-France Mobilités', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Favori : Météo' }).click();
    await page.locator('#module-weather > summary').click();
    await page.getByRole('button', { name: 'Ajouter une source' }).click();
    await expect(page.getByLabel('Propriétaire', { exact: true })).toHaveValue(profile.id);
    await page.reload();
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Favori : Météo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    // Relu jusqu’à stabilisation : juste après le changement de taille, la mise en page
    // mobile peut ne pas être terminée.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: `${screenshots}/admin-modules-mobile.png`, fullPage: true });
  } finally {
    const deleted = await page.request.delete('/api/admin/profiles/' + profile.id, {
      headers: { origin },
    });
    expect(deleted.ok()).toBe(true);
  }
});

test('un jeton manquant est expliqué en tête du module et bloque l’ajout de source', async ({
  page,
}) => {
  await withModuleTokens(page, false);
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  const weather = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('#module-weather') });
  await expect(weather.getByText('Jeton manquant', { exact: true })).toBeVisible();
  await page.locator('#module-weather > summary').click();
  await expect(
    weather.getByText(
      'Ce module a besoin d’un jeton Météo Concept (gratuit). Collez-le ici : il est pris en compte tout de suite (ou ajoutez CORNELIUS_METEO_CONCEPT_TOKEN dans le fichier .env).',
    ),
  ).toBeVisible();
  await expect(weather.getByRole('link', { name: /api\.meteo-concept\.com/ })).toHaveAttribute(
    'href',
    'https://api.meteo-concept.com/',
  );
  const add = weather.getByRole('button', { name: 'Ajouter une source' });
  await expect(add).toBeDisabled();
  await expect(add).toHaveAccessibleDescription(/une fois le jeton ajouté/);
  // Transports : le même mot, « jeton », dans le badge et dans l’explication.
  const transit = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('#module-transit') });
  await expect(transit.getByText('Jeton manquant', { exact: true })).toBeVisible();
  await page.locator('#module-transit > summary').click();
  await expect(
    transit.getByText(
      'Ce module a besoin d’un jeton PRIM d’Île-de-France Mobilités (gratuit). Collez-le ici : il est pris en compte tout de suite (ou ajoutez CORNELIUS_PRIM_API_KEY dans le fichier .env).',
    ),
  ).toBeVisible();
  await expect(transit).not.toContainText(/clé/i);
  // L’heure n’a besoin d’aucun jeton.
  const clock = page.locator('[data-slot="card"]').filter({ has: page.locator('#module-clock') });
  await expect(clock.getByText('Jeton manquant', { exact: true })).toHaveCount(0);
});

test('un réglage invalide est signalé sous son champ, en français, sans rien enregistrer', async ({
  page,
}) => {
  await withModuleTokens(page);
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  let created = 0;
  await page.route('**/api/admin/addons/instances', async (route) => {
    if (route.request().method() === 'POST') created++;
    await route.fallback();
  });
  await page.locator('#module-weather > summary').click();
  const weather = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('#module-weather') });
  await weather.getByRole('button', { name: 'Ajouter une source' }).click();
  await weather.getByLabel('Nom affiché').fill('Météo test');
  const insee = weather.getByLabel('Code INSEE');
  await insee.fill('75');
  await weather.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(weather.getByText('Format invalide.', { exact: true })).toBeVisible();
  await expect(insee).toHaveAttribute('aria-invalid', 'true');
  await expect(insee).toHaveAccessibleDescription(/Format invalide\./);
  await expect(insee).toBeFocused();
  expect(created).toBe(0);
  // Corriger le champ efface son erreur.
  await insee.fill('75056');
  await expect(weather.getByText('Format invalide.', { exact: true })).toHaveCount(0);
  await expect(insee).not.toHaveAttribute('aria-invalid', 'true');
});

test('une source sans identifiant reçoit celui de son nom et la page dit quoi prononcer', async ({
  page,
}) => {
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  const response = await page.request.post('/api/admin/addons/instances', {
    headers: { origin },
    data: {
      addonId: 'clock',
      profileId: null,
      ref: null,
      label: 'Atelier e2e',
      config: { timeZone: 'Europe/Paris', showDate: true, showSeconds: false },
    },
  });
  expect(response.status()).toBe(201);
  const instance = await response.json();
  try {
    expect(instance.ref).toBe('atelier-e2e');
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-clock > summary').click();
    const row = page.locator('.rounded-lg.border.p-4').filter({ hasText: 'Atelier e2e' });
    // Les mots du nom affiché, avec sa majuscule : « Atelier », pas « atelier ».
    await expect(row.getByText('« l’heure d’Atelier e2e »', { exact: true })).toBeVisible();
    await row
      .getByRole('button', { name: 'Configurer la source Atelier e2e', exact: true })
      .click();
    await expect(
      row.getByText('Pour l’obtenir à la voix, dites : « l’heure d’Atelier e2e ».', {
        exact: true,
      }),
    ).toBeVisible();
    // L’identifiant est rangé sous « Options », replié, son résumé visible.
    const identifier = row.getByLabel('Identifiant', { exact: true });
    await expect(identifier).toBeHidden();
    const options = row.locator('summary').filter({ hasText: 'Options' });
    await expect(options).toContainText('identifiant atelier-e2e · le foyer');
    await options.click();
    await expect(identifier).toHaveValue('atelier-e2e');
  } finally {
    await page.request.delete('/api/admin/addons/instances/' + instance.id, {
      headers: { origin },
    });
  }
});

test('un module refusé au démarrage est nommé en bas de la page, avec la raison', async ({
  page,
}) => {
  await page.route('**/api/admin/addons', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const catalog = await response.json();
    catalog.rejected = [
      {
        name: 'parking',
        reason:
          'schéma de configuration invalide : data/properties/x/type must be equal to one of the allowed values.',
      },
    ];
    await route.fulfill({ response, json: catalog });
  });
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  const note = page.getByRole('note', { name: 'Module non chargé' });
  await expect(note).toBeVisible();
  await expect(note).toContainText('parking : schéma de configuration invalide');
});

test('les modules sont rangés en trois groupes et se trouvent sans accents, mot par mot', async ({
  page,
}) => {
  await withModuleTokens(page);
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  const daily = page.getByRole('region', { name: 'Au quotidien' });
  const home = page.getByRole('region', { name: 'Maison' });
  const capabilities = page.getByRole('region', { name: 'Capacités de Cornelius' });
  for (const id of ['clock', 'weather', 'transit'])
    await expect(daily.locator(`#module-${id}`)).toHaveCount(1);
  await expect(home.locator('#module-commands')).toHaveCount(1);
  await expect(capabilities.locator('#module-vision')).toHaveCount(1);
  // Le titre de chaque panneau est un h3, dans son résumé.
  const titles = await daily
    .locator('summary')
    .getByRole('heading', { level: 3 })
    .allTextContents();
  expect(titles).toEqual(['Heure', 'Météo', 'Transports', 'Ragator', 'Alarmes et rappels']);
  await page.screenshot({ path: `${screenshots}/admin-modules-groups.png`, fullPage: true });

  const search = page.getByLabel('Rechercher un module ou une source');
  await search.fill('bus');
  await expect(daily.locator('#module-transit')).toBeVisible();
  await expect(daily.locator('#module-weather')).toBeHidden();
  await expect(home).toBeHidden();
  await expect(capabilities).toBeHidden();
  await search.fill('METEO');
  await expect(daily.locator('#module-weather')).toBeVisible();
  await search.fill('meteo portail');
  await expect(page.getByText('Aucun module ne correspond à « meteo portail ».')).toBeVisible();
  await search.fill('');

  // Les commandes se gèrent dans leur propre module, dans la même liste.
  await home.locator('#module-commands > summary').click();
  await expect(home.getByRole('button', { name: 'Nouvelle commande' })).toBeVisible();
});

test('formulaire de source : champs du module d’abord, interrupteurs et liste de fuseaux', async ({
  page,
}) => {
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await page.locator('#module-clock > summary').click();
  await page.getByRole('button', { name: 'Ajouter une source' }).click();
  const form = page.locator('#module-clock form');
  const zone = form.getByLabel('Fuseau horaire');
  await expect(zone).toBeFocused();
  await expect(zone).toHaveValue('Europe/Paris');
  await expect(zone.locator('optgroup[label="Europe"] option[value="Europe/Paris"]')).toHaveText(
    'Paris',
  );
  await zone.selectOption('America/New_York');
  await expect(form.getByRole('switch', { name: 'Afficher la date' })).toBeChecked();
  await expect(form.getByRole('switch', { name: 'Afficher les secondes' })).not.toBeChecked();
  // Ordre : réglages du module, puis nom, puis options repliées.
  const order = await form.evaluate((element) =>
    [...element.querySelectorAll('label')].map((label) => label.textContent?.trim()),
  );
  expect(order.indexOf('Fuseau horaire')).toBeLessThan(order.indexOf('Nom affiché'));
  await expect(form.getByLabel('Propriétaire', { exact: true })).toBeHidden();
  await expect(form.locator('summary').filter({ hasText: 'Options' })).toContainText('le foyer');
  await page.screenshot({ path: `${screenshots}/admin-modules-clock-form.png`, fullPage: true });
});

test('formulaire de source : listes déroulantes, choix facultatif et liste répétée', async ({
  page,
}) => {
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  // Module externe d'essai (tests/e2e/modules) : rangé dans « Maison » par son display.
  const home = page.getByRole('region', { name: 'Maison' });
  await home.locator('#module-formulaire > summary').click();
  await home.getByRole('button', { name: 'Ajouter une source' }).click();
  const form = page.locator('#module-formulaire form');

  const jour = form.getByRole('combobox', { name: 'Jour', exact: true });
  await expect(jour.locator('option')).toHaveText(['Lundi', 'Mardi']);
  await jour.selectOption('mardi');
  const carburant = form.getByRole('combobox', { name: 'Carburant', exact: true });
  await expect(carburant).toHaveValue('');
  await expect(carburant.locator('option')).toHaveText(['Tous', 'Gazole', 'SP98']);
  await carburant.selectOption('sp98');

  const bacs = form.getByRole('group', { name: 'Bacs' });
  await expect(bacs.getByRole('textbox', { name: 'Jours' })).toHaveValue('lundi');
  await expect(bacs.getByRole('button', { name: 'Retirer la ligne 1' })).toBeDisabled();
  await bacs.getByRole('button', { name: 'Ajouter' }).click();
  await bacs.getByRole('combobox', { name: 'Bac' }).nth(1).selectOption('emballages');
  await form.getByLabel('Nom affiché').fill('Essai du formulaire');
  // Deuxième ligne sans jours : l'erreur du serveur s'affiche sous sa cellule.
  await form.getByRole('button', { name: 'Ajouter', exact: true }).last().click();
  await expect(bacs.getByText('Champ obligatoire.')).toBeVisible();
  await bacs.getByRole('textbox', { name: 'Jours' }).nth(1).fill('mercredi semaines paires');
  await expect(bacs.getByText('Champ obligatoire.')).toBeHidden();
  await bacs.getByRole('button', { name: 'Ajouter' }).click();
  await expect(bacs.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
  await bacs.getByRole('button', { name: 'Retirer la ligne 3' }).click();
  await page.screenshot({ path: `${screenshots}/admin-modules-list-form.png`, fullPage: true });
  await form.getByRole('button', { name: 'Ajouter', exact: true }).last().click();
  await expect(page.locator('#module-formulaire form')).toHaveCount(0);

  const catalog = await (await page.request.get('/api/admin/addons')).json();
  const saved = catalog.instances.find(
    (instance: { addonId: string }) => instance.addonId === 'formulaire',
  );
  expect(saved.config).toEqual({
    jour: 'mardi',
    carburant: 'sp98',
    bacs: [
      { bac: 'verre', jours: 'lundi' },
      { bac: 'emballages', jours: 'mercredi semaines paires' },
    ],
  });
  await page.request.delete(`/api/admin/addons/instances/${saved.id}`, { headers: { origin } });
});
