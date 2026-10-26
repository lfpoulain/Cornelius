import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsForOpening, type Opening } from '../shared/opening.js';
import {
  adminBlockers,
  adminWaiting,
  manualStartAllowed,
  mirrorBlocker,
  READINESS_IDS,
  readinessChecklist,
  readinessComplete,
  type ReadinessDevices,
  type ReadinessInput,
  type ReadinessItem,
} from '../shared/readiness.js';
import type { MirrorState, VisionMode } from '../shared/types.js';

const profile = { id: 'profil-camille', name: 'Camille', createdAt: 1 };
const gaze: Opening = { trigger: 'gaze', audience: 'everyone', recognizeVoice: false };
const presenceMembers: Opening = {
  trigger: 'presence',
  audience: 'members',
  recognizeVoice: false,
};
const voiceAlone: Opening = { trigger: 'voice', audience: 'everyone', recognizeVoice: false };
const voiceMembers: Opening = { trigger: 'voice', audience: 'members', recognizeVoice: false };

type StatePatch = Omit<Partial<MirrorState>, 'session' | 'presence' | 'wakeWord'> & {
  session?: Partial<MirrorState['session']>;
  presence?: Partial<MirrorState['presence']>;
  wakeWord?: Partial<MirrorState['wakeWord']>;
};

/** Miroir prêt : clé, perception, navigateur et voix, une personne reconnue qui regarde. */
function mirror(opening: Opening = gaze, patch: StatePatch = {}): MirrorState {
  const settings = settingsForOpening(opening);
  // Caméra éteinte en veille pour « Cornelius » ouvert à tout le monde.
  const watching = settings.mode !== 4;
  const base: MirrorState = {
    setup: { openaiKey: true, perception: true },
    openaiBlocked: false,
    privacyMode: false,
    advancedAudioBuffer: false,
    delegationMode: 'fast',
    knownPeopleOnly: settings.knownPeopleOnly,
    voiceRecognition: settings.voiceRecognition,
    opening,
    wakeWord: { enabled: settings.wakeWord, ready: settings.wakeWord, detail: null },
    browserConnected: true,
    browserAudioReady: true,
    session: {
      phase: 'idle',
      reason: null,
      mode: settings.mode,
      interactionId: null,
      profileEpoch: 0,
      contextVersion: 0,
      startedAt: null,
      readyAt: null,
      manualStop: false,
      microphoneEnabled: false,
    },
    presence: watching
      ? {
          state: 'engaged',
          health: 'ok',
          peopleCount: 1,
          recognizedProfileIds: [profile.id],
          people: [{ trackId: 'piste', profileId: profile.id, engaged: true }],
          engagementId: 'regard',
          observedAt: 1,
        }
      : {
          state: 'absent',
          health: 'unavailable',
          peopleCount: 0,
          recognizedProfileIds: [],
          people: [],
          engagementId: null,
          observedAt: null,
        },
    activeProfile: watching ? profile : null,
    selection: 'automatic',
    profiles: [profile],
    cards: [],
    ambientDisplays: [],
    voice: { phase: 'idle', startedAt: 0, endsAt: null },
    diagnostic: null,
  };
  return {
    ...base,
    ...patch,
    session: { ...base.session, ...patch.session },
    presence: { ...base.presence, ...patch.presence },
    wakeWord: { ...base.wakeWord, ...patch.wakeWord },
  };
}

function devices(
  patch: {
    apiConfigured?: boolean;
    connected?: boolean;
    selectedId?: string | null;
    error?: string | null;
    available?: { id: string; label: string }[];
    vision?: VisionMode;
  } = {},
): ReadinessDevices {
  return {
    apiConfigured: patch.apiConfigured ?? true,
    perception: {
      connected: patch.connected ?? true,
      camera: {
        devices: patch.available ?? [{ id: 'webcam', label: 'Webcam du miroir' }],
        selectedId: patch.selectedId === undefined ? 'webcam' : patch.selectedId,
        error: patch.error ?? null,
      },
      vision: { mode: patch.vision ?? 'scene' },
    },
  };
}

function checklist(input: Partial<ReadinessInput> = {}) {
  const items = readinessChecklist({
    state: mirror(),
    devices: devices(),
    defaultPassword: false,
    enrolledFaces: 1,
    ...input,
  });
  return {
    items,
    item: (id: ReadinessItem['id']) => items.find((entry) => entry.id === id)!,
    statuses: Object.fromEntries(items.map((entry) => [entry.id, entry.status])),
  };
}

test('la liste couvre chaque étape une fois, dans un ordre stable', () => {
  const { items } = checklist();
  assert.deepEqual(
    items.map((entry) => entry.id),
    [...READINESS_IDS],
  );
  for (const entry of items) {
    assert.ok(entry.title.length > 0, entry.id);
    assert.ok(entry.detail.length > 0, entry.id);
    assert.doesNotMatch(entry.title + entry.detail, /[\u2013\u2014]|worker/u, entry.id);
  }
});

test('premier lancement : ni clé ni perception, rien ne se dit prêt', () => {
  const state = mirror(gaze, {
    setup: { openaiKey: false, perception: false },
    browserConnected: false,
    browserAudioReady: false,
    activeProfile: null,
    profiles: [],
    presence: {
      state: 'absent',
      health: 'unavailable',
      peopleCount: 0,
      recognizedProfileIds: [],
      people: [],
    },
  });
  const { items, item, statuses } = checklist({
    state,
    devices: devices({ apiConfigured: false, connected: false, selectedId: null }),
    defaultPassword: true,
    enrolledFaces: 0,
  });
  assert.deepEqual(statuses, {
    'openai-key': 'todo',
    perception: 'todo',
    camera: 'blocked',
    mirror: 'todo',
    voice: 'blocked',
    faces: 'optional',
    'wake-word': 'optional',
    'admin-password': 'todo',
    'openai-blocked': 'done',
  });
  assert.equal(readinessComplete(items), false);
  assert.match(item('openai-key').detail, /Clés et jetons/u);
  assert.match(item('perception').detail, /scripts\/start\.sh/u);
  assert.deepEqual(item('mirror').action, { kind: 'mirror' });
  assert.match(item('admin-password').detail, /Mot de passe administrateur/u);

  assert.deepEqual(mirrorBlocker(state, { fresh: true }), {
    id: 'openai-key',
    reason: 'Cornelius n’est pas encore configuré : ouvrez l’administration sur cet ordinateur.',
  });
  const blockers = adminBlockers(state, null);
  assert.deepEqual(
    blockers.map((blocker) => blocker.id),
    ['openai-key', 'mirror', 'perception'],
  );
  assert.equal(manualStartAllowed(blockers), false);
  assert.match(adminWaiting(state), /^Clé du fournisseur vocal absente/u);
});

test('sans état des périphériques, la liste lit la configuration diffusée au miroir', () => {
  const state = mirror(gaze, { setup: { openaiKey: false, perception: true } });
  const { statuses, item } = checklist({ state, devices: null });
  assert.equal(statuses['openai-key'], 'todo');
  assert.equal(statuses.perception, 'done');
  assert.equal(statuses.camera, 'blocked');
  assert.match(item('camera').detail, /en cours/u);
});

test('« Cornelius » pour tout le monde sans caméra : caméra facultative, perception exigée', () => {
  const ready = mirror(voiceAlone);
  const off = devices({ vision: 'off', selectedId: null, available: [] });
  const done = checklist({ state: ready, devices: off, enrolledFaces: 0 });
  assert.equal(done.statuses.camera, 'optional');
  assert.equal(done.statuses.faces, 'optional');
  assert.equal(done.statuses['wake-word'], 'done');
  assert.equal(readinessComplete(done.items), true);
  assert.equal(mirrorBlocker(ready, { fresh: true }), null);
  assert.deepEqual(adminBlockers(ready), []);
  assert.equal(adminWaiting(ready), 'En attente du mot d’appel « Cornelius ».');

  // Le mot d’appel est entendu par le service de perception : il reste nécessaire.
  const stopped = mirror(voiceAlone, {
    setup: { openaiKey: true, perception: false },
    wakeWord: { ready: false, detail: 'Perception locale déconnectée.' },
  });
  const pending = checklist({
    state: stopped,
    devices: devices({ connected: false, vision: 'off', selectedId: null }),
  });
  assert.equal(pending.statuses.perception, 'todo');
  assert.match(pending.item('perception').detail, /« Cornelius »/u);
  assert.equal(pending.statuses.camera, 'optional');
  assert.equal(pending.statuses['wake-word'], 'blocked');
  assert.equal(
    mirrorBlocker(stopped, { fresh: true })?.reason,
    'Écoute du mot « Cornelius » arrêtée : relancez Cornelius sur cet ordinateur.',
  );
  // À la voix, « Démarrer la session » n’attend pas le mot d’appel.
  const blockers = adminBlockers(stopped);
  assert.deepEqual(
    blockers.map((blocker) => blocker.id),
    ['perception'],
  );
  assert.equal(manualStartAllowed(blockers), true);

  // Reconnaissance ou vision pendant la conversation : la caméra sert de nouveau.
  for (const [state, vision] of [
    [mirror({ ...voiceAlone, recognizeVoice: true }), 'off'],
    [ready, 'scene'],
  ] as const) {
    const { statuses } = checklist({ state, devices: devices({ vision, selectedId: null }) });
    assert.equal(statuses.camera, 'todo');
  }
});

test('mot d’appel exigé mais modèle absent : signalé avec sa raison et sa documentation', () => {
  const state = mirror(voiceMembers, {
    wakeWord: { ready: false, detail: 'Modèle models/cornelius.onnx introuvable.' },
  });
  const { item } = checklist({ state });
  assert.equal(item('wake-word').status, 'todo');
  assert.equal(item('wake-word').detail, 'Modèle models/cornelius.onnx introuvable.');
  assert.deepEqual(item('wake-word').action, {
    kind: 'doc',
    path: 'docs/fonctionnalites/mot-d-appel.md',
  });
  assert.equal(
    mirrorBlocker(state, { fresh: true })?.reason,
    'Mot d’appel indisponible : son modèle n’est pas prêt sur cet ordinateur.',
  );
  const blockers = adminBlockers(state);
  assert.deepEqual(
    blockers.map((blocker) => [blocker.id, blocker.manualStart]),
    [['wake-word', true]],
  );
  assert.equal(adminWaiting(state), 'Modèle models/cornelius.onnx introuvable.');
});

test('ouverture réservée aux membres sans visage : enregistrer un visage est à faire', () => {
  const state = mirror(presenceMembers);
  const none = checklist({ state, enrolledFaces: 0 });
  assert.equal(none.statuses.faces, 'todo');
  assert.deepEqual(none.item('faces').action, { kind: 'section', section: 'profiles' });
  assert.match(none.item('faces').detail, /au moins un visage/u);
  assert.equal(readinessComplete(none.items), false);

  const empty = checklist({ state: mirror(presenceMembers, { profiles: [] }), enrolledFaces: 0 });
  assert.match(empty.item('faces').detail, /ajoutez une personne/u);

  const stopped = checklist({
    state: mirror(presenceMembers, { setup: { openaiKey: true, perception: false } }),
    devices: devices({ connected: false }),
    enrolledFaces: 0,
  });
  assert.equal(stopped.statuses.faces, 'blocked');

  const two = checklist({ state, enrolledFaces: 2 });
  assert.equal(two.statuses.faces, 'done');
  assert.equal(two.item('faces').detail, '2 visages enregistrés.');
});

test('mot de passe par défaut : seul point restant, signalé sans sa valeur', () => {
  const { items, item } = checklist({ defaultPassword: true });
  assert.equal(item('admin-password').status, 'todo');
  assert.doesNotMatch(item('admin-password').detail, /« cornelius »|=cornelius/u);
  assert.deepEqual(
    items
      .filter((entry) => entry.status === 'todo' || entry.status === 'blocked')
      .map((entry) => entry.id),
    ['admin-password'],
  );
});

test('caméra : erreur, absence de choix et absence de périphérique ont chacune leur consigne', () => {
  const error = 'La caméra mémorisée est absente. Choisissez une caméra disponible.';
  assert.equal(checklist({ devices: devices({ error }) }).item('camera').detail, error);
  assert.equal(
    checklist({ devices: devices({ selectedId: null }) }).item('camera').detail,
    'Choisissez la caméra du miroir.',
  );
  assert.match(
    checklist({ devices: devices({ selectedId: null, available: [] }) }).item('camera').detail,
    /Aucune caméra détectée/u,
  );
  assert.equal(checklist().item('camera').detail, 'Webcam du miroir');
});

test('tout est prêt : liste complète et aucun motif sur le miroir ni dans l’administration', () => {
  const state = mirror();
  const { items } = checklist({ state });
  assert.ok(items.every((entry) => entry.status === 'done' || entry.status === 'optional'));
  assert.equal(readinessComplete(items), true);
  assert.equal(mirrorBlocker(state, { fresh: true }), null);
  assert.deepEqual(adminBlockers(state, devices()), []);
  assert.equal(manualStartAllowed([]), true);
  assert.equal(adminWaiting(state), 'Démarrage automatique selon l’ouverture choisie.');
});

test('le miroir explique chaque blocage, dans l’ordre de l’administration', () => {
  const cases: [string, MirrorState, { fresh: boolean }, string][] = [
    [
      'connection',
      mirror(gaze, { setup: { openaiKey: false, perception: false } }),
      { fresh: false },
      'Connexion au serveur interrompue, reconnexion en cours.',
    ],
    [
      'openai-key',
      mirror(gaze, { setup: { openaiKey: false, perception: false }, openaiBlocked: true }),
      { fresh: true },
      'Cornelius n’est pas encore configuré : ouvrez l’administration sur cet ordinateur.',
    ],
    [
      'openai-blocked',
      mirror(gaze, { openaiBlocked: true, session: { manualStop: true } }),
      { fresh: true },
      'Accès aux services IA bloqué depuis l’administration.',
    ],
    [
      'manual-stop',
      mirror(gaze, { session: { manualStop: true }, privacyMode: true }),
      { fresh: true },
      'Conversation arrêtée depuis l’administration.',
    ],
    [
      'manual-stop',
      mirror(voiceAlone, { session: { manualStop: true } }),
      { fresh: true },
      'Conversation arrêtée depuis l’administration : dites « Cornelius » pour reprendre.',
    ],
    [
      'voice',
      mirror(gaze, { browserAudioReady: false, setup: { openaiKey: true, perception: false } }),
      { fresh: true },
      'Touchez « Activer la voix » pour autoriser le microphone.',
    ],
    [
      'perception',
      mirror(gaze, {
        setup: { openaiKey: true, perception: false },
        presence: { health: 'unavailable', state: 'absent', peopleCount: 0 },
      }),
      { fresh: true },
      'Service caméra arrêté : relancez Cornelius sur cet ordinateur.',
    ],
    [
      'camera',
      mirror(gaze, { presence: { health: 'unavailable', state: 'absent', peopleCount: 0 } }),
      { fresh: true },
      'Caméra du miroir indisponible : vérifiez-la dans l’administration.',
    ],
    [
      'privacy',
      mirror(gaze, { privacyMode: true, presence: { peopleCount: 2 } }),
      { fresh: true },
      'Conversation en pause : plusieurs personnes devant le miroir.',
    ],
    [
      'wake-word',
      mirror(voiceMembers, { wakeWord: { ready: false } }),
      { fresh: true },
      'Mot d’appel indisponible : son modèle n’est pas prêt sur cet ordinateur.',
    ],
    [
      'session',
      mirror(gaze, { session: { phase: 'blocked', reason: 'Contrôle Live indisponible.' } }),
      { fresh: true },
      // Jamais le motif technique du serveur sur l’écran du miroir.
      'Cornelius est momentanément indisponible : voir l’administration.',
    ],
    [
      'session',
      mirror(gaze, { session: { phase: 'blocked', reason: null } }),
      { fresh: true },
      'Cornelius est momentanément indisponible : voir l’administration.',
    ],
  ];
  for (const [id, state, connection, reason] of cases) {
    const blocker = mirrorBlocker(state, connection);
    assert.deepEqual(blocker, { id, reason }, id);
    // L’écran est visible de tous : jamais un prénom.
    assert.doesNotMatch(blocker!.reason, /Camille|[\u2013\u2014]/u, id);
  }
});

test('une conversation en cours n’affiche aucun blocage sur le miroir', () => {
  for (const phase of ['connecting', 'ready', 'closing'] as const)
    assert.equal(
      mirrorBlocker(mirror(gaze, { session: { phase }, privacyMode: true }), { fresh: true }),
      null,
    );
});

test('un ancien serveur sans configuration diffusée ne bloque pas le miroir à tort', () => {
  const state = mirror(gaze, { setup: undefined });
  assert.equal(mirrorBlocker(state, { fresh: true }), null);
  assert.deepEqual(
    adminBlockers(state, { apiConfigured: false }).map((blocker) => blocker.id),
    ['openai-key'],
  );
  assert.deepEqual(adminBlockers(state, { apiConfigured: true }), []);
});

test('l’administration garde la priorité et les conditions de démarrage de SessionControls', () => {
  const ids = (state: MirrorState) => adminBlockers(state).map((blocker) => blocker.id);
  assert.deepEqual(ids(mirror(gaze, { openaiBlocked: true, browserConnected: false })), [
    'openai-blocked',
    'mirror',
  ]);
  assert.deepEqual(ids(mirror(gaze, { browserAudioReady: false })), ['voice']);
  // Sans caméra, présence, reconnaissance et regard ne sont pas évalués.
  assert.deepEqual(
    ids(
      mirror(presenceMembers, {
        activeProfile: null,
        presence: { health: 'unavailable', state: 'absent', peopleCount: 0 },
      }),
    ),
    ['camera'],
  );
  assert.deepEqual(ids(mirror(gaze, { privacyMode: true, presence: { peopleCount: 2 } })), [
    'privacy',
  ]);
  assert.deepEqual(ids(mirror(presenceMembers, { activeProfile: null })), ['recognition']);
  assert.deepEqual(ids(mirror(gaze, { presence: { state: 'present' } })), ['engagement']);
  assert.deepEqual(
    ids(
      mirror(
        { trigger: 'presence', audience: 'everyone', recognizeVoice: false },
        {
          presence: { state: 'absent', peopleCount: 0 },
        },
      ),
    ),
    ['presence'],
  );
  // L’arrêt manuel se lève par « Démarrer » : ce n’est pas un motif de blocage.
  assert.deepEqual(ids(mirror(gaze, { session: { manualStop: true } })), []);
  // Membres au mot d’appel : la caméra veille, et le mot d’appel n’empêche pas « Démarrer ».
  const members = adminBlockers(mirror(voiceMembers, { wakeWord: { ready: false } }));
  assert.equal(manualStartAllowed(members), true);
  assert.equal(
    manualStartAllowed(adminBlockers(mirror(presenceMembers, { activeProfile: null }))),
    false,
  );
});
