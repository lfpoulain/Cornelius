import { expect, test } from '@playwright/test';
import { DEFAULT_GOOGLE_PHOTOS, type GooglePhotosView } from '../../shared/google-photos';
import { login, screenshots } from './env';

test('album partagé : choix de source, validation, aperçu, actualisation et annulation', async ({
  page,
}) => {
  // Le navigateur teste le formulaire sans contacter Google ni contenir de photo personnelle.
  let view: GooglePhotosView = {
    ...DEFAULT_GOOGLE_PHOTOS,
    count: 0,
    images: [],
    refreshing: false,
    lastCheckedAt: null,
    error: null,
  };
  let refreshes = 0;
  await page.route('**/api/admin/screensaver/google-photos', async (route) => {
    if (route.request().method() === 'PUT') {
      const settings = route.request().postDataJSON();
      if (settings.albumUrl.includes('/album/'))
        return route.fulfill({
          status: 400,
          json: { error: 'Indiquez un lien de partage Google Photos valide.' },
        });
      view = {
        ...view,
        ...settings,
        count: settings.source === 'google-photos' ? 1 : 0,
        lastCheckedAt: Date.now(),
        error: null,
        images:
          settings.source === 'google-photos'
            ? [
                {
                  id: 'test-photo',
                  url: '/test-google-photo.png',
                  title: 'Photo 1',
                  credit: '',
                  origin: 'google-photos',
                  width: 1,
                  height: 1,
                },
              ]
            : [],
      };
    }
    return route.fulfill({ json: view });
  });
  await page.route('**/api/admin/screensaver/google-photos/refresh', async (route) => {
    refreshes++;
    if (refreshes > 1)
      return route.fulfill({
        status: 429,
        json: { error: 'Une vérification a déjà eu lieu. Réessayez dans 42 s.' },
      });
    return route.fulfill({ json: view });
  });
  await page.route('**/test-google-photo.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Orbe et écran de veille', exact: true }).click();
  await page.getByRole('radio', { name: 'Album Google Photos', exact: true }).check();
  await expect(
    page.getByText('Photos accessibles à toute personne possédant le lien', { exact: true }),
  ).toBeVisible();
  const save = page
    .getByRole('region', { name: 'Source des images : modifications non enregistrées' })
    .getByRole('button', { name: 'Enregistrer', exact: true });
  await expect(save).toBeDisabled();
  const link = page.getByLabel('Lien de partage de l’album');
  await link.fill('https://photos.google.com/album/private-example');
  await save.click();
  await expect(
    page.getByText('Indiquez un lien de partage Google Photos valide.', { exact: true }),
  ).toBeVisible();
  await link.fill('https://photos.app.goo.gl/synthetic-album');
  await page.getByLabel('Actualiser l’album toutes les (minutes)').fill('2');
  await expect(save).toBeDisabled();
  await page.getByLabel('Actualiser l’album toutes les (minutes)').fill('30');
  await save.click();
  await expect(page.getByText('1 photo disponible.', { exact: true })).toBeVisible();
  const preview = page.getByRole('list', { name: 'Aperçu de l’album' }).getByRole('img');
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveJSProperty('naturalWidth', 1);
  await page.getByRole('button', { name: 'Actualiser maintenant' }).click();
  await expect.poll(() => refreshes).toBe(1);
  await page.getByRole('button', { name: 'Actualiser maintenant' }).click();
  await expect(
    page.getByText('Une vérification a déjà eu lieu. Réessayez dans 42 s.').first(),
  ).toBeVisible();
  await page.screenshot({ path: `${screenshots}/google-photos-desktop.png`, fullPage: true });
  await link.fill('https://photos.app.goo.gl/unsaved');
  await page
    .getByRole('region', { name: 'Source des images : modifications non enregistrées' })
    .getByRole('button', { name: 'Annuler' })
    .click();
  await expect(link).toHaveValue('https://photos.app.goo.gl/synthetic-album');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshots}/google-photos-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('radio', { name: 'Images locales', exact: true }).check();
  await save.click();
  await expect(page.getByRole('list', { name: 'Aperçu de l’album' })).toHaveCount(0);
});

for (const unavailableAlbum of [false, true]) {
  test(`album partagé : ${unavailableAlbum ? 'galerie absente' : 'photos en erreur'} puis retour des aperçus`, async ({
    page,
  }) => {
    let restored = false;
    const photo = {
      id: 'missing-photo',
      url: '/test-missing-google-photo.png',
      title: 'Photo 1',
      credit: '',
      origin: 'google-photos' as const,
      width: 1,
      height: 1,
    };
    const view = (): GooglePhotosView => ({
      source: 'google-photos',
      albumUrl: 'https://photos.app.goo.gl/synthetic-album',
      refreshMinutes: 30,
      count: unavailableAlbum && !restored ? 0 : 1,
      images: unavailableAlbum && !restored ? [] : [photo],
      refreshing: false,
      lastCheckedAt: restored ? 200000 : 100000,
      error: restored
        ? null
        : 'Google Photos temporairement indisponible. Nouvelle tentative dans environ une minute.',
    });
    await page.route('**/api/admin/screensaver/google-photos', (route) =>
      route.fulfill({ json: view() }),
    );
    await page.route('**/api/admin/screensaver/google-photos/refresh', (route) => {
      restored = true;
      return route.fulfill({ json: view() });
    });
    await page.route('**/test-missing-google-photo.png', (route) =>
      restored
        ? route.fulfill({
            contentType: 'image/png',
            body: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
              'base64',
            ),
          })
        : route.fulfill({ status: 404 }),
    );
    await login(page, '/admin');
    await page.getByRole('button', { name: 'Orbe et écran de veille', exact: true }).click();
    const placeholder = page.getByRole('img', {
      name: unavailableAlbum ? 'Aucune photo disponible' : 'Aperçu indisponible',
      exact: true,
    });
    await expect(placeholder).toBeVisible();
    await expect(
      page.getByText(/L’album et son cache ne sont retirés qu’en cas d’erreur définitive/u),
    ).toBeVisible();
    if (!unavailableAlbum)
      await expect(page.getByText(/La liste des photos est conservée/u)).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/google-photos-${unavailableAlbum ? 'empty' : 'missing'}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(placeholder).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `${screenshots}/google-photos-${unavailableAlbum ? 'empty' : 'missing'}-mobile.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Actualiser maintenant' }).click();
    await expect(placeholder).toHaveCount(0);
    const preview = page
      .getByRole('list', { name: 'Aperçu de l’album' })
      .getByRole('img', { name: 'Photo 1' });
    await expect(preview).toHaveJSProperty('naturalWidth', 1);
  });
}
