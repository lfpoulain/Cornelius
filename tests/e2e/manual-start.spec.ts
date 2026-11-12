import { test, expect, type WebSocketRoute } from '@playwright/test';
import type { DevicesStatus, MirrorState, StateEvent } from '../../shared/types';
import { login } from './env';

type StatePatch = Omit<Partial<MirrorState>, 'session' | 'presence'> & {
  session?: Partial<MirrorState['session']>;
  presence?: Partial<MirrorState['presence']>;
};

test('le démarrage manuel respecte chaque mode et les blocages communs', async ({ page }) => {
  const profile = { id: 'manual-start-profile', name: 'Camille', createdAt: 1 };
  const baseline: MirrorState = {
    openaiBlocked: false,
    privacyMode: false,
    advancedAudioBuffer: false,
    delegationMode: 'fast',
    wakeWord: { enabled: false, ready: false, detail: null },
    browserConnected: true,
    session: {
      phase: 'idle',
      reason: null,
      mode: 3,
      interactionId: null,
      profileEpoch: 0,
      contextVersion: 0,
      startedAt: null,
      readyAt: null,
      manualStop: true,
      microphoneEnabled: false,
    },
    presence: {
      state: 'engaged',
      health: 'ok',
      peopleCount: 1,
      people: [{ trackId: 'person', profileId: profile.id, engaged: true }],
      engagementId: 'engagement',
      observedAt: Date.now(),
    },
    activeProfile: profile,
    selection: 'automatic',
    profiles: [profile],
    cards: [],
    ambientDisplays: [],
    voice: { phase: 'idle', startedAt: 0, endsAt: null },
    diagnostic: null,
  };
  const devices: DevicesStatus = {
    apiConfigured: true,
    perceptionConfigured: true,
    defaultPassword: false,
    enrolledFaces: 1,
    perception: {
      connected: true,
      camera: { devices: [], selectedId: null, changing: false, error: null },
      recognitionThreshold: 0.42,
      engagement: { poseTolerance: 0.3, minFaceRatio: 0.14 },
      enrollingProfileId: null,
      enrolledProfileIds: [profile.id],
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
  let snapshot: StateEvent = {
    schemaVersion: 1,
    type: 'state',
    bootId: 'manual-start-fixture',
    sequence: 1,
    sentAt: Date.now(),
    interactionId: null,
    profileEpoch: 0,
    contextVersion: 0,
    state: baseline,
  };
  let socket: WebSocketRoute | undefined;
  const commands: unknown[] = [];
  const publish = () => {
    socket?.send(JSON.stringify(snapshot));
    socket?.send(JSON.stringify({ schemaVersion: 1, type: 'devices', status: devices }));
  };
  // The browser receives simulated presence only. Neither the server controller
  // nor an OpenAI session sees the start commands exercised by this test.
  await page.routeWebSocket('**/events?role=admin', (route) => {
    socket = route;
    publish();
  });
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.route('**/api/admin/devices', (route) => route.fulfill({ json: devices }));
  await page.route('**/api/commands', async (route) => {
    commands.push(route.request().postDataJSON());
    await route.fulfill({ json: snapshot });
  });

  await login(page, '/admin');
  await page.getByRole('button', { name: 'Quand il écoute' }).click();
  const start = page.getByRole('button', { name: 'Démarrer la session', exact: true });
  await expect(start).toBeEnabled();

  const scenarios: {
    name: string;
    patch: StatePatch;
    enabled: boolean;
    apiConfigured?: boolean;
  }[] = [
    {
      name: 'mode 1, présence sans identité ni engagement',
      patch: { session: { mode: 1 }, presence: { state: 'present' }, activeProfile: null },
      enabled: true,
    },
    {
      name: 'mode 1, absence',
      patch: {
        session: { mode: 1 },
        presence: { state: 'absent', peopleCount: 0 },
        activeProfile: null,
      },
      enabled: false,
    },
    {
      name: 'mode 2, profil reconnu sans engagement',
      patch: { session: { mode: 2 }, presence: { state: 'present' } },
      enabled: true,
    },
    {
      name: 'mode 2, profil inconnu',
      patch: { session: { mode: 2 }, presence: { state: 'present' }, activeProfile: null },
      enabled: false,
    },
    {
      name: 'mode 3, profil reconnu mais sans engagement',
      patch: { presence: { state: 'present' } },
      enabled: false,
    },
    { name: 'mode 3, personne engagée', patch: {}, enabled: true },
    { name: 'OpenAI bloqué', patch: { openaiBlocked: true }, enabled: false },
    {
      name: 'vie privée avec deux personnes',
      patch: { privacyMode: true, presence: { peopleCount: 2 } },
      enabled: false,
    },
    { name: 'vie privée avec une seule personne', patch: { privacyMode: true }, enabled: true },
    {
      name: 'deux personnes sans vie privée en mode détection',
      patch: {
        session: { mode: 1 },
        presence: { state: 'present', peopleCount: 2 },
        activeProfile: null,
      },
      enabled: true,
    },
    {
      name: 'perception indisponible',
      patch: { presence: { health: 'unavailable' } },
      enabled: false,
    },
    { name: 'navigateur kiosque déconnecté', patch: { browserConnected: false }, enabled: false },
    { name: 'microphone non autorisé', patch: { browserAudioReady: false }, enabled: false },
    { name: 'clé OpenAI absente', patch: {}, apiConfigured: false, enabled: false },
    ...(['connecting', 'ready', 'closing'] as const).map((phase) => ({
      name: `session ${phase}`,
      patch: { session: { phase } },
      enabled: false,
    })),
  ];
  for (const scenario of scenarios) {
    await test.step(scenario.name, async () => {
      const reason = `Vérification : ${scenario.name}`;
      snapshot = {
        ...snapshot,
        sequence: snapshot.sequence + 1,
        sentAt: Date.now(),
        state: {
          ...baseline,
          ...scenario.patch,
          session: { ...baseline.session, ...scenario.patch.session, reason },
          presence: { ...baseline.presence, ...scenario.patch.presence },
        },
      };
      devices.apiConfigured = scenario.apiConfigured ?? true;
      publish();
      await expect(page.getByText(reason, { exact: true })).toBeVisible();
      if (scenario.enabled) {
        await expect(start).toBeEnabled();
        const before = commands.length;
        await start.click();
        await expect.poll(() => commands.length).toBe(before + 1);
        expect(commands.at(-1)).toEqual({ type: 'start' });
      } else {
        await expect(start).toBeDisabled();
      }
    });
  }
});
