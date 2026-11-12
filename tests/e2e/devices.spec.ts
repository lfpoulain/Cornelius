import { test, expect } from '@playwright/test';
import { login, origin, screenshots } from './env';

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});
test('les périphériques audio sont autorisés puis libérés, et les choix persistent', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const captured: MediaStream[] = [];
    (window as unknown as { capturedAudio: MediaStream[] }).capturedAudio = captured;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      captured.push(stream);
      return stream;
    };
  });
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Micro et haut-parleurs' }).click();
  await expect(
    page.getByText('Ce réglage s’applique au miroir ouvert dans ce navigateur.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Autoriser et vérifier le microphone/ }).click();
  await expect(page.getByText('Micro autorisé', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.getByLabel('Microphone').locator('option').count())
    .toBeGreaterThan(1);
  expect(
    await page.evaluate(() =>
      (window as unknown as { capturedAudio: MediaStream[] }).capturedAudio.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
    ),
  ).toBe(true);
  const selected = await page
    .getByLabel('Microphone')
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await page.getByLabel('Microphone').selectOption(selected!);
  await expect(
    page.getByText('Microphone choisi pour ce navigateur.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tester le haut-parleur' })).toBeEnabled();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('cornelius.audio')!).microphone),
  ).toBe(selected);
  await page.reload();
  await page.getByRole('button', { name: 'Micro et haut-parleurs' }).click();
  await expect(page.getByLabel('Microphone')).toHaveValue(selected!);
  await page.screenshot({ path: `${screenshots}/admin-devices.png`, fullPage: true });
});

test('l’exigence de la reconnaissance s’enregistre dès le choix et survit au rechargement', async ({
  page,
}) => {
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Caméra et reconnaissance' }).click();
  const group = page.getByRole('group', { name: 'Exigence de la reconnaissance' });
  const flexible = group.getByRole('radio', { name: 'Souple', exact: true });
  await expect(group.getByRole('radio', { name: 'Équilibrée', exact: true })).toBeChecked();
  try {
    // Un préréglage s’enregistre au clic, sans bouton à confirmer.
    await flexible.click();
    await expect(
      page.getByText('Exigence de la reconnaissance enregistrée.', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Caméra et reconnaissance' }).click();
    await expect(flexible).toBeChecked();
    // Le chiffre exact vit dans le réglage fin, avec la virgule.
    await expect(page.getByLabel('Exigence de la reconnaissance', { exact: true })).toHaveValue(
      '0,38',
    );
  } finally {
    await page.request.patch('/api/admin/recognition', {
      headers: { origin },
      data: { threshold: 0.42 },
    });
  }
});

test('la détection du regard s’enregistre dès le choix et survit au rechargement', async ({
  page,
}) => {
  await login(page, '/admin');
  await page.getByRole('button', { name: 'Caméra et reconnaissance' }).click();
  const group = page.getByRole('group', { name: 'Exigence du regard' });
  try {
    await group.getByRole('radio', { name: 'Souple', exact: true }).click();
    await expect(page.getByText('Détection du regard enregistrée.', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Caméra et reconnaissance' }).click();
    await expect(group.getByRole('radio', { name: 'Souple', exact: true })).toBeChecked();
    await expect(page.getByLabel('Orientation de la tête acceptée')).toHaveValue('45');
    await expect(page.getByLabel('Taille minimale du visage (%)')).toHaveValue('8');
  } finally {
    await page.request.patch('/api/admin/engagement', {
      headers: { origin },
      data: { poseTolerance: 0.3, minFaceRatio: 0.14 },
    });
  }
});
