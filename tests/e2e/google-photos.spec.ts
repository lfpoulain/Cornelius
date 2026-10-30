import { expect, test } from '@playwright/test';
import { DEFAULT_GOOGLE_PHOTOS, type GooglePhotosView } from '../../shared/google-photos';
import { screenshots } from './env';

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
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Écran de veille', exact: true }).click();
  await page.getByRole('radio', { name: 'Album Google Photos', exact: true }).check();
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
