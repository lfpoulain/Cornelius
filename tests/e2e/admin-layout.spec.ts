import { expect, test, type Page } from '@playwright/test';
import { origin, screenshots } from './env';

async function login(page: Page, path = '/admin') {
  await page.goto(path);
  await expect(page).toHaveTitle('Connexion · Cornelius');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
}

/**
 * Ouvre une rubrique : bande de rubriques sur ordinateur, sélecteur « Rubrique : … » sous
 * 760 px, avec des zones tactiles d’au moins 44 px.
 */
async function open(page: Page, section: string) {
  const navigation = page.getByRole('navigation', { name: 'Sections d’administration' });
  if (page.viewportSize()!.width > 760) {
    const button = navigation.getByRole('button', { name: section, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    return;
  }
  const picker = navigation.getByRole('button', { name: /^Rubrique :/ });
  expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await picker.click();
  const item = page.getByRole('menuitem', { name: section, exact: true });
  expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await item.click();
  await expect(picker).toHaveText(`Rubrique : ${section}`);
}

test('les rubriques et l’en-tête restent utilisables sur ordinateur et mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  const missing: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() === 404) missing.push(new URL(response.url()).pathname);
  });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Mise en route', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Mise en route · Administration Cornelius');
  await page.screenshot({ path: `${screenshots}/admin-redesign-desktop.png`, fullPage: true });
  // Les six groupes, dans l’ordre de la barre latérale.
  await expect(
    page
      .getByRole('navigation', { name: 'Sections d’administration' })
      .locator('.admin-nav-group > .admin-eyebrow'),
  ).toHaveText([
    'Pour commencer',
    'Conversation',
    'Les personnes',
    'Ce qu’il sait faire',
    'Le miroir',
    'Diagnostic',
  ]);
  const sections = [
    'Mise en route',
    'Clés et accès',
    'Quand il écoute',
    'Voix et modèles',
    'Le foyer et les visages',
    'Modules',
    'Installer des modules',
    'Micro et haut-parleurs',
    'Caméra et reconnaissance',
    'Orbe et écran de veille',
    'État du système',
    'Journal',
  ];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const section of sections) {
      await open(page, section);
      const heading = page.getByRole('heading', { level: 1, name: section, exact: true });
      await expect(heading).toBeVisible();
      await expect(page).toHaveTitle(`${section} · Administration Cornelius`);
      await expect(page.locator('.admin-settings')).toBeVisible();
      if (section === 'Modules') {
        // Le focus passe au titre de la rubrique ouverte.
        await expect(heading).toBeFocused();
        // Une seule liste : les commandes HTTP sont un module comme les autres.
        await expect(page.getByRole('group', { name: 'Types de modules' })).toHaveCount(0);
        await expect(
          page.getByPlaceholder('Heure, web, vision, météo, arrêt de bus…'),
        ).toBeVisible();
        await page.locator('#module-commands > summary').click();
        await expect(page.getByRole('button', { name: 'Nouvelle commande' })).toBeVisible();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'Quand il écoute');
  await page.screenshot({ path: `${screenshots}/admin-redesign-mobile.png`, fullPage: true });
  await expect(page.getByRole('link', { name: 'Voir le miroir' })).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByLabel('Mot de passe administrateur')).toBeVisible();
  await expect(page).toHaveTitle('Connexion · Cornelius');
  await page.screenshot({ path: `${screenshots}/admin-redesign-login.png`, fullPage: true });
  const mirror = page.getByRole('link', { name: 'Accéder au miroir', exact: true });
  await expect(mirror).toHaveText('Accéder au miroir →');
  await mirror.click();
  await expect(page.getByRole('main', { name: 'Miroir Cornelius' })).toBeVisible();
  await expect(page).toHaveTitle('Cornelius');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  const favicon = await page.request.get('/favicon.svg');
  expect(favicon.ok()).toBe(true);
  expect(favicon.headers()['content-type']).toContain('image/svg+xml');
  expect(missing).not.toContain('/favicon.ico');
  expect(errors).toEqual([]);
});

test('quitter l’administration demande confirmation s’il reste une saisie, pas ouvrir le miroir', async ({
  page,
}) => {
  await login(page, '/admin#modules/commandes');
  await page.getByRole('button', { name: 'Nouvelle commande' }).click();
  await page.getByLabel('Nom affiché').fill('Brouillon non enregistré');
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  // Le miroir s’ouvre dans sa fenêtre : l’administration reste là, sans question.
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Voir le miroir' }).click();
  const mirror = await popup;
  await expect(mirror).toHaveURL(/\/$/);
  await expect(mirror.getByRole('main', { name: 'Miroir Cornelius' })).toBeVisible();
  // Un second clic ramène la même fenêtre, sans en ouvrir une autre.
  let second = false;
  page.context().on('page', () => (second = true));
  await page.getByRole('link', { name: 'Voir le miroir' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  expect(dialogs).toHaveLength(1);
  expect(second).toBe(false);
  await expect(page.getByLabel('Nom affiché')).toHaveValue('Brouillon non enregistré');
  await expect(page).toHaveURL(/\/admin#modules\/commandes$/);
  await mirror.close();
});

test('« Pour qui ? » : le même choix de la personne en tête des quatre rubriques personnelles', async ({
  page,
}) => {
  await login(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const created = await page.request.post('/api/admin/profiles', {
    headers: { origin },
    data: { name: 'Camille pour qui' },
  });
  const profile = (await created.json()) as { id: string };
  try {
    await page.reload();
    for (const [section, label] of [
      ['Personnaliser Cornelius', 'Personnaliser pour'],
      ['Modules', 'Sources de'],
      ['Agents', 'Agent de'],
      ['Mémoire', 'Souvenirs de'],
    ] as const) {
      await open(page, section);
      const picker = page.locator('[data-person-picker]');
      await expect(picker).toHaveCount(1);
      await expect(picker.getByRole('heading', { level: 2 })).toHaveText('Pour qui ?');
      // Le libellé dit ce qui change avec la personne et nomme la liste.
      await expect(picker.getByRole('combobox', { name: label, exact: true })).toBeVisible();
      await expect(
        picker.getByRole('option', { name: 'Camille pour qui', exact: true }),
      ).toBeAttached();
    }
  } finally {
    await page.request.delete('/api/admin/profiles/' + profile.id, { headers: { origin } });
  }
});
