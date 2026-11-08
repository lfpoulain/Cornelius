import { expect, test, type Page } from '@playwright/test';
import { origin, screenshots } from './env';

async function login(page: Page, path: string) {
  await page.goto(path);
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

test('la fin de parole se choisit dans une liste, enregistrée au clic', async ({ page }) => {
  await login(page, '/admin#voice');
  const group = page.getByRole('group', { name: 'Fermer après un silence de' });
  const never = group.getByRole('radio', { name: 'Jamais', exact: true });
  const minute = group.getByRole('radio', { name: '1 min', exact: true });
  await expect(group.getByRole('radio')).toHaveCount(7);
  await expect(never).toBeChecked();
  try {
    await minute.click();
    await expect(
      page.getByText('Fin de parole : après 1 min de silence.', { exact: true }),
    ).toBeVisible();
    expect((await (await page.request.get('/api/state')).json()).state.silenceClose).toEqual({
      enabled: true,
      delayMs: 60_000,
    });
    // Valeur personnalisée : le réglage fin, avec sa barre « Enregistrer ».
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('heading', { name: 'Fin de parole', exact: true }) });
    await card.getByText('Réglage fin').click();
    await page.getByLabel('Délai de silence (s)').fill('45');
    await card.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const custom = group.getByRole('radio', { name: '45 s (personnalisé)', exact: true });
    await expect(custom).toBeChecked();
    await never.click();
    await expect(never).toBeChecked();
    expect((await (await page.request.get('/api/state')).json()).state.silenceClose).toEqual({
      enabled: false,
      delayMs: 45_000,
    });
    // « Cornelius » pour tout le monde : « Jamais » est indisponible, et dit pourquoi.
    await page
      .getByRole('group', { name: 'Ce qui l’ouvre' })
      .getByText('« Cornelius »', { exact: true })
      .click();
    await expect(never).toBeDisabled();
    await expect(group.getByRole('radio', { name: '45 s (personnalisé)' })).toBeChecked();
    await expect(page.getByText(/« Jamais » n’est pas disponible/)).toBeVisible();
  } finally {
    for (const [path, data] of [
      ['/api/admin/silence-close', { enabled: false, delayMs: 20_000 }],
      ['/api/admin/opening', { trigger: 'gaze', audience: 'everyone', recognizeVoice: false }],
    ] as const)
      await page.request.patch(path, { headers: { origin }, data });
  }
});

test('« Fermer après la première réponse » s’enregistre au clic', async ({ page }) => {
  await login(page, '/admin#voice');
  const option = page.getByRole('checkbox', { name: 'Fermer après la première réponse' });
  await expect(option).not.toBeChecked();
  try {
    await option.click();
    await expect(
      page.getByText('Fin de parole : après la première réponse.', { exact: true }),
    ).toBeVisible();
    await expect(option).toBeChecked();
    expect((await (await page.request.get('/api/state')).json()).state.replyClose).toBe(true);
    await page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('heading', { name: 'Fin de parole', exact: true }) })
      .screenshot({ path: `${screenshots}/fin-de-parole-reponse.png` });
    await option.click();
    await expect(option).not.toBeChecked();
    expect((await (await page.request.get('/api/state')).json()).state.replyClose).toBe(false);
  } finally {
    await page.request.patch('/api/admin/reply-close', {
      headers: { origin },
      data: { enabled: false },
    });
  }
});

test('« Fermer quand on dit merci » s’enregistre au clic', async ({ page }) => {
  await login(page, '/admin#voice');
  const option = page.getByRole('checkbox', { name: 'Fermer quand on dit merci' });
  await expect(option).not.toBeChecked();
  try {
    await option.click();
    await expect(
      page.getByText('Fin de parole : quand on dit merci.', { exact: true }),
    ).toBeVisible();
    await expect(option).toBeChecked();
    expect((await (await page.request.get('/api/state')).json()).state.endWord).toBe(true);
    await option.click();
    await expect(option).not.toBeChecked();
    expect((await (await page.request.get('/api/state')).json()).state.endWord).toBe(false);
  } finally {
    await page.request.patch('/api/admin/end-word', {
      headers: { origin },
      data: { enabled: false },
    });
  }
});

test('l’ouverture dit ce qui l’empêche de fonctionner, avec où agir', async ({ page }) => {
  await login(page, '/admin#voice');
  const card = page
    .locator('[data-slot="card"]')
    .filter({ hasText: 'Ouverture de la conversation' });
  const warnings = card.getByRole('list', { name: 'Ce qui empêche cette ouverture' });
  try {
    // Le serveur de test n’a pas de service caméra.
    await expect(warnings).toContainText(
      'Le service caméra n’est pas lancé : ce choix ne peut pas fonctionner pour l’instant.',
    );
    await card
      .getByRole('group', { name: 'Qui peut l’ouvrir' })
      .getByText('Les membres du foyer', { exact: true })
      .click();
    await expect(warnings).toContainText(
      'Aucun visage n’est encore mémorisé : personne ne pourra ouvrir la conversation.',
    );
    await expect(warnings.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText('Ouverture enregistrée.', { exact: true })).toBeVisible();
    await card.screenshot({ path: `${screenshots}/admin-opening-warnings.png` });
    await warnings.getByRole('link', { name: 'Enregistrer un visage' }).click();
    await expect(heading(page)).toHaveText('Le foyer et les visages');
  } finally {
    await page.request.patch('/api/admin/opening', {
      headers: { origin },
      data: { trigger: 'gaze', audience: 'everyone', recognizeVoice: false },
    });
  }
});

test('la caméra donne un seul motif quand elle ne peut pas être changée', async ({ page }) => {
  await login(page, '/admin#camera');
  const select = page.getByLabel('Caméra', { exact: true });
  await expect(select).toBeDisabled();
  await expect(select.locator('option').first()).toHaveText(
    'Aucune caméra : le service caméra n’est pas lancé',
  );
  await expect(select).toHaveAccessibleDescription(/^Le service caméra n’est pas lancé/);
  await expect(page.getByText(/Terminez la conversation/)).toHaveCount(0);
  await expect(page.getByText(/perception locale/)).toHaveCount(0);
});
