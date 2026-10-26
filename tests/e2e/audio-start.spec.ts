import { expect, test } from '@playwright/test';

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('activer depuis l’administration autorise OpenAI et ouvre le miroir dans sa fenêtre', async ({
  page,
}) => {
  await page.goto('/admin#voice');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  await page.getByRole('button', { name: 'Bloquer les services IA', exact: true }).click();
  await expect(page.getByText('Accès aux services IA bloqué', { exact: true })).toBeVisible();
  const panel = page.getByRole('region', { name: 'Conversation' });
  const label = 'Autoriser OpenAI et ouvrir le miroir';
  await expect(panel.getByRole('button', { name: label, exact: true })).toBeVisible();
  // La mise en route propose le même geste, sous le même libellé, à l’étape « Miroir ouvert ».
  await page.getByRole('button', { name: 'Mise en route', exact: true }).click();
  await expect(page.getByRole('button', { name: /ouvrir le miroir/i })).toHaveCount(1);
  const step = page
    .getByRole('list', { name: 'Étapes de la mise en route' })
    .getByRole('listitem')
    .filter({ hasText: 'Miroir ouvert' });
  const popup = page.waitForEvent('popup');
  await step.getByRole('button', { name: label, exact: true }).click();
  const mirror = await popup;
  await expect(mirror).toHaveURL(/\/$/);
  await expect(mirror.getByRole('main', { name: 'Miroir Cornelius' })).toBeVisible();
  // L’administration reste ouverte dans son onglet.
  await expect(page).toHaveURL(/\/admin#start$/);
  await expect
    .poll(async () => (await (await page.request.get('/api/state')).json()).state.openaiBlocked)
    .toBe(false);
  const { state } = await (await page.request.get('/api/state')).json();
  expect(state.session.manualStop).toBe(false);
  expect(state.session.interactionId).toBeNull(); // No presence and no OpenAI key in this fixture.
  await mirror.close();
});

test('un refus du microphone se corrige sur le miroir sans rafraîchir', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let denied = true;
    navigator.permissions.query = () =>
      Promise.reject(new Error('Permissions API indisponible dans ce scénario'));
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (denied) {
        denied = false;
        throw new DOMException('refus de test', 'NotAllowedError');
      }
      return original(constraints);
    };
  });
  await page.goto('/');
  const activate = page.getByRole('button', { name: 'Activer la voix' });
  await activate.click();
  await expect(page.getByText(/Microphone refusé/)).toBeVisible();
  expect((await (await page.request.get('/api/state')).json()).state.browserAudioReady).toBe(false);
  await activate.click();
  await expect(activate).toHaveCount(0);
  await expect
    .poll(async () => (await (await page.request.get('/api/state')).json()).state.browserAudioReady)
    .toBe(true);
});
