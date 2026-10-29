import { expect, test, type Page } from '@playwright/test';
import type { DevicesStatus, MirrorState, StateEvent } from '../../shared/types';
import { origin, screenshots } from './env';

async function login(page: Page, path = '/admin') {
  await page.goto(path);
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
}

const ready: MirrorState = {
  setup: { openaiKey: true, perception: true },
  openaiBlocked: false,
  privacyMode: false,
  advancedAudioBuffer: false,
  delegationMode: 'fast',
  opening: { trigger: 'gaze', audience: 'everyone', recognizeVoice: false },
  wakeWord: { enabled: false, ready: false, detail: null },
  browserConnected: true,
  browserAudioReady: true,
  session: {
    phase: 'idle',
    reason: null,
    mode: 3,
    interactionId: null,
    profileEpoch: 0,
    contextVersion: 0,
    startedAt: null,
    readyAt: null,
    manualStop: false,
    microphoneEnabled: false,
  },
  presence: {
    state: 'absent',
    health: 'ok',
    peopleCount: 0,
    people: [],
    engagementId: null,
    observedAt: Date.now(),
  },
  activeProfile: null,
  selection: 'household',
  profiles: [],
  cards: [],
  ambientDisplays: [],
  voice: { phase: 'idle', startedAt: 0, endsAt: null },
  diagnostic: null,
};

function devices(selectedId: string | null): DevicesStatus {
  return {
    apiConfigured: true,
    perceptionConfigured: true,
    defaultPassword: false,
    enrolledFaces: 0,
    perception: {
      connected: true,
      camera: {
        devices: [{ id: 'cam', label: 'Caméra du salon' }],
        selectedId,
        changing: false,
        error: null,
      },
      recognitionThreshold: 0.42,
      engagement: { poseTolerance: 0.3, minFaceRatio: 0.14 },
      enrollingProfileId: null,
      enrolledProfileIds: [],
      diagnostic: null,
      vision: {
        mode: 'off',
        modelId: '450m',
        device: 'auto',
        model: 'unknown',
        provider: null,
        detail: null,
        lastDescription: null,
        lastAt: null,
        lastTrigger: null,
        pending: 0,
        appends: 0,
        lastRequestAt: null,
        lastLatencyMs: null,
        history: [],
      },
    },
  };
}

/** Le navigateur reçoit un état simulé ; le serveur de test n’est pas modifié. */
async function simulate(page: Page, status: DevicesStatus) {
  const snapshot: StateEvent = {
    schemaVersion: 1,
    type: 'state',
    bootId: 'getting-started-fixture',
    sequence: 1,
    sentAt: Date.now(),
    interactionId: null,
    profileEpoch: 0,
    contextVersion: 0,
    state: ready,
  };
  await page.routeWebSocket('**/events?role=admin', (route) => {
    route.send(JSON.stringify(snapshot));
    route.send(JSON.stringify({ schemaVersion: 1, type: 'devices', status }));
  });
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
}

test('sans clé OpenAI, l’administration s’ouvre sur la mise en route', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Mise en route' })).toBeVisible();
  await expect(page).toHaveURL(/#start$/);
  await expect(page).toHaveTitle('Mise en route · Administration Cornelius');
  const steps = page.getByRole('list', { name: 'Étapes de la mise en route' });
  const key = steps.getByRole('listitem').filter({ hasText: 'Clé OpenAI' });
  // L’état est écrit en toutes lettres, pas seulement par une couleur.
  await expect(key).toContainText('À faire');
  await expect(key).toContainText('Clés et jetons');
  await expect(key.getByRole('link', { name: /Guide d’installation/ })).toHaveAttribute(
    'href',
    /docs\/installation\/premier-demarrage\.md$/,
  );
  await expect(page.getByText('Tout est prêt', { exact: true })).toHaveCount(0);
  // Panneau de session compact : la consigne de la clé n’apparaît qu’une fois, et un seul
  // bouton ouvre le miroir, sous le libellé du panneau complet.
  await expect(page.getByRole('region', { name: 'Conversation' })).toHaveAttribute(
    'data-compact',
    'true',
  );
  await expect(page.getByText('OPENAI_API_KEY', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /ouvrir le miroir/i })).toHaveCount(1);
  await expect(
    steps
      .getByRole('listitem')
      .filter({ hasText: 'Miroir ouvert' })
      .getByRole('button', { name: 'Activer et ouvrir le miroir', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${screenshots}/admin-getting-started.png`, fullPage: true });
  // Sur téléphone, la liste des étapes commence dans le premier écran.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(steps.getByRole('listitem').first()).toBeInViewport();
  expect((await steps.boundingBox())!.y).toBeLessThan(844);
});

test('l’accès à OpenAI bloqué s’autorise depuis son étape', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Mise en route' })).toBeVisible();
  const blocked = await page.request.post('/api/admin/openai', {
    headers: { origin },
    data: { blocked: true },
  });
  expect(blocked.ok()).toBe(true);
  try {
    const step = page
      .getByRole('list', { name: 'Étapes de la mise en route' })
      .getByRole('listitem')
      .filter({ hasText: 'Accès aux services IA' });
    await step.getByRole('button', { name: 'Autoriser OpenAI', exact: true }).click();
    await expect(step).toContainText('Fait');
    await expect
      .poll(async () => (await (await page.request.get('/api/state')).json()).state.openaiBlocked)
      .toBe(false);
  } finally {
    // La base est partagée par toute la série : OpenAI autorisé, comme au départ.
    await page.request.post('/api/admin/openai', { headers: { origin }, data: { blocked: false } });
  }
});

test('une rubrique donnée dans l’adresse garde la priorité', async ({ page }) => {
  await login(page, '/admin#camera');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Caméra et reconnaissance' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#camera$/);
});

test('une étape à faire mène à la bonne rubrique', async ({ page }) => {
  await simulate(page, devices(null));
  await login(page);
  const camera = page
    .getByRole('list', { name: 'Étapes de la mise en route' })
    .getByRole('listitem')
    .filter({ hasText: 'Caméra choisie' });
  await expect(camera).toContainText('Choisissez la caméra du miroir.');
  await camera.getByRole('button', { name: 'Choisir la caméra' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Caméra et reconnaissance' }),
  ).toBeVisible();
});

test('quand tout est prêt, l’arrivée reste « Quand il écoute »', async ({ page }) => {
  await simulate(page, devices('cam'));
  await login(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Quand il écoute' })).toBeVisible();
  await expect(page).toHaveURL(/#voice$/);
  await page
    .getByRole('navigation', { name: 'Sections d’administration' })
    .getByRole('button', { name: 'Mise en route', exact: true })
    .click();
  await expect(page.getByText('Tout est prêt', { exact: true })).toBeVisible();
});
