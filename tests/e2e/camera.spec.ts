import { test, expect } from '@playwright/test';
import { login, screenshots } from './env';

test('choisir une caméra et afficher un aperçu seulement pendant sa consultation', async ({
  page,
}) => {
  const devices = [
    { id: 'one', label: 'Webcam intégrée' },
    { id: 'two', label: 'Caméra USB' },
  ];
  let selected = 'one';
  let mode = { width: 1280, height: 720, fps: 30 };
  let sendDevices = () => {};
  let frames = 0;
  await page.routeWebSocket('**/events?role=admin', (route) => {
    const server = route.connectToServer();
    let original: Record<string, any>;
    sendDevices = () =>
      route.send(
        JSON.stringify({
          ...original,
          status: {
            ...original.status,
            perception: {
              ...original.status.perception,
              connected: true,
              camera: {
                selectedId: selected,
                devices,
                changing: false,
                error: null,
                mode,
                actual: { width: 1280, height: 720, fps: 30 },
              },
            },
          },
        }),
      );
    server.onMessage((message) => {
      const value = JSON.parse(String(message));
      if (value.type === 'devices') {
        original = value;
        sendDevices();
      } else route.send(message);
    });
  });
  await page.route('**/api/admin/camera/mode', async (route) => {
    mode = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
    sendDevices();
  });
  await page.route('**/api/admin/camera/select', async (route) => {
    selected = route.request().postDataJSON().id;
    await route.fulfill({ json: { ok: true } });
    sendDevices();
  });
  await page.route('**/api/admin/camera/frame', async (route) => {
    frames++;
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  });
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Caméra et reconnaissance' }).click();
  await expect(page.getByLabel('Caméra', { exact: true })).toHaveValue('one');
  expect(frames).toBe(0);
  await page.getByLabel('Caméra', { exact: true }).selectOption('two');
  await page.getByRole('button', { name: 'Utiliser cette caméra' }).click();
  await expect(page.getByRole('button', { name: 'Utiliser cette caméra' })).toBeDisabled();
  expect(selected).toBe('two');
  await page.getByRole('button', { name: 'Afficher l’aperçu' }).click();
  const image = page.getByAltText('Aperçu en direct de la caméra du miroir');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  // Résolution et cadence : la recommandée est signalée, l’image reçue est annoncée.
  const resolution = page.getByLabel('Résolution');
  await expect(resolution).toHaveValue('1280x720');
  await expect(resolution.locator('option:checked')).toHaveText('1280 x 720 (HD) (recommandée)');
  await expect(page.getByText('Image reçue : 1280 x 720, 30 i/s.')).toBeVisible();
  await resolution.selectOption('640x480');
  await expect.poll(() => mode).toEqual({ width: 640, height: 480, fps: 30 });
  await expect(page.getByText(/ne propose pas exactement ce réglage/)).toBeVisible();
  await page.screenshot({ path: `${screenshots}/camera-admin-fixture.png`, fullPage: true });
  await page.getByRole('button', { name: 'Masquer l’aperçu' }).click();
  const hidden = frames;
  await page.waitForTimeout(650);
  expect(frames).toBe(hidden);
  await page.getByRole('button', { name: 'Afficher l’aperçu' }).click();
  await expect(image).toBeVisible();
  await page.getByRole('button', { name: 'Le foyer' }).click();
  const left = frames;
  await page.waitForTimeout(650);
  expect(frames).toBe(left);
});
