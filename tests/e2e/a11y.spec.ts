import { expect, test, type Page } from '@playwright/test';
import { adminPassword, origin } from './env';

async function login(page: Page, path = '/admin') {
  await page.goto(path);
  await page.getByLabel('Mot de passe administrateur').fill(adminPassword);
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await expect(page.locator('.admin-settings')).toBeVisible();
}

test('cartes et panneaux dépliables portent de vrais titres, sous le titre de rubrique', async ({
  page,
}) => {
  await login(page, '/admin#voice');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Ouverture de la conversation' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Réglages avancés' })).toBeVisible();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Modules' })).toBeVisible();
  const web = page.getByRole('heading', { level: 3, name: 'Web', exact: true });
  await expect(web).toBeVisible();
  // Le titre reste dans le résumé : un clic dessus ouvre toujours le panneau.
  await web.click();
  await expect(page.locator('details#module-web')).toHaveAttribute('open', '');
});

test('une confirmation de suppression prend le focus, s’annule avec Échap et le rend', async ({
  page,
}) => {
  await login(page);
  const created = await page.request.post('/api/admin/actions', {
    headers: { origin },
    data: {
      ref: 'confirmation_test',
      label: 'Confirmation test',
      description: '',
      method: 'GET',
      url: `${origin}/api/health`,
      profileId: null,
      headers: {},
      body: null,
      confirmation: 'none',
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto('/admin#modules/commandes');
  await page.reload();
  const remove = page.getByRole('button', { name: /^Supprimer/ }).first();
  await expect(page.getByText('Confirmation test', { exact: true })).toBeVisible();

  await remove.click();
  const dialog = page.getByRole('alertdialog', { name: /Supprimer « Confirmation test »/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  // Entrée réflexe : c’est « Annuler » qui part.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();

  await remove.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();

  await remove.click();
  await dialog.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByText('Commande supprimée.')).toBeVisible();
  await expect(page.getByText('Confirmation test', { exact: true })).toHaveCount(0);
});

test('boutons désactivés neutres, bords lisibles et largeur des champs respectée', async ({
  page,
}) => {
  await login(page, '/admin#modules/commandes');
  // Sans clé OpenAI, « Démarrer la session » est désactivé : fond neutre, sans transparence
  // ni dégradé, pour ne pas ressembler à un choix sélectionné.
  const start = page.getByRole('button', { name: 'Démarrer la session' });
  await expect(start).toBeDisabled();
  const disabled = await start.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      opacity: style.opacity,
      image: style.backgroundImage,
      background: style.backgroundColor,
    };
  });
  expect(disabled).toEqual({ opacity: '1', image: 'none', background: 'rgb(27, 37, 36)' });

  const tokens = await page.locator('.admin-shell').evaluate((element) => {
    const style = getComputedStyle(element);
    return ['--input', '--warning', '--success'].map((name) => style.getPropertyValue(name).trim());
  });
  expect(tokens).toEqual(['#687a75', '#e8bc88', '#93e0cd']);

  await page.getByRole('button', { name: 'Nouvelle commande' }).click();
  // Les en-têtes sont repliés sous « Options avancées ».
  await page.locator('form summary').filter({ hasText: 'Options avancées' }).click();
  await page.getByRole('button', { name: 'Ajouter un en-tête' }).click();
  // L’enveloppe (sm:w-56) l’emporte sur la règle générale des champs (max-width: 100 %).
  const key = page.getByLabel('Nom d’en-tête 1');
  expect((await key.boundingBox())!.width).toBeLessThanOrEqual(224);
});

test('en bas de page, le dernier bouton reste au-dessus de la zone des messages', async ({
  page,
}) => {
  await login(page, '/admin#voice');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const section of ['voice', 'modules/commandes']) {
      await page.goto('/admin#' + section);
      await expect(page.locator('.admin-settings')).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Écran défilé jusqu’en bas : place restante sous le contrôle le plus bas.
      const room = await page.evaluate(() => {
        // checkVisibility écarte aussi le contenu d’un panneau replié.
        const bottoms = [...document.querySelectorAll('.admin-settings :is(button, summary, a)')]
          .filter((control) => control.checkVisibility({ visibilityProperty: true }))
          .map((control) => control.getBoundingClientRect().bottom + window.scrollY);
        return document.documentElement.scrollHeight - Math.max(...bottoms);
      });
      // Un message de trois lignes, ou deux messages courts empilés : environ 150 px au-dessus
      // du bord de l’écran (un peu plus de 100 px avant la marge réservée).
      expect(room, `${section} à ${width} px`).toBeGreaterThanOrEqual(150);
    }
  }
});

test('le lien « Aller aux réglages » n’apparaît qu’au focus clavier, jamais sur le contenu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, '/admin#voice');
  const skip = page.getByRole('link', { name: 'Aller aux réglages' });
  const size = async () => (await skip.boundingBox())!;
  // Au repos, même page défilée : découpé à 1 px, pas seulement poussé au-dessus de l’écran
  // (il réapparaissait alors sur le contenu dans une capture de page entière).
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect((await size()).width).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  expect(await size()).toMatchObject({ y: 16 });
  expect((await size()).width).toBeGreaterThan(100);
  await page.keyboard.press('Enter');
  await expect(page.locator('#admin-content')).toBeFocused();
  expect((await size()).width).toBeLessThanOrEqual(1);
});
