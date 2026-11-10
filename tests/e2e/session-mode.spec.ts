import { test, expect } from '@playwright/test';
import { origin } from './env';

test('l’ouverture se règle en deux questions, avec une seule écriture par cas', async ({
  page,
}) => {
  await page.goto('/admin#voice');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  const triggers = page.getByRole('group', { name: 'Ce qui l’ouvre' });
  const audiences = page.getByRole('group', { name: 'Qui peut l’ouvrir' });
  const summary = page.locator('.admin-opening-summary');
  const recognize = page.getByRole('checkbox', {
    name: 'Reconnaître la personne pendant la conversation',
  });
  const gaze = triggers.getByRole('radio', { name: /Le regard/ });
  const members = audiences.getByRole('radio', { name: /Les membres du foyer/ });
  const everyone = audiences.getByRole('radio', { name: /Tout le monde/ });
  const voice = triggers.getByRole('radio', { name: /« Cornelius »/ });
  try {
    await expect(gaze).toBeChecked();
    await expect(everyone).toBeChecked();
    await expect(recognize).toHaveCount(0);
    await members.click();
    await expect(members).toBeChecked();
    await expect(page.getByText('Ouverture enregistrée.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(gaze).toBeChecked();
    await expect(members).toBeChecked();
    await expect(summary).toContainText('un membre du foyer reconnu regarde le miroir');
    // « Cornelius » réservé aux membres : la caméra veille pour savoir qui parle.
    await voice.click();
    await expect(voice).toBeChecked();
    await expect(members).toBeChecked();
    await expect(summary).toContainText('seulement si un membre du foyer est reconnu');
    await expect(summary).toContainText('Caméra en veille : allumée, pour savoir qui');
    await expect(recognize).toHaveCount(0);
    // Pour tout le monde : caméra éteinte en veille, reconnaissance facultative.
    await everyone.click();
    await expect(everyone).toBeChecked();
    await expect(summary).toContainText('sans caméra');
    await recognize.click();
    await expect(recognize).toBeChecked();
    await expect(summary).toContainText('la caméra reconnaît ensuite la personne');
    // Le choix s’affiche aussitôt : attendre qu’il soit enregistré avant de recharger.
    await expect
      .poll(async () => (await (await page.request.get('/api/state')).json()).state.opening)
      .toEqual({ trigger: 'voice', audience: 'everyone', recognizeVoice: true });
    await page.reload();
    await expect(voice).toBeChecked();
    await expect(recognize).toBeChecked();
  } finally {
    // La base est partagée par toute la série : rétablir l’ouverture par défaut.
    await page.request.patch('/api/admin/opening', {
      headers: { origin },
      data: { trigger: 'gaze', audience: 'everyone', recognizeVoice: false },
    });
  }
});

test('« Quand il écoute » range ses cartes dans l’ordre, les réglages avancés repliés', async ({
  page,
}) => {
  await page.goto('/admin#voice');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  const settings = page.locator('.admin-settings');
  await expect(settings.locator('[data-slot="card-title"]').first()).toBeVisible();
  expect(await settings.locator('[data-slot="card-title"]').allTextContents()).toEqual([
    'Ouverture de la conversation',
    'Fin de parole',
    'Mode vie privée',
    'Accueil à l’ouverture',
    'Son d’ouverture',
    // Dans le repli « Réglages avancés » : deux cartes du même style que les autres.
    'Micro gardé prêtBêta',
    'Délais de présence',
  ]);
  const advanced = page.locator('summary').filter({ hasText: 'Réglages avancés' }).locator('..');
  await expect(advanced).not.toHaveAttribute('open');
  await expect(advanced).toContainText('Délais de présence');
  await expect(advanced).toContainText('Micro gardé prêt');
  await expect(page.getByText('Ce dont la conversation dépend')).toHaveCount(0);
  await expect(page.getByText(/enregistrés sur le serveur/)).toHaveCount(1);
});

test('deux choix d’ouverture rapprochés sont enregistrés tous les deux', async ({ page }) => {
  // Ancien défaut : le second choix, envoyé pendant l’enregistrement du premier, partageait son
  // libellé « Ouverture enregistrée. » et était ignoré alors que le message confirmait.
  let requests = 0;
  await page.route('**/api/admin/opening', async (route) => {
    const first = ++requests === 1;
    const response = await route.fetch();
    // Le serveur a appliqué le premier choix ; sa réponse tarde à revenir au navigateur.
    if (first) await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ response });
  });
  await page.goto('/admin#voice');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  const members = page
    .getByRole('group', { name: 'Qui peut l’ouvrir' })
    .getByRole('radio', { name: /Les membres du foyer/ });
  const voice = page
    .getByRole('group', { name: 'Ce qui l’ouvre' })
    .getByRole('radio', { name: /« Cornelius »/ });
  try {
    await members.click();
    await expect(members).toBeChecked();
    await voice.click();
    await expect
      .poll(async () => (await (await page.request.get('/api/state')).json()).state.opening)
      .toEqual({ trigger: 'voice', audience: 'members', recognizeVoice: false });
    await expect(voice).toBeChecked();
    await expect(members).toBeChecked();
  } finally {
    await page.request.patch('/api/admin/opening', {
      headers: { origin },
      data: { trigger: 'gaze', audience: 'everyone', recognizeVoice: false },
    });
  }
});

test('la délégation permet Luna normal, Luna rapide et Astra ultra rapide, avec choix conservé', async ({
  page,
}) => {
  await page.goto('/admin#assistant');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  // Le choix du modèle vit dans « Voix et modèles », avec le fournisseur et la voix.
  await expect(page.getByRole('heading', { level: 1, name: 'Voix et modèles' })).toBeVisible();
  const options = page.getByRole('group', { name: 'Mode de délégation', exact: true });
  // Les noms de modèles restent : c’est le choix proposé. Le reste est dit en français courant.
  await expect(options.getByText('GPT-6 Luna', { exact: true })).toHaveCount(2);
  await expect(options.getByText('GPT-6 Astra', { exact: true })).toHaveCount(1);
  await expect(options.getByText('GPT-5.6 Luna', { exact: true })).toHaveCount(0);
  const card = page.locator('[data-slot="card"]').filter({ has: options });
  for (const label of ['Normal', 'Ultra rapide', 'Rapide']) {
    const choice = options.getByRole('radio', { name: new RegExp(label) });
    await choice.click();
    await expect(choice).toBeChecked();
    await expect(page.getByText('Mode de délégation enregistré.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(choice).toBeChecked();
    if (label === 'Ultra rapide') {
      await expect(card.getByText(/garde ses données en Europe/)).toBeVisible();
      await expect(card).not.toContainText(/Ultrafast|endpoints/);
    }
  }
});

test('« Micro gardé prêt » se règle dans les réglages avancés, hors de l’ouverture', async ({
  page,
}) => {
  await page.goto('/admin#voice');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  const opening = page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name: 'Ouverture de la conversation' }),
  });
  const folded = page.locator('summary').filter({ hasText: 'Réglages avancés' });
  // Un oui ou non : un interrupteur, comme les autres réglages.
  const advanced = page.getByRole('switch', { name: 'Garder le micro prêt' });
  await expect(opening).toBeVisible();
  await expect(opening.getByRole('checkbox', { name: /micro/ })).toHaveCount(0);
  await expect(advanced).toBeHidden();
  try {
    await folded.click();
    await advanced.click();
    await expect(advanced).toBeChecked();
    await expect(page.getByText('Micro gardé prêt : activé.', { exact: true })).toBeVisible();
    await page.reload();
    await folded.click();
    await expect(advanced).toBeChecked();
    await advanced.click();
    await expect(advanced).not.toBeChecked();
  } finally {
    // La base est partagée par toute la série : micro gardé prêt désactivé, comme au départ.
    await page.request.patch('/api/admin/advanced-audio-buffer', {
      headers: { origin },
      data: { enabled: false },
    });
  }
});

test('le son d’ouverture se choisit dans un seul groupe, « Aucun son » compris, et persiste', async ({
  page,
}) => {
  await page.goto('/admin#voice');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
  const group = page.getByRole('group', { name: 'Son joué à l’ouverture' });
  const none = group.getByRole('radio', { name: 'Aucun son', exact: true });
  const bell = group.getByRole('radio', { name: 'Cloche', exact: true });
  await expect(group.getByRole('radio')).toHaveCount(7);
  await expect(page.getByRole('switch', { name: /Son d’ouverture/ })).toHaveCount(0);
  await expect(none).toBeChecked();
  await expect(none).toHaveAccessibleDescription('La conversation s’ouvre en silence.');
  await expect(page.getByRole('button', { name: /Écouter le son/ })).toHaveCount(0);
  try {
    await group.getByText('Cloche', { exact: true }).click();
    await expect(bell).toBeChecked();
    await expect(page.getByText('Son « Cloche » choisi.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Écouter le son Cloche' }).click();
    await page.reload();
    await expect(bell).toBeChecked();
    await none.click();
    await expect(page.getByText('Son d’ouverture désactivé.', { exact: true })).toBeVisible();
    expect((await (await page.request.get('/api/state')).json()).state.admissionSound).toEqual({
      enabled: false,
      sound: 'cloche',
    });
    await page.reload();
    await expect(none).toBeChecked();
  } finally {
    // Retour aux réglages par défaut : la base est partagée par toute la série de tests.
    await page.request.patch('/api/admin/admission-sound', {
      headers: { origin },
      data: { enabled: false, sound: 'carillon' },
    });
  }
});
