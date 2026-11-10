import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import {
  IMAGE_GENERATION_MODELS,
  type DevicesStatus,
  type ImageGenerationModel,
  type ModelDownload,
  type StateEvent,
} from '../../shared/types';
import { origin, screenshots } from './env';

// PNG 1 × 1 : le miroir n’a besoin que d’un fichier image valide.
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function login(page: Page) {
  await page.goto('/admin');
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
}

const download = (state: ModelDownload['state'], extra: Partial<ModelDownload> = {}) => ({
  state,
  file: null,
  completed: 0,
  files: 2,
  received: 0,
  total: null,
  error: null,
  ...extra,
});

/**
 * Remplace l’état d’installation diffusé par le serveur : aucun téléchargement réel pendant
 * les tests. Les champs absents de `fake` restent ceux du serveur.
 */
async function fakeImageGeneration(
  page: Page,
  fake: {
    model?: ImageGenerationModel;
    enabled?: boolean;
    installations: Partial<Record<ImageGenerationModel, ModelDownload>>;
  },
) {
  let socket: WebSocketRoute | undefined;
  let last: { status: DevicesStatus } | null = null;
  const patch = (status: DevicesStatus) => {
    const generation = status.imageGeneration!;
    if (fake.model) generation.model = fake.model;
    if (fake.enabled !== undefined) generation.enabled = fake.enabled;
    generation.installations = {
      ...generation.installations!,
      ...fake.installations,
    } as Record<ImageGenerationModel, ModelDownload>;
  };
  await page.routeWebSocket('**/events?role=admin', (route) => {
    socket = route;
    const server = route.connectToServer();
    server.onMessage((message) => {
      const value = JSON.parse(String(message));
      if (value.type !== 'devices') return route.send(message);
      last = value;
      patch(value.status);
      route.send(JSON.stringify(value));
    });
  });
  return () => {
    if (!last) return;
    patch(last.status);
    socket?.send(JSON.stringify(last));
  };
}

test('le préchargement du modèle d’image se règle une fois le modèle installé et persiste', async ({
  page,
}) => {
  await fakeImageGeneration(page, {
    installations: { 'flux2-klein-4b': download('present') },
  });
  await login(page);
  const open = async () => {
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-image-generation > summary').click();
  };
  await open();
  const preload = page.getByRole('switch', { name: 'Charger le modèle dès le démarrage' });
  await expect(preload).toBeEnabled();
  await expect(preload).not.toBeChecked();
  await expect(page.getByText('Images gardées : 0 / 3.', { exact: false })).toBeVisible();
  await preload.click();
  await expect(preload).toBeChecked();
  try {
    await page.reload();
    await open();
    await expect(preload).toBeChecked();
  } finally {
    // La base est partagée par la série : rétablir le réglage par défaut.
    await page.request.patch('/api/admin/image-generation', {
      headers: { origin },
      data: { preload: false },
    });
  }
  await page.reload();
  await open();
  await expect(preload).not.toBeChecked();
});

test('image : choisir ne télécharge rien, installer se confirme, progresse, échoue lisiblement puis s’active', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/admin/image-generation'))
      requests.push(request.method() + ' ' + path);
  });
  const fake: Parameters<typeof fakeImageGeneration>[1] = {
    model: 'flux2-klein-4b',
    enabled: false,
    // Tous les modèles absents, quoi que contienne ce poste : un modèle déjà installé dans
    // models/ ne doit pas changer le parcours.
    installations: Object.fromEntries(
      IMAGE_GENERATION_MODELS.map((model) => [model, download('missing')]),
    ),
  };
  const publish = await fakeImageGeneration(page, fake);
  await page.route('**/api/admin/image-generation', async (route) => {
    const body = route.request().postDataJSON() as {
      model?: ImageGenerationModel;
      enabled?: boolean;
    };
    if (body.model) fake.model = body.model;
    if (body.enabled !== undefined) fake.enabled = body.enabled;
    await route.fulfill({ json: {} });
    publish();
  });
  await page.route('**/api/admin/image-generation/install', async (route) => {
    fake.installations[fake.model!] = download('downloading', {
      file: 'Modèle depuis Hugging Face',
      completed: 1,
    });
    await route.fulfill({ json: {} });
    publish();
  });
  await login(page);
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  const module = page.locator('#module-image-generation');
  await module.locator(':scope > summary').click();
  const enabled = module.getByRole('switch', { name: 'Autoriser la création d’images' });
  // Le vocabulaire technique reste replié dans « Détails techniques ».
  await expect(module.getByText(/Luna|LFM|ONNX|VRAM|worker/).filter({ visible: true })).toHaveCount(
    0,
  );
  // Rien n’est installé : les réglages de l’étape 3 attendent.
  await expect(enabled).toBeDisabled();
  await expect(
    module.getByRole('switch', { name: 'Charger le modèle dès le démarrage' }),
  ).toBeDisabled();
  await expect(module.getByRole('radio', { name: 'Précis', exact: true })).toBeChecked();
  // Le modèle prévu n’est pas encore « Utilisé » tant qu’il n’est pas installé.
  await expect(module.getByText('Actuel', { exact: true })).toBeVisible();
  await expect(module.getByText('Utilisé', { exact: true })).toHaveCount(0);
  await module.getByRole('radio', { name: 'Léger', exact: true }).check();
  await expect(
    module.getByText('« Léger » n’est pas encore installé.', { exact: false }),
  ).toBeVisible();
  expect(requests).toEqual([]);

  const install = module.getByRole('button', { name: 'Installer « Léger »…', exact: true });
  await install.click();
  const confirm = module.getByRole('group', { name: 'Installer « Léger » sur ce PC ?' });
  // Taille du modèle et des outils de calcul installés avec le premier modèle, puis durée.
  await expect(confirm).toContainText('Environ 11 Go à télécharger, de 7 min à 30 min');
  // L’écart avec « Disque : environ 7 Go » du choix est expliqué : l’environnement de calcul.
  await expect(
    module.getByRole('radio', { name: 'Léger', exact: true }),
  ).toHaveAccessibleDescription(/Disque : environ 7 Go/);
  await expect(confirm).toContainText(
    'Soit environ 7 Go pour le modèle et 4 Go pour l’environnement de calcul',
  );
  await expect(confirm).toContainText('il ne compte pas dans « Disque : environ 7 Go »');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(requests).toEqual([]);

  await install.click();
  await confirm.getByRole('button', { name: 'Installer', exact: true }).click();
  await expect
    .poll(() => requests)
    .toEqual(['PATCH /api/admin/image-generation', 'POST /api/admin/image-generation/install']);
  await expect(
    module.getByRole('progressbar', { name: 'Installation de « Léger » en cours…' }),
  ).toBeVisible();
  await expect(module.getByText('Étape 2 sur 2 : téléchargement du modèle')).toBeVisible();
  // Durée inconnue : pas de pourcentage annoncé.
  await expect(
    module.getByRole('progressbar', { name: 'Installation de « Léger » en cours…' }),
  ).not.toHaveAttribute('aria-valuenow');
  await expect(module.getByRole('radio', { name: 'Léger', exact: true })).toBeChecked();
  await expect(module.getByRole('radio', { name: 'Précis', exact: true })).toBeDisabled();
  await expect(enabled).toBeDisabled();

  const output =
    'Traceback (most recent call last):\n  File "install.py", line 239\nOSError: [Errno 28] No space left on device';
  fake.installations['sdxl-turbo'] = download('failed', { error: output });
  publish();
  const failure = module.getByRole('alert').filter({ hasText: 'L’installation a échoué' });
  await expect(failure).toBeVisible();
  await expect(failure.getByText(/No space left on device/)).toBeHidden();
  await failure.getByRole('button', { name: 'Voir les détails', exact: true }).click();
  await expect(failure.getByText(/No space left on device/)).toBeVisible();
  await page.screenshot({ path: `${screenshots}/image-generation-failure.png`, fullPage: true });

  // Réessayer relance l’installation du modèle déjà choisi, sans nouvelle sélection.
  await failure.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toBe('POST /api/admin/image-generation/install');
  fake.installations['sdxl-turbo'] = download('ready', { completed: 2 });
  publish();
  await expect(module.getByText('« Léger » est installé sur ce PC.')).toBeVisible();
  await expect(module.getByText('Utilisé', { exact: true })).toBeVisible();
  await expect(enabled).toBeEnabled();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect(module.locator(':scope > summary')).toContainText('Activée');
  await page.screenshot({ path: `${screenshots}/image-generation-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `${screenshots}/image-generation-mobile.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('le miroir signale l’image en création puis l’affiche seule, sans texte', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  const snapshot: StateEvent = {
    ...initial,
    bootId: 'image-browser-fixture',
    sequence: 1,
    sentAt: Date.now(),
    state: {
      ...initial.state,
      openaiBlocked: true,
      browserConnected: true,
      session: { ...initial.state.session, phase: 'blocked', interactionId: 'image-ui' },
      imageGeneration: { kind: 'requested', startedAt: Date.now() },
      cards: [],
    },
  };
  let socket: WebSocketRoute | undefined;
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.route('**/api/generated-images/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    socket = route;
    route.send(JSON.stringify(snapshot));
  });
  const publish = () => {
    snapshot.sequence++;
    snapshot.sentAt = Date.now();
    socket?.send(JSON.stringify(snapshot));
  };
  await page.goto('/');
  const activity = page.getByRole('status').filter({ hasText: 'Image en création' });
  await expect(activity).toBeVisible();
  await expect(page.locator('.display-card')).toHaveCount(0);

  snapshot.state.imageGeneration = { kind: 'illustration', startedAt: Date.now() };
  publish();
  await expect(page.getByRole('status').filter({ hasText: 'Illustration en cours' })).toBeVisible();
  await expect(activity).toHaveCount(0);

  const prompt = 'un phare dans la brume, affiche minimaliste';
  snapshot.state.imageGeneration = null;
  snapshot.state.cards = [
    {
      id: 'image-card',
      interactionId: 'image-ui',
      profileEpoch: snapshot.state.session.profileEpoch,
      contextVersion: snapshot.state.session.contextVersion,
      profileId: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      content: {
        schemaVersion: 1,
        cardType: 'image',
        title: 'Image générée',
        prompt,
        imageUrl: '/api/generated-images/00000000-0000-4000-8000-000000000000.webp',
        model: 'sdxl-turbo',
        width: 512,
        height: 512,
        primaryValue: null,
        subtitle: null,
        description: null,
        items: [],
        sources: [],
      },
      sources: [],
    },
  ];
  publish();
  const card = page.locator('.display-card-image');
  const image = card.getByRole('img', { name: 'Image créée par Cornelius' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
  await expect(card).not.toContainText('Image générée');
  await expect(card).not.toContainText(prompt);
  await expect(card).not.toContainText('Luna');
  await expect(page.locator('.mirror-activity')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('image avec OpenAI : rien à installer, la clé est signalée, modèle et qualité persistent', async ({
  page,
}) => {
  await login(page);
  const open = async () => {
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await page.locator('#module-image-generation > summary').click();
  };
  await open();
  const panel = page.locator('#module-image-generation');
  await expect(panel.getByRole('radio', { name: 'Sur ce PC' })).toBeChecked();
  try {
    await panel.getByRole('radio', { name: 'Avec OpenAI' }).check();
    await expect(panel.getByRole('radio', { name: 'Avec OpenAI' })).toBeChecked();
    // Le serveur de test n’a pas de clé : l’étape le dit, sans installation proposée.
    await expect(panel.getByText('Clé OpenAI absente', { exact: false })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Installer/ })).toHaveCount(0);
    await panel.getByLabel('Modèle OpenAI').selectOption('gpt-image-2.5-sunburst');
    await panel.getByLabel('Qualité').selectOption('medium');
    await expect(page.locator('#module-image-generation > summary')).toContainText(
      'OpenAI · GPT Image 2.5 Sunburst',
    );
    await expect(
      panel.getByRole('switch', { name: 'Autoriser la création d’images' }),
    ).toBeEnabled();
    await page.reload();
    await open();
    await expect(panel.getByRole('radio', { name: 'Avec OpenAI' })).toBeChecked();
    await expect(panel.getByLabel('Modèle OpenAI')).toHaveValue('gpt-image-2.5-sunburst');
    await expect(panel.getByLabel('Qualité')).toHaveValue('medium');
  } finally {
    await page.request.patch('/api/admin/image-generation', {
      headers: { origin },
      data: { provider: 'local', openaiModel: 'gpt-image-2.5-flare', openaiQuality: 'low' },
    });
  }
});
