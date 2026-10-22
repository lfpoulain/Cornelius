import { expect, test, type Page } from '@playwright/test';
import type { DevicesStatus, MirrorState, StateEvent } from '../../shared/types';

async function login(page: Page, path: string) {
  await page.goto(path);
  await page
    .getByLabel('Mot de passe administrateur')
    .fill('admin-browser-test-only-credentials-1234');
  await page.getByRole('button', { name: 'Ouvrir cet espace' }).click();
}

const baseline: MirrorState = {
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

const devices = {
  apiConfigured: true,
  perceptionConfigured: true,
  defaultPassword: false,
  enrolledFaces: 0,
  perception: {
    connected: true,
    camera: {
      devices: [{ id: 'cam', label: 'Caméra' }],
      selectedId: 'cam',
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
} satisfies DevicesStatus;

/** Le navigateur reçoit un état simulé ; ni le serveur ni OpenAI ne sont sollicités. */
async function simulate(page: Page, state: MirrorState) {
  const snapshot: StateEvent = {
    schemaVersion: 1,
    type: 'state',
    bootId: 'session-controls-fixture',
    sequence: 1,
    sentAt: Date.now(),
    interactionId: null,
    profileEpoch: 0,
    contextVersion: 0,
    state,
  };
  await page.routeWebSocket('**/events?role=admin', (route) => {
    route.send(JSON.stringify(snapshot));
    route.send(JSON.stringify({ schemaVersion: 1, type: 'devices', status: devices }));
  });
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
}

test('une configuration incomplète est dite telle quelle, avec le chemin vers la mise en route', async ({
  page,
}) => {
  await login(page, '/admin#modules');
  const panel = page.getByRole('region', { name: 'Conversation' });
  // Hors « Mise en route » et « Quand il écoute », le panneau tient sur une ligne.
  await expect(panel).toHaveAttribute('data-compact', 'true');
  // Le bandeau se répète sur chaque rubrique : un paragraphe, pas un titre sous le h1.
  await expect(panel.getByRole('heading')).toHaveCount(0);
  await expect(panel.getByText('Configuration à terminer', { exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute('data-tone', 'warning');
  const start = panel.getByRole('button', { name: 'Démarrer la session', exact: true });
  await expect(start).toBeDisabled();
  await expect(start).toHaveAccessibleDescription(/^Clé du fournisseur vocal absente/);
  await expect(panel.getByRole('button', { name: 'Bloquer les services IA' })).toHaveCount(0);
  await panel.getByRole('link', { name: /^Voir la mise en route \(\d+\)$/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mise en route' })).toBeVisible();
  // Sur « Mise en route », le panneau reste compact et ne répète pas les étapes.
  const onStart = page.getByRole('region', { name: 'Conversation' });
  await expect(onStart).toHaveAttribute('data-compact', 'true');
  await expect(onStart.getByRole('link', { name: /Voir la mise en route/ })).toHaveCount(0);
  await expect(onStart).toContainText('Terminez les étapes ci-dessous pour pouvoir démarrer.');
  await expect(onStart).not.toContainText('OPENAI_API_KEY');
  // Seule « Quand il écoute » montre le panneau complet.
  await page.getByRole('button', { name: 'Quand il écoute', exact: true }).click();
  const full = page.getByRole('region', { name: 'Conversation' });
  await expect(full).not.toHaveAttribute('data-compact', 'true');
  await expect(full.getByRole('heading')).toHaveCount(0);
  await expect(full.getByRole('button', { name: 'Bloquer les services IA', exact: true })).toBeVisible();
});

test('« Cornelius » pour tout le monde : la caméra est dite en veille', async ({ page }) => {
  await simulate(page, {
    ...baseline,
    opening: { trigger: 'voice', audience: 'everyone', recognizeVoice: false },
    wakeWord: { enabled: true, ready: true, detail: null },
    session: { ...baseline.session, mode: 4 },
    presence: { ...baseline.presence, health: 'unavailable' },
  });
  await login(page, '/admin#voice');
  const panel = page.getByRole('region', { name: 'Conversation' });
  await expect(panel.getByText('En veille attentive', { exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute('data-tone', 'ok');
  await expect(panel.getByText('caméra en veille', { exact: true })).toBeVisible();
  await expect(panel.getByText('non identifiée', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('à l’écoute', { exact: true })).toBeVisible();
});

test('une caméra indisponible est expliquée en une phrase', async ({ page }) => {
  await simulate(page, { ...baseline, presence: { ...baseline.presence, health: 'unavailable' } });
  await login(page, '/admin#voice');
  const panel = page.getByRole('region', { name: 'Conversation' });
  await expect(panel.getByText('Configuration à terminer', { exact: true })).toBeVisible();
  await expect(
    panel.getByText(
      'Le service caméra (perception) n’est pas lancé ou la caméra est indisponible.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(panel.getByText('indisponible', { exact: true })).toHaveCount(0);
  // Le micro se dit en phrase, comme la caméra.
  const micro = panel.getByRole('definition').filter({ hasText: 'en attente de la conversation' });
  await expect(micro).toHaveText('Prêt, en attente de la conversation.');
});
