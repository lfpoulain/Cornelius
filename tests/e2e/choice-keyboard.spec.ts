import { expect, test } from '@playwright/test';
import { login, origin, screenshots } from './env';

test('aux flèches, seul le dernier choix d’ouverture est enregistré', async ({ page }) => {
  const sent: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/admin/opening') && request.method() === 'PATCH')
      sent.push(request.postDataJSON());
  });
  await login(page, '/admin#voice');
  const triggers = page.getByRole('group', { name: 'Ce qui l’ouvre' });
  const gaze = triggers.getByRole('radio', { name: 'Le regard', exact: true });
  const voice = triggers.getByRole('radio', { name: '« Cornelius »', exact: true });
  try {
    await expect(gaze).toBeChecked();
    // Aller-retour avant la fin du délai : rien n’est envoyé.
    await gaze.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(gaze).toBeChecked();
    await page.waitForTimeout(900);
    expect(sent).toEqual([]);
    // Deux flèches : « La présence » puis « Cornelius » ; seul le second part.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(voice).toBeChecked();
    expect(sent).toEqual([]);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent).toEqual([{ trigger: 'voice', audience: 'everyone', recognizeVoice: false }]);
    await expect(page.getByText('Ouverture enregistrée.', { exact: true })).toBeVisible();
    await page.waitForTimeout(700);
    expect(sent).toHaveLength(1);
    // Un clic reste immédiat.
    await triggers.getByText('Le regard', { exact: true }).click();
    await expect.poll(() => sent.length).toBe(2);
  } finally {
    await page.request.patch('/api/admin/opening', {
      headers: { origin },
      data: { trigger: 'gaze', audience: 'everyone', recognizeVoice: false },
    });
  }
});

test('changer de délégation pendant une conversation demande confirmation', async ({ page }) => {
  // Une conversation en cours, simulée dans l’état reçu par l’administration.
  const inConversation = (value: { type?: string; state?: { session: { phase: string } } }) => {
    if (value.type === 'state' && value.state) value.state.session.phase = 'ready';
    return value;
  };
  await page.routeWebSocket('**/events?role=admin', (route) => {
    const server = route.connectToServer();
    server.onMessage((message) =>
      route.send(JSON.stringify(inConversation(JSON.parse(String(message))))),
    );
  });
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: inConversation(await response.json()) });
  });
  const sent: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/admin/delegation-mode') && request.method() === 'PATCH')
      sent.push(request.postDataJSON());
  });
  await login(page, '/admin#assistant');
  const options = page.getByRole('group', { name: 'Mode de délégation', exact: true });
  const fast = options.getByRole('radio', { name: 'Rapide', exact: true });
  const normal = options.getByRole('radio', { name: 'Normal', exact: true });
  const confirm = page.getByRole('button', { name: 'Changer et terminer la conversation' });
  await expect(fast).toBeChecked();
  try {
    // Aux flèches, une seule confirmation, pour le dernier choix.
    await fast.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(normal).toBeChecked();
    await expect(confirm).toBeVisible();
    await expect(page.getByText(/passer en mode « Normal » la termine/)).toBeVisible();
    // Annuler : rien n’est envoyé et le choix enregistré revient.
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(fast).toBeChecked();
    expect(sent).toEqual([]);
    await options.getByText('Ultra rapide', { exact: true }).click();
    await page.screenshot({ path: `${screenshots}/admin-delegation-confirm.png` });
    await confirm.click();
    await expect.poll(() => sent).toEqual([{ mode: 'ultrafast' }]);
    await expect(options.getByRole('radio', { name: 'Ultra rapide', exact: true })).toBeChecked();
  } finally {
    await page.request.patch('/api/admin/delegation-mode', {
      headers: { origin },
      data: { mode: 'fast' },
    });
  }
});
