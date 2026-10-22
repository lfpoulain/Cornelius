import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { ImageCard, LunaCardRequest, PerceptionObservation, Scope } from '../shared/types.js';
import { SessionController, type SessionTransport } from '../server/controller.js';
import { openDatabase, ProfileRepository, SessionPreferences } from '../server/storage.js';

const card: LunaCardRequest = {
  schemaVersion: 1,
  cardType: 'luna',
  title: 'Prochain bus',
  primaryValue: '5 min',
  subtitle: null,
  description: 'Donnée d’exemple',
  items: [],
  sources: [],
};

class Transport implements SessionTransport {
  opened: Scope[] = [];
  closed: string[] = [];
  identified: Scope[] = [];
  prewarmed = 0;
  reason: string | null = null;
  metered = false;

  prewarm(): void {
    this.prewarmed++;
  }

  meteredByDuration(): boolean {
    return this.metered;
  }
  unavailableReason(): string | null {
    return this.reason;
  }
  open(scope: Scope): void {
    this.opened.push(structuredClone(scope));
  }
  close(interactionId: string): void {
    this.closed.push(interactionId);
  }
  identify(scope: Scope): void {
    this.identified.push(structuredClone(scope));
  }
}

function fixture(t: TestContext) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let now = Date.parse('2026-09-16T10:00:00Z');
  const clock = () => now;
  const profiles = new ProfileRepository(db);
  const alice = profiles.create('Alice');
  const bob = profiles.create('Bob');
  const transport = new Transport();
  const preferences = new SessionPreferences(db);
  const measures: { name: string; details: Record<string, unknown> }[] = [];
  const controller = new SessionController(
    profiles,
    transport,
    clock,
    preferences,
    (name, details) => measures.push({ name, details }),
  );
  let input: PerceptionObservation = {
    schemaVersion: 1,
    producerBootId: 'camera-1',
    sequence: 0,
    observedAt: now,
    health: 'ok',
    presence: true,
    engaged: true,
    people: [{ trackId: 'visitor', profileId: null }],
  };
  function observe(overrides: Partial<PerceptionObservation> = {}) {
    input = { ...input, sequence: input.sequence + 1, observedAt: now, ...overrides };
    return controller.observe(input);
  }
  function advance(ms: number, options: { sensor?: boolean; browser?: boolean } = {}) {
    let remaining = ms;
    while (remaining > 0) {
      const step = Math.min(remaining, 1000);
      now += step;
      if (options.browser !== false) controller.heartbeat();
      if (options.sensor !== false) observe();
      controller.tick();
      remaining -= step;
    }
  }
  function engage(profileIds: (string | null)[] = [null]) {
    controller.heartbeat();
    observe({
      health: 'ok',
      presence: true,
      engaged: true,
      people: profileIds.map((profileId, index) => ({ trackId: `person-${index}`, profileId })),
    });
    advance(400);
    return controller.scope();
  }
  function ready() {
    const scope = controller.scope();
    controller.sessionStarted(scope);
    controller.controlAttached(scope);
    assert.equal(controller.snapshot().state.session.phase, 'ready');
    return scope;
  }
  function acknowledgeClose() {
    const id = controller.scope().interactionId;
    assert.ok(id);
    controller.sessionClosed(id);
  }
  return {
    db,
    measures,
    controller,
    profiles,
    alice,
    bob,
    transport,
    clock,
    observe,
    advance,
    engage,
    ready,
    acknowledgeClose,
    state: () => controller.snapshot().state,
    jump: (ms: number) => {
      now += ms;
    },
    lastObservation: () => structuredClone(input),
  };
}

test('engagement stabilisé : une seule session réservée, prête après les deux confirmations', (t) => {
  const f = fixture(t);
  f.controller.heartbeat();
  f.observe();
  f.advance(399);
  assert.equal(f.transport.opened.length, 0);
  f.advance(1);
  assert.equal(f.transport.opened.length, 1);
  assert.equal(f.state().session.phase, 'connecting');
  const scope = f.controller.scope();
  f.controller.controlAttached(scope);
  assert.equal(f.state().session.phase, 'connecting');
  f.controller.sessionStarted(scope);
  assert.equal(f.state().session.phase, 'ready');
  f.observe();
  f.controller.command({ type: 'start' });
  f.controller.command({ type: 'start' });
  assert.equal(f.transport.opened.length, 1);
  assert.equal(f.controller.showCard(scope, 'bus-card', card, f.clock() + 30_000), true);
  assert.equal(f.state().cards.length, 1);
  assert.equal(f.state().session.microphoneEnabled, true);
});

test('un transport indisponible bloque l’ouverture sans démarrer de session', (t) => {
  const f = fixture(t);
  f.transport.reason = 'Connexions OpenAI bloquées dans l’administration.';
  f.engage();
  f.controller.command({ type: 'start' });
  assert.equal(f.state().session.phase, 'blocked');
  assert.equal(f.state().session.reason, 'Connexions OpenAI bloquées dans l’administration.');
  assert.equal(f.transport.opened.length, 0);
});

test('cartes : fraîcheur, déduplication et portée sont vérifiées', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  const scope = f.ready();
  assert.equal(f.controller.showCard(scope, 'expired', card, f.clock()), false);
  assert.equal(f.controller.showCard(scope, 'invalid-date', card, Number.NaN), false);
  assert.equal(
    f.controller.showCard(
      { ...scope, profileEpoch: scope.profileEpoch + 1 },
      'other-profile',
      card,
      f.clock() + 1000,
    ),
    false,
  );
  assert.equal(f.controller.showCard(scope, 'once', card, f.clock() + 1000), true);
  assert.equal(f.controller.showCard(scope, 'once', card, f.clock() + 1000), false);
  assert.equal(f.state().cards.length, 1);
  f.advance(1000);
  assert.equal(f.state().cards.length, 0);
});

test('module Cartes : nombre de cartes et délai de disparition appliqués tout de suite', (t) => {
  const f = fixture(t);
  f.engage();
  const scope = f.ready();
  for (const key of ['a', 'b', 'c'])
    assert.equal(f.controller.showCard(scope, key, card, f.clock() + 600_000), true);
  assert.equal(f.state().cards.length, 3);
  assert.equal(f.state().cards[0]!.expiresAt, f.clock() + 60_000);
  f.controller.setCardSettings({ maxCards: 2, compactSecondary: false, lifetimeMs: 30_000 });
  assert.equal(f.state().cards.length, 2);
  assert.equal(f.state().cards[0]!.expiresAt, f.clock() + 30_000);
  assert.equal(f.state().cardSettings?.compactSecondary, false);
  assert.equal(f.controller.showCard(scope, 'd', card, f.clock() + 600_000), true);
  assert.equal(f.state().cards.length, 2);
  f.advance(31_000);
  assert.equal(f.state().cards.length, 0);
});

test('une image créée par OpenAI (1024 × 1024) s’affiche comme une image locale', (t) => {
  const f = fixture(t);
  f.engage();
  const scope = f.ready();
  const image: ImageCard = {
    schemaVersion: 1,
    cardType: 'image',
    title: 'Image générée',
    prompt: 'Un phare dans la brume',
    imageUrl: '/api/generated-images/22222222-2222-4222-8222-222222222222.webp',
    model: 'gpt-image-2.5-flare',
    width: 1024,
    height: 1024,
    primaryValue: null,
    subtitle: null,
    description: null,
    items: [],
    sources: [],
  };
  assert.equal(f.controller.showImageCard(scope, 'openai-image', image, f.clock() + 60_000), true);
  assert.equal(f.state().cards[0]?.content.cardType, 'image');
  assert.equal(
    f.controller.showImageCard(scope, 'odd-size', { ...image, width: 700 }, f.clock() + 60_000),
    false,
  );
});

test('une illustration reste secondaire et ne rejoint pas une nouvelle carte principale', (t) => {
  const f = fixture(t);
  f.engage();
  const scope = f.ready();
  const image: ImageCard = {
    schemaVersion: 1,
    cardType: 'image',
    title: 'Illustration',
    prompt: 'Illustration du prochain bus',
    imageUrl: '/api/generated-images/11111111-1111-4111-8111-111111111111.webp',
    model: 'sana-sprint-0.6b',
    width: 512,
    height: 512,
    primaryValue: null,
    subtitle: null,
    description: null,
    items: [],
    sources: [],
  };
  assert.equal(f.controller.showCard(scope, 'source', card, f.clock() + 60_000), true);
  const source = f.state().cards[0]!;
  const originalExpiry = f.controller.holdCardForIllustration(
    scope,
    source.id,
    f.clock() + 240_000,
  );
  assert.equal(originalExpiry, source.expiresAt);
  f.advance(61_000);
  assert.equal(f.state().cards[0]?.id, source.id);
  assert.equal(
    f.controller.showIllustrationCard(scope, 'illustration', source.id, image, f.clock() + 60_000),
    true,
  );
  f.controller.releaseCardIllustration(scope, source.id, originalExpiry!, true);
  assert.deepEqual(
    f.state().cards.map((entry) => entry.content.cardType),
    ['luna', 'image'],
  );
  assert.equal(
    f.controller.showCard(scope, 'next', { ...card, title: 'Nouvelle carte' }, f.clock() + 60_000),
    true,
  );
  assert.equal(
    f.controller.showIllustrationCard(scope, 'late', source.id, image, f.clock() + 60_000),
    false,
  );
  assert.equal(f.state().cards[0]?.content.title, 'Nouvelle carte');
});

test('un changement de profil retire les cartes et invalide les réponses tardives', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  const old = f.ready();
  assert.equal(f.controller.showCard(old, 'private', card, f.clock() + 60_000), true);
  f.observe({
    people: [
      { trackId: 'alice', profileId: f.alice.id },
      { trackId: 'bob', profileId: f.bob.id },
    ],
  });
  f.controller.command({ type: 'select_profile', profileId: f.bob.id });
  assert.equal(f.state().activeProfile?.id, f.bob.id);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().cards.length, 0);
  assert.equal(f.controller.showCard(old, 'late', card, f.clock() + 60_000), false);
  f.controller.sessionStarted(old);
  f.controller.controlAttached(old);
  assert.equal(f.state().session.phase, 'closing');
  f.acknowledgeClose();
  const next = f.controller.scope();
  assert.notEqual(next.interactionId, old.interactionId);
  assert.ok(next.profileEpoch > old.profileEpoch);
  f.controller.sessionClosed(old.interactionId!);
  f.controller.sessionStarted(old);
  f.controller.controlAttached(old);
  assert.equal(f.state().session.phase, 'connecting');
  f.ready();
  assert.equal(f.controller.showCard(old, 'later', card, f.clock() + 60_000), false);
  assert.equal(f.controller.showCard(next, 'current', card, f.clock() + 60_000), true);
  assert.equal(f.state().cards[0]?.profileId, f.bob.id);
});

test('la première personne reconnue garde son profil ; un choix explicite reste prioritaire', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  assert.equal(f.state().selection, 'automatic');
  // La première personne reconnue garde son profil malgré une deuxième personne.
  f.observe({
    people: [
      { trackId: 'alice', profileId: f.alice.id },
      { trackId: 'bob', profileId: f.bob.id },
    ],
  });
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().selection, 'automatic');
  assert.equal(f.state().session.phase, 'ready');
  // Un choix explicite reste prioritaire même quand d'autres personnes apparaissent.
  f.controller.command({ type: 'select_profile', profileId: f.alice.id });
  assert.equal(f.state().selection, 'explicit');
  f.observe({
    people: [
      { trackId: 'alice', profileId: f.alice.id },
      { trackId: 'bob', profileId: f.bob.id },
      { trackId: 'visitor', profileId: null },
    ],
  });
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  f.observe({ people: [{ trackId: 'bob', profileId: f.bob.id }] });
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().selection, 'explicit');
  assert.equal(f.state().session.phase, 'ready');
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(8000);
  assert.equal(f.state().activeProfile, null);
  assert.equal(f.state().session.phase, 'closing');
});

test('une conversation continue reste ouverte tant que l’engagement tient', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  f.controller.command({ type: 'start' });
  assert.equal(f.transport.opened.length, 1);
  f.advance(100_000);
  assert.equal(f.state().session.phase, 'ready');
  assert.equal(f.transport.closed.length, 0);
  f.observe({ engaged: false });
  f.advance(8000);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Fin d’engagement.');
});

test('l’arrêt manuel reste actif après un départ et un nouvel engagement', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  f.controller.command({ type: 'stop' });
  f.acknowledgeClose();
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(3000);
  f.engage();
  assert.equal(f.transport.opened.length, 1);
  assert.equal(f.state().session.manualStop, true);
  f.controller.command({ type: 'start' });
  assert.equal(f.transport.opened.length, 2);
  assert.equal(f.state().session.manualStop, false);
});

test('une observation rejouée ne rafraîchit pas un capteur bloqué', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  const last = f.lastObservation();
  f.jump(1999);
  f.controller.heartbeat();
  assert.equal(f.controller.observe({ ...last, observedAt: f.clock() }), false);
  f.controller.tick();
  assert.equal(f.state().session.phase, 'ready');
  f.jump(1);
  f.controller.tick();
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().presence.health, 'unavailable');
  assert.equal(f.transport.closed.length, 1);
  assert.equal(f.controller.observe({ ...last, sequence: last.sequence + 1 }), false);
  assert.equal(
    f.controller.observe({ ...last, sequence: last.sequence + 1, observedAt: f.clock() + 5000 }),
    false,
  );
});

test('un redémarrage capteur retire le profil et refuse ensuite les anciens producteurs', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.observe({ producerBootId: 'camera-2', sequence: 0 });
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().activeProfile, null);
  assert.equal(
    f.controller.observe({ ...f.lastObservation(), producerBootId: 'camera-1', sequence: 500 }),
    false,
  );
});

test('la disparition du navigateur ferme une session malgré des observations fraîches', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  f.advance(4999, { browser: false });
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1, { browser: false });
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.transport.closed.length, 1);
});

test('une connexion incomplète reste fermée après une confirmation tardive', (t) => {
  const f = fixture(t);
  const scope = f.engage();
  f.controller.sessionStarted(scope);
  f.advance(5000);
  assert.equal(f.state().session.phase, 'closing');
  f.controller.controlAttached(scope);
  assert.equal(f.state().session.phase, 'closing');
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'idle');
});

test('une perte courte d’engagement est tolérée, une perte durable ferme la session', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  f.observe({ engaged: false });
  f.advance(7999);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1);
  assert.equal(f.state().session.phase, 'closing');
});

test('une clôture non confirmée ne bloque pas le contrôleur et permet une nouvelle session', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.controller.close('Réseau perdu.');
  f.advance(5000);
  assert.equal(f.state().session.phase, 'idle');
  assert.equal(f.state().session.reason, 'Clôture non confirmée.');
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(3000);
  f.observe({
    presence: true,
    engaged: true,
    people: [{ trackId: 'person-0', profileId: f.alice.id }],
  });
  f.advance(800);
  assert.equal(f.state().session.phase, 'connecting');
  assert.equal(f.transport.opened.length, 2);
});

test('une confirmation tardive ne rend pas la session prête avant le passage du watchdog', (t) => {
  const f = fixture(t);
  const scope = f.engage();
  f.controller.sessionStarted(scope);
  f.jump(5000);
  f.controller.heartbeat();
  f.observe();
  f.controller.controlAttached(scope);
  assert.notEqual(f.state().session.phase, 'ready');
});

test('le choix explicite d’un profil existant est possible sans reconnaissance faciale', (t) => {
  const f = fixture(t);
  f.controller.command({ type: 'select_profile', profileId: f.alice.id });
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().selection, 'explicit');
  assert.equal(f.transport.opened.length, 0);
  f.engage();
  f.ready();
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.throws(() => f.controller.command({ type: 'select_profile', profileId: 'missing' }));
});

for (const guard of ['sensor', 'browser'] as const) {
  test(`la confirmation revalide ${guard} avant d’annoncer l’écoute`, (t) => {
    const f = fixture(t);
    const scope = f.engage();
    f.controller.sessionStarted(scope);
    if (guard === 'sensor') {
      f.jump(2000);
      f.controller.heartbeat();
    } else {
      f.jump(5000);
      f.observe();
    }
    f.controller.controlAttached(scope);
    assert.equal(f.state().session.phase, 'closing');
    assert.equal(f.transport.closed.length, 1);
  });
}

test('l’arrêt manuel survit au redémarrage et exige une réactivation explicite', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  f.controller.command({ type: 'stop' });
  f.acknowledgeClose();

  const preferences = new SessionPreferences(f.db);
  const transport = new Transport();
  const restarted = new SessionController(f.profiles, transport, f.clock, preferences);
  assert.equal(restarted.snapshot().state.session.manualStop, true);
  restarted.heartbeat();
  const observation = f.lastObservation();
  restarted.observe(observation);
  f.jump(800);
  restarted.heartbeat();
  restarted.observe({ ...observation, sequence: observation.sequence + 1, observedAt: f.clock() });
  restarted.tick();
  assert.equal(restarted.snapshot().state.presence.state, 'engaged');
  assert.equal(transport.opened.length, 0);

  restarted.command({ type: 'start' });
  assert.equal(transport.opened.length, 1);
  assert.equal(restarted.snapshot().state.session.manualStop, false);
  assert.equal(new SessionPreferences(f.db).getManualStop(), false);
});

test('les observations inchangées ne republient pas, mais une panne expire toujours la présence', (t) => {
  const f = fixture(t);
  const events: unknown[] = [];
  f.controller.subscribe((event) => events.push(event));
  f.controller.command({ type: 'stop' });
  f.engage();
  const sequence = f.controller.snapshot().sequence;
  events.length = 0;
  f.advance(10_000);
  assert.equal(events.length, 0);
  assert.equal(f.controller.snapshot().sequence, sequence);
  f.advance(2100, { sensor: false });
  assert.equal(f.state().presence.health, 'unavailable');
  assert.ok(events.length > 0);
  const count = events.length;
  f.advance(2000, { sensor: false });
  assert.equal(events.length, count);
});

test('le profil réel résiste à une brève occultation, mais pas à une autre personne ni à une absence durable', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  const epoch = f.controller.scope().profileEpoch;
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(300);
  assert.equal(f.controller.snapshot().state.activeProfile?.id, f.alice.id);
  f.observe({
    presence: true,
    engaged: true,
    people: [{ trackId: 'person-0', profileId: f.alice.id }],
  });
  assert.equal(f.controller.scope().profileEpoch, epoch);
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(100);
  // Un nouveau suivi encore inconnu laisse à la reconnaissance le délai de départ.
  f.observe({ presence: true, engaged: true, people: [{ trackId: 'newcomer', profileId: null }] });
  f.advance(800);
  assert.equal(f.controller.snapshot().state.activeProfile?.id, f.alice.id);
  assert.equal(f.controller.scope().profileEpoch, epoch);
  f.advance(700);
  assert.equal(f.controller.snapshot().state.activeProfile, null);
  f.observe({ people: [{ trackId: 'person-0', profileId: f.alice.id }] });
  assert.equal(f.controller.snapshot().state.activeProfile?.id, f.alice.id);
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(1501);
  assert.equal(f.controller.snapshot().state.activeProfile, null);
});

test('un nouveau suivi du même visage reconnu à temps ne coupe pas la conversation', (t) => {
  for (const mode of [1, 2, 3] as const) {
    const f = fixture(t);
    f.controller.setSessionMode(mode);
    f.engage([f.alice.id]);
    const scope = f.ready();
    f.observe({ people: [{ trackId: 'retracked', profileId: null }] });
    f.advance(600);
    f.observe({ people: [{ trackId: 'retracked', profileId: f.alice.id }] });
    f.advance(1000);
    assert.equal(f.state().session.phase, 'ready', 'mode ' + mode);
    assert.deepEqual(f.controller.scope(), scope);
    assert.equal(f.transport.opened.length, 1);
  }
});

test('le même visage suivi garde son profil pendant le maintien puis le perd si l’identité ne revient pas', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  const scope = f.ready();
  f.observe({ people: [{ trackId: 'person-0', profileId: null }] });
  f.advance(7000);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().session.phase, 'ready');
  assert.deepEqual(f.controller.scope(), scope);
  f.advance(1001);
  assert.equal(f.state().activeProfile, null);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Changement de profil.');
});

test('une autre personne reconnue remplace aussitôt le profil, sans attendre le délai', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.observe({ people: [{ trackId: 'bob', profileId: f.bob.id }] });
  assert.equal(f.state().activeProfile?.id, f.bob.id);
  assert.equal(f.state().session.phase, 'closing');
});

test('une image sans détection ne fait pas disparaître l’orbe pendant la grâce', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(1200);
  assert.equal(f.state().presence.state, 'engaged');
  assert.equal(f.state().presence.peopleCount, 1);
  assert.deepEqual(f.state().presence.recognizedProfileIds, [f.alice.id]);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  f.observe({
    presence: true,
    engaged: true,
    people: [{ trackId: 'person-0', profileId: f.alice.id }],
  });
  assert.equal(f.state().presence.state, 'engaged');
  assert.equal(f.state().session.phase, 'ready');
});

test('après la grâce, une absence durable éteint la présence', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(8000);
  assert.equal(f.state().presence.state, 'absent');
  assert.equal(f.state().presence.peopleCount, 0);
});

test('tourner la tête ne coupe pas une conversation réelle, quitter durablement le miroir oui', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  const scope = f.controller.scope();
  f.observe({ engaged: false });
  f.advance(4500);
  assert.equal(f.state().session.phase, 'ready');
  assert.deepEqual(f.controller.scope(), scope);
  assert.equal(f.state().presence.peopleCount, 1);
  assert.deepEqual(f.state().presence.recognizedProfileIds, [f.alice.id]);
  f.observe({ engaged: true });
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(1200);
  assert.equal(f.state().session.phase, 'ready');
  f.observe({
    presence: true,
    engaged: true,
    people: [{ trackId: 'person-0', profileId: f.alice.id }],
  });
  assert.deepEqual(f.controller.scope(), scope);
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(8000);
  assert.equal(f.state().session.phase, 'closing');
});

test('la première personne garde son profil ; le mode vie privée ferme à deux', (t) => {
  const f = fixture(t);
  assert.equal(f.state().privacyMode, false);
  f.engage([f.alice.id]);
  f.ready();
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  // Sans vie privée, le profil de la première personne reste actif.
  f.observe({
    people: [
      { trackId: 'alice', profileId: f.alice.id },
      { trackId: 'bob', profileId: f.bob.id },
    ],
  });
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().session.phase, 'ready');

  // Le mode vie privée ferme la session dès qu'une deuxième personne est présente.
  f.controller.setPrivacyMode(true);
  assert.equal(f.state().privacyMode, true);
  assert.equal(new SessionPreferences(f.db).getPrivacyMode(), true);
  assert.equal(f.state().session.phase, 'closing');
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'idle');
  assert.equal(f.state().activeProfile?.id, f.alice.id);

  // Tant qu'il y a du monde, aucune session ne s'ouvre.
  f.observe({
    people: [
      { trackId: 'alice', profileId: f.alice.id },
      { trackId: 'bob', profileId: f.bob.id },
    ],
  });
  f.advance(1000);
  assert.equal(f.transport.opened.length, 1);
});

test('changer de délégation persiste le choix, clôture Live et rejette les anciens résultats', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  const scope = f.ready();
  assert.equal(f.state().delegationMode, 'fast');
  f.controller.setDelegationMode('fast');
  assert.equal(f.state().session.phase, 'ready');
  assert.equal(f.transport.closed.length, 0);
  f.controller.setDelegationMode('ultrafast');
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().delegationMode, 'ultrafast');
  assert.equal(
    f.controller.showCard(scope, 'late-delegation-card', card, f.clock() + 10000),
    false,
  );
  assert.equal(new SessionPreferences(f.db).getDelegationMode(), 'ultrafast');
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'idle');
  assert.equal(f.transport.opened.length, 1);
  const restored = new SessionController(
    f.profiles,
    new Transport(),
    f.clock,
    new SessionPreferences(f.db),
  );
  assert.equal(restored.snapshot().state.delegationMode, 'ultrafast');
});

test('mode 1 : la session anonyme s’ouvre à la détection puis reçoit le profil', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(1);
  assert.equal(f.state().session.mode, 1);
  assert.equal(new SessionPreferences(f.db).getSessionMode(), 1);
  f.observe({
    presence: true,
    engaged: false,
    people: [{ trackId: 'visitor', profileId: null }],
  });
  f.advance(800);
  assert.equal(f.transport.opened.length, 1);
  assert.equal(f.state().activeProfile, null);
  const scope = f.ready();
  f.observe({ people: [{ trackId: 'visitor', profileId: f.alice.id }] });
  f.advance(900);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  // La session anonyme continue : mêmes identifiants, informations ajoutées.
  assert.equal(f.transport.opened.length, 1);
  assert.equal(f.controller.scope().interactionId, scope.interactionId);
  assert.ok(f.transport.identified.length >= 1);
  assert.deepEqual(f.transport.identified.at(-1), scope);
});

test('mode 2 : la session s’ouvre à l’identification sans engagement', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(2);
  f.observe({
    presence: true,
    engaged: false,
    people: [{ trackId: 'alice', profileId: f.alice.id }],
  });
  f.advance(800);
  assert.equal(f.transport.opened.length, 1);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().presence.state, 'present');

  const anonymous = fixture(t);
  anonymous.controller.setSessionMode(2);
  anonymous.observe({ presence: true, engaged: true, people: [{ trackId: 'x', profileId: null }] });
  anonymous.advance(800);
  assert.equal(anonymous.transport.opened.length, 0);
});

test('changer de mode ferme la session en cours', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.controller.setSessionMode(1);
  assert.equal(f.state().session.mode, 1);
  assert.equal(f.state().session.phase, 'closing');
});

test('mode 1 : changer de personne isole la conversation et refuse les anciens résultats', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(1);
  f.engage([f.alice.id]);
  const oldScope = f.ready();
  assert.equal(f.controller.showCard(oldScope, 'alice-card', card, f.clock() + 30_000), true);
  f.observe({ people: [{ trackId: 'bob', profileId: f.bob.id }] });
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().activeProfile?.id, f.bob.id);
  assert.equal(f.state().cards.length, 0);
  assert.equal(f.transport.identified.length, 0);
  assert.ok(f.controller.scope().profileEpoch > oldScope.profileEpoch);
  assert.equal(f.controller.showCard(oldScope, 'late-alice-card', card, f.clock() + 30_000), false);
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'connecting');
  assert.notEqual(f.controller.scope().interactionId, oldScope.interactionId);
  assert.equal(f.transport.opened.length, 2);
});

test('mode 1 : une identité reçue pendant la fermeture ne prolonge pas la session anonyme', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(1);
  f.engage();
  const oldScope = f.ready();
  f.controller.command({ type: 'stop' });
  f.observe({ people: [{ trackId: 'alice', profileId: f.alice.id }] });
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.transport.identified.length, 0);
  assert.ok(f.controller.scope().profileEpoch > oldScope.profileEpoch);
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'idle');
  assert.equal(f.state().session.manualStop, true);
});

test('la préparation audio attend les permissions sans consommer une ouverture', (t) => {
  const f = fixture(t);
  f.controller.setBrowserAudioReady(false);
  f.engage();
  f.advance(20_000);
  assert.equal(f.transport.opened.length, 0);
  assert.equal(f.state().session.interactionId, null);
  f.controller.setBrowserAudioReady(true);
  assert.equal(f.transport.opened.length, 1);
  f.ready();
});

test('réautoriser OpenAI réarme la présence courante même pendant la clôture', (t) => {
  const f = fixture(t);
  const scope = f.engage();
  f.ready();
  f.transport.reason = 'OpenAI bloqué';
  f.controller.close('OpenAI bloqué');
  f.transport.reason = null;
  f.controller.resumeAutomatic();
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'connecting');
  assert.notEqual(f.controller.scope().interactionId, scope.interactionId);
});

test('réautoriser OpenAI conserve un arrêt manuel explicite', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  f.controller.command({ type: 'stop' });
  f.acknowledgeClose();
  f.controller.resumeAutomatic();
  assert.equal(f.state().session.manualStop, true);
  assert.equal(f.state().session.phase, 'idle');
});

test('un démarrage explicite pendant la clôture attend sa fin et lève l’arrêt manuel', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  f.controller.command({ type: 'stop' });
  f.controller.command({ type: 'start' });
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.manualStop, false);
  assert.equal(f.transport.opened.length, 1);
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'connecting');
  assert.equal(f.transport.opened.length, 2);
});

test('un passage de moins de 400 ms ne profite pas de la grâce pour ouvrir une session', (t) => {
  for (const mode of [1, 2, 3] as const) {
    const f = fixture(t);
    f.controller.heartbeat();
    f.controller.setSessionMode(mode);
    f.observe({ people: [{ trackId: 'alice', profileId: f.alice.id }] });
    f.advance(200);
    f.observe({ presence: false, engaged: false, people: [] });
    f.advance(1000);
    assert.equal(f.transport.opened.length, 0);
  }
});

test('350 ms d’engagement suffisent après une présence déjà stable', (t) => {
  const f = fixture(t);
  f.controller.heartbeat();
  f.observe({ engaged: false });
  f.advance(400);
  f.observe({ engaged: true });
  f.advance(349);
  assert.equal(f.transport.opened.length, 0);
  f.advance(1);
  assert.equal(f.transport.opened.length, 1);
});

test('les mesures de détection sont liées au premier démarrage, celles du tunnel à chaque session', (t) => {
  const f = fixture(t);
  f.engage();
  f.advance(1000);
  const first = f.ready();
  f.controller.sessionStarted(first);
  const samples = (name: string) => f.measures.filter((sample) => sample.name === name);
  assert.deepEqual(
    samples('detection_admission').map((sample) => sample.details.durationMs),
    [400],
  );
  assert.deepEqual(
    samples('detection_pret').map((sample) => sample.details.durationMs),
    [1400],
  );
  assert.equal(samples('detection_pret')[0]!.details.interactionId, first.interactionId);
  f.controller.command({ type: 'stop' });
  f.acknowledgeClose();
  f.advance(10_000);
  f.controller.command({ type: 'start' });
  f.advance(500);
  f.ready();
  assert.equal(samples('detection_pret').length, 1);
  assert.deepEqual(
    samples('admission_pret').map((sample) => sample.details.durationMs),
    [1000, 500],
  );
  assert.equal(samples('engagement_pret').length, 1);
});

test('modifier le caractère actif invalide le contexte et redémarre la conversation', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  const previous = f.ready();
  f.controller.personalityChanged(f.bob.id);
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
  f.controller.personalityChanged(f.alice.id);
  assert.equal(f.controller.snapshot().state.session.phase, 'closing');
  assert.ok(f.controller.scope().contextVersion > previous.contextVersion);
  f.acknowledgeClose();
  assert.equal(f.controller.snapshot().state.session.phase, 'connecting');
  assert.notEqual(f.controller.scope().interactionId, previous.interactionId);
  f.ready();
  f.controller.personalityChanged(null);
  assert.equal(f.controller.snapshot().state.session.phase, 'closing');
});

test('la fin d’engagement conserve le profil visible et permet une nouvelle conversation', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.observe({ engaged: false });
  f.advance(9000);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().presence.state, 'present');
  assert.equal(f.state().session.phase, 'closing');
  f.acknowledgeClose();
  f.observe({ engaged: true });
  f.advance(400);
  assert.equal(f.state().session.phase, 'connecting');
  assert.equal(f.transport.opened.length, 2);
});

test('un changement de contexte redémarre uniquement la conversation du profil concerné', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  const previous = f.controller.scope();
  f.controller.personalContextChanged(f.bob.id);
  assert.equal(f.state().session.phase, 'ready');
  assert.deepEqual(f.controller.scope(), previous);
  f.controller.personalContextChanged(f.alice.id);
  assert.equal(f.state().session.phase, 'closing');
  assert.ok(f.controller.scope().contextVersion > previous.contextVersion);
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'connecting');
});

test('le délai de départ configuré garde puis retire la présence et ferme tous les modes', (t) => {
  for (const mode of [1, 2, 3] as const) {
    const f = fixture(t);
    f.controller.setSessionMode(mode);
    f.engage([f.alice.id]);
    f.ready();
    f.controller.setPresenceTimings({
      presenceMs: 400,
      absenceMs: 4000,
      engagementMs: 350,
      disengagementMs: 500,
      identityHoldMs: 8000,
    });
    f.observe({ presence: false, engaged: false, people: [] });
    f.advance(3999);
    assert.equal(f.state().presence.peopleCount, 1);
    assert.equal(f.state().activeProfile?.id, f.alice.id);
    assert.equal(f.state().session.phase, 'ready');
    f.advance(1);
    assert.equal(f.state().presence.state, 'absent');
    assert.equal(f.state().activeProfile, null);
    assert.equal(f.state().session.phase, 'closing');
  }
  const anonymous = fixture(t);
  anonymous.controller.setSessionMode(1);
  anonymous.engage();
  anonymous.ready();
  anonymous.controller.setPresenceTimings({
    presenceMs: 400,
    absenceMs: 4000,
    engagementMs: 350,
    disengagementMs: 500,
    identityHoldMs: 8000,
  });
  anonymous.observe({ presence: false, engaged: false, people: [] });
  anonymous.advance(3999);
  assert.equal(anonymous.state().session.phase, 'ready');
  anonymous.advance(1);
  assert.equal(anonymous.state().session.phase, 'closing');
});

test('une occultation avant 15 secondes conserve la conversation et le cycle dans tous les modes caméra', (t) => {
  for (const mode of [1, 2, 3] as const) {
    const f = fixture(t);
    f.controller.setSessionMode(mode);
    f.controller.setPresenceTimings({
      ...f.controller.getPresenceTimings(),
      absenceMs: 1500,
      disengagementMs: 15000,
    });
    f.engage([f.alice.id]);
    const scope = f.ready();
    const engagementId = f.state().presence.engagementId;
    f.observe({ presence: false, engaged: false, people: [] });
    f.advance(14999);
    assert.equal(f.state().session.phase, 'ready');
    assert.equal(f.state().activeProfile?.id, f.alice.id);
    assert.deepEqual(f.controller.scope(), scope);
    f.observe({
      presence: true,
      engaged: true,
      people: [{ trackId: 'person-0', profileId: f.alice.id }],
    });
    f.advance(1000);
    assert.equal(f.state().presence.engagementId, engagementId);
    assert.equal(f.transport.opened.length, 1);
    assert.equal(f.transport.closed.length, 0);

    // Le retour a annulé le premier départ : une nouvelle perte a son propre délai.
    f.observe({ presence: false, engaged: false, people: [] });
    f.advance(14999);
    assert.equal(f.state().session.phase, 'ready');
    f.advance(1);
    assert.equal(f.state().session.phase, 'closing');
    assert.equal(f.state().presence.state, 'absent');
    assert.equal(f.state().activeProfile, null);
    assert.equal(f.transport.closed.length, 1);
  }
});

test('sans regard confirmé, une conversation tolère l’occultation aussi longtemps', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(2);
  f.controller.setPresenceTimings({
    ...f.controller.getPresenceTimings(),
    absenceMs: 1500,
    disengagementMs: 15000,
  });
  f.controller.heartbeat();
  f.observe({ engaged: false, people: [{ trackId: 'alice', profileId: f.alice.id }] });
  f.advance(400);
  f.ready();
  assert.equal(f.state().presence.engagementId, null);
  f.observe({ presence: false, people: [] });
  f.advance(14999);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Fin de présence.');
});

test('la parole repousse la fin d’engagement', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  const scope = f.ready();
  f.observe({ engaged: false });
  f.advance(7000);
  assert.equal(f.controller.setVoiceActivity(scope, 'speaking', 1200), true);
  f.advance(7999);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1201);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Fin d’engagement.');
});

test('un départ avec profil actif est journalisé comme fin de présence, sans relance', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(8000);
  assert.equal(f.state().session.reason, 'Fin de présence.');
  assert.equal(f.state().activeProfile, null);
  f.acknowledgeClose();
  assert.equal(f.state().session.phase, 'idle');
  assert.equal(f.transport.opened.length, 1);
});

test('une lecture caméra ratée isolée ne coupe pas, une panne durable oui', (t) => {
  const f = fixture(t);
  f.engage([f.alice.id]);
  f.ready();
  f.observe({ health: 'unavailable', presence: false, engaged: false, people: [] });
  f.advance(500);
  assert.equal(f.state().session.phase, 'ready');
  assert.equal(f.state().presence.health, 'ok');
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  f.observe({
    health: 'ok',
    presence: true,
    engaged: true,
    people: [{ trackId: 'person-0', profileId: f.alice.id }],
  });
  f.observe({ health: 'unavailable', presence: false, engaged: false, people: [] });
  f.advance(1000);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Caméra indisponible.');
});

test('un clignement ne relance pas la confirmation du regard et le regard affiché ne clignote pas', (t) => {
  const f = fixture(t);
  f.controller.heartbeat();
  f.observe({ engaged: false });
  f.advance(400);
  f.observe({ engaged: true });
  f.jump(200);
  f.controller.heartbeat();
  f.observe({ engaged: false });
  f.jump(100);
  f.controller.heartbeat();
  f.observe({ engaged: true });
  f.jump(50);
  f.controller.heartbeat();
  f.observe({ engaged: true });
  assert.equal(f.transport.opened.length, 1);
  f.ready();
  f.observe({ engaged: false });
  assert.equal(f.state().presence.state, 'engaged');
  f.advance(350);
  assert.equal(f.state().presence.state, 'present');
});

test('l’ouverture est mesurée avec son interaction et la connexion est préparée dès un visage', (t) => {
  const f = fixture(t);
  f.controller.heartbeat();
  f.observe();
  assert.ok(f.transport.prewarmed > 0);
  f.advance(400);
  const opening = f.measures.find((sample) => sample.name === 'ouverture');
  assert.equal(opening?.details.interactionId, f.controller.scope().interactionId);
  const count = f.transport.prewarmed;
  f.advance(1000);
  assert.equal(f.transport.prewarmed, count);
});

test('un retour annule le départ, même sans regard initial en mode identification', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(2);
  f.controller.heartbeat();
  f.observe({
    presence: true,
    engaged: false,
    people: [{ trackId: 'person-0', profileId: f.alice.id }],
  });
  f.advance(800);
  f.ready();
  f.controller.setPresenceTimings({
    presenceMs: 400,
    absenceMs: 2500,
    engagementMs: 350,
    disengagementMs: 500,
    identityHoldMs: 8000,
  });
  f.observe({ engaged: false });
  f.advance(6000);
  assert.equal(f.state().session.phase, 'ready');
  f.observe({ presence: false, people: [] });
  f.advance(2400);
  assert.equal(f.state().session.phase, 'ready');
  f.observe({ presence: true, people: [{ trackId: 'person-0', profileId: f.alice.id }] });
  f.advance(1000);
  f.observe({ presence: false, people: [] });
  f.advance(2499);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1);
  assert.equal(f.state().session.phase, 'closing');
});

test('la perte d’un regard confirmé ne ferme que le mode engagement, qui reprend au regard suivant', (t) => {
  for (const mode of [1, 2] as const) {
    const f = fixture(t);
    f.controller.setSessionMode(mode);
    f.engage([f.alice.id]);
    f.ready();
    f.observe({ engaged: false });
    f.advance(60_000);
    assert.equal(f.state().session.phase, 'ready', 'mode ' + mode);
    assert.equal(f.state().presence.state, 'present');
  }
  for (const mode of [3] as const) {
    const f = fixture(t);
    f.controller.setSessionMode(mode);
    f.engage([f.alice.id]);
    f.ready();
    f.controller.setPresenceTimings({
      presenceMs: 400,
      absenceMs: 4000,
      engagementMs: 350,
      disengagementMs: 500,
      identityHoldMs: 8000,
    });

    f.observe({ engaged: false });
    f.advance(400);
    f.observe({ engaged: true });
    f.advance(200);
    assert.equal(f.state().session.phase, 'ready', 'mode ' + mode + ' : retour du regard');

    f.observe({ engaged: false });
    f.advance(499);
    assert.equal(f.state().session.phase, 'ready', 'mode ' + mode + ' : délai en cours');
    f.advance(1);
    assert.equal(f.state().session.phase, 'closing', 'mode ' + mode + ' : délai expiré');
    assert.equal(f.state().session.reason, 'Fin d’engagement.');
    assert.equal(f.state().activeProfile?.id, f.alice.id);
    assert.equal(f.state().presence.state, 'present');

    f.acknowledgeClose();
    f.advance(1000);
    assert.equal(
      f.state().session.phase,
      'idle',
      'mode ' + mode + ' : pas de réouverture sans regard',
    );
    assert.equal(f.transport.opened.length, 1);
    f.observe({ engaged: true });
    f.advance(350);
    assert.equal(f.state().session.phase, 'connecting', 'mode ' + mode + ' : nouvel engagement');
    assert.equal(f.transport.opened.length, 2);
  }
});

test('les modes détection et identification restent ouverts sans premier regard', (t) => {
  for (const mode of [1, 2] as const) {
    const f = fixture(t);
    f.controller.setSessionMode(mode);
    f.controller.heartbeat();
    f.observe({
      presence: true,
      engaged: false,
      people: [{ trackId: 'person-0', profileId: f.alice.id }],
    });
    f.advance(800);
    f.ready();
    f.advance(12000);
    assert.equal(f.state().session.phase, 'ready', 'mode ' + mode);
  }
});

test('les délais de présence et de regard s’appliquent à l’ouverture et à la fermeture', (t) => {
  const f = fixture(t);
  f.controller.setPresenceTimings({
    presenceMs: 800,
    absenceMs: 1500,
    engagementMs: 1400,
    disengagementMs: 1200,
    identityHoldMs: 8000,
  });
  f.controller.heartbeat();
  f.observe({ people: [{ trackId: 'alice', profileId: f.alice.id }] });
  f.advance(799);
  assert.equal(f.state().presence.state, 'absent');
  assert.equal(f.transport.opened.length, 0);
  f.advance(1);
  assert.equal(f.state().presence.state, 'present');
  f.advance(599);
  assert.equal(f.transport.opened.length, 0);
  f.advance(1);
  assert.equal(f.transport.opened.length, 1);
  f.ready();
  f.observe({ engaged: false });
  f.advance(1199);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().activeProfile?.id, f.alice.id);
});

test('les délais n’allongent ni la panne caméra ni le blocage vie privée', (t) => {
  for (const reason of ['sensor', 'privacy'] as const) {
    const f = fixture(t);
    f.engage([f.alice.id]);
    f.ready();
    f.controller.setPresenceTimings({
      presenceMs: 400,
      absenceMs: 30000,
      engagementMs: 350,
      disengagementMs: 60000,
      identityHoldMs: 8000,
    });
    if (reason === 'sensor') {
      f.advance(2000, { sensor: false });
      assert.equal(f.state().presence.health, 'unavailable');
    } else {
      f.controller.setPrivacyMode(true);
      const crowd = {
        people: [
          { trackId: 'alice', profileId: f.alice.id },
          { trackId: 'bob', profileId: f.bob.id },
        ],
      };
      // Une seule fausse détection ne suffit pas ; deux observations ferment aussitôt.
      f.observe(crowd);
      assert.equal(f.state().session.phase, 'ready');
      f.observe(crowd);
    }
    assert.equal(f.state().session.phase, 'closing');
  }
});

test('un délai nul et un délai raccourci sont appliqués sans redémarrage', (t) => {
  const f = fixture(t);
  f.controller.setPresenceTimings({
    presenceMs: 0,
    absenceMs: 0,
    engagementMs: 0,
    disengagementMs: 0,
    identityHoldMs: 8000,
  });
  f.controller.heartbeat();
  f.observe();
  f.ready();
  f.observe({ presence: false, engaged: false, people: [] });
  f.controller.tick();
  assert.equal(f.state().presence.state, 'absent');
  assert.equal(f.state().session.phase, 'closing');

  const other = fixture(t);
  other.engage([other.alice.id]);
  other.ready();
  other.controller.setPresenceTimings({
    presenceMs: 400,
    absenceMs: 5000,
    engagementMs: 350,
    disengagementMs: 8000,
    identityHoldMs: 8000,
  });
  other.observe({ presence: false, engaged: false, people: [] });
  other.advance(2000);
  assert.equal(other.state().session.phase, 'ready');
  other.controller.setPresenceTimings({
    presenceMs: 400,
    absenceMs: 1000,
    engagementMs: 350,
    disengagementMs: 1000,
    identityHoldMs: 8000,
  });
  assert.equal(other.state().presence.state, 'absent');
  assert.equal(other.state().session.phase, 'closing');
  const restarted = new SessionController(
    other.profiles,
    new Transport(),
    other.clock,
    new SessionPreferences(other.db),
  );
  assert.deepEqual(restarted.getPresenceTimings(), other.controller.getPresenceTimings());
});

test('mot d’appel : admission locale seulement après le modèle et la présence, il lève un arrêt manuel', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(1);
  f.controller.setWakeWordEnabled(true);
  assert.equal(new SessionPreferences(f.db).getWakeWordEnabled(), true);
  f.engage();
  assert.equal(f.transport.opened.length, 0);
  assert.equal(f.controller.wakeDetected(), false);
  f.controller.setWakeWordAvailability(true, null);
  assert.equal(f.controller.wakeDetected(), true);
  assert.equal(f.transport.opened.length, 1);
  f.advance(100);
  assert.equal(f.controller.wakeDetected(), false);
  f.advance(120);
  f.ready();
  assert.equal(f.measures.find((sample) => sample.name === 'wake_pret')?.details.durationMs, 220);
  f.controller.close('Conversation terminée.');
  f.acknowledgeClose();
  assert.equal(f.controller.wakeDetected(), true);
  assert.equal(f.transport.opened.length, 2);
  f.ready();
  f.controller.command({ type: 'stop' });
  f.acknowledgeClose();
  assert.equal(f.state().session.manualStop, true);
  // La présence seule ne rouvre rien pendant l’arrêt manuel…
  f.engage();
  assert.equal(f.transport.opened.length, 2);
  // …mais « Cornelius » est une demande explicite, comme « Démarrer » : l’arrêt est levé,
  // y compris en base, sinon la veille restait muette après un redémarrage.
  assert.equal(f.controller.wakeDetected(), true);
  assert.equal(f.transport.opened.length, 3);
  assert.equal(f.state().session.manualStop, false);
  assert.equal(new SessionPreferences(f.db).getManualStop(), false);
  assert.equal(f.state().session.phase, 'connecting');
});

test('le tampon avancé reste désactivé par défaut et persiste sans modifier le mode de session', (t) => {
  const f = fixture(t);
  assert.equal(f.state().advancedAudioBuffer, false);
  f.controller.setAdvancedAudioBuffer(true);
  assert.equal(f.state().advancedAudioBuffer, true);
  assert.equal(new SessionPreferences(f.db).getAdvancedAudioBuffer(), true);
  const restarted = new SessionController(
    f.profiles,
    new Transport(),
    f.clock,
    new SessionPreferences(f.db),
  );
  assert.equal(restarted.snapshot().state.advancedAudioBuffer, true);
  assert.equal(restarted.snapshot().state.session.mode, f.state().session.mode);
  f.controller.setAdvancedAudioBuffer(false);
  assert.equal(new SessionPreferences(f.db).getAdvancedAudioBuffer(), false);
});

test('le son d’ouverture se règle, persiste et refuse un son inconnu', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.state().admissionSound, { enabled: false, sound: 'carillon' });
  f.controller.setAdmissionSound({ enabled: true, sound: 'bulle' });
  assert.deepEqual(f.state().admissionSound, { enabled: true, sound: 'bulle' });
  assert.throws(() => f.controller.setAdmissionSound({ enabled: true, sound: 'sirène' } as never));
  const restarted = new SessionController(
    f.profiles,
    new Transport(),
    f.clock,
    new SessionPreferences(f.db),
  );
  assert.deepEqual(restarted.snapshot().state.admissionSound, { enabled: true, sound: 'bulle' });
});

test('personnes reconnues : un inconnu qui regarde le miroir n’ouvre rien, un membre du foyer oui', (t) => {
  const f = fixture(t);
  assert.equal(f.state().knownPeopleOnly, false);
  f.controller.setKnownPeopleOnly(true);
  assert.equal(new SessionPreferences(f.db).getKnownPeopleOnly(), true);
  // Mode 3 par défaut : un inconnu engagé reste sans conversation, avec un diagnostic.
  f.engage([null]);
  f.advance(2000);
  assert.equal(f.transport.opened.length, 0);
  assert.match(f.state().diagnostic ?? '', /non reconnue/);
  // La même personne, reconnue pendant le même regard, ouvre la conversation.
  f.observe({ people: [{ trackId: 'person-0', profileId: f.alice.id }] });
  f.advance(400);
  assert.equal(f.transport.opened.length, 1);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().diagnostic, null);
});

test('personnes reconnues : activer l’option ferme une conversation anonyme et s’applique au mode 1', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(1);
  f.engage([null]);
  assert.equal(f.transport.opened.length, 1);
  f.ready();
  f.controller.setKnownPeopleOnly(true);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Ouverture réservée aux personnes reconnues.');
  f.acknowledgeClose();
  f.advance(2000);
  assert.equal(f.transport.opened.length, 1);
  // Le départ efface le diagnostic de la personne inconnue.
  f.advance(10_000, { sensor: false });
  f.observe({ presence: false, engaged: false, people: [] });
  f.advance(3000);
  assert.equal(f.state().diagnostic === null || !/non reconnue/.test(f.state().diagnostic!), true);
  f.controller.setKnownPeopleOnly(false);
  assert.equal(new SessionPreferences(f.db).getKnownPeopleOnly(), false);
});

test('recherche web et accueil : réglages persistants, la recherche rouvre la session active', (t) => {
  const f = fixture(t);
  assert.equal(f.state().webSearchEnabled, true);
  assert.equal(f.state().greeting, 'name');
  f.engage([f.alice.id]);
  f.ready();
  const before = f.state().session.contextVersion;
  f.controller.setWebSearchEnabled(false);
  assert.equal(f.state().webSearchEnabled, false);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Recherche web modifiée.');
  assert.ok(f.state().session.contextVersion > before);
  f.acknowledgeClose();
  assert.equal(f.transport.opened.length, 2);
  f.controller.setGreetingMode('free');
  assert.throws(() => f.controller.setGreetingMode('salut' as never), /Accueil invalide/);
  const restarted = new SessionController(
    f.profiles,
    new Transport(),
    f.clock,
    new SessionPreferences(f.db),
  );
  assert.equal(restarted.isWebSearchEnabled(), false);
  assert.equal(restarted.greetingMode(), 'free');
});

test('un fournisseur facturé à la durée ferme après le silence dans tous les modes', (t) => {
  const f = fixture(t);
  f.transport.metered = true;
  f.controller.setSessionMode(2);
  f.engage([f.alice.id]);
  f.ready();
  f.advance(19_999);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(2);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Fin de conversation après silence.');
});

test('fin de parole désactivée par défaut : la conversation reste ouverte devant le miroir', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.state().silenceClose, { enabled: false, delayMs: 20_000 });
  f.engage();
  f.ready();
  f.advance(60_000);
  assert.equal(f.state().session.phase, 'ready');
});

test('fin de parole : ferme après le silence, puis rouvre seulement après un nouveau regard', (t) => {
  const f = fixture(t);
  f.controller.setSilenceClose({ enabled: true, delayMs: 5000 });
  f.engage();
  const scope = f.ready();
  f.advance(4000);
  // La parole de la personne suspend le délai, qui repart à la fin de sa phrase.
  assert.equal(f.controller.setUserSpeech(scope, true), true);
  f.advance(10_000);
  assert.equal(f.state().session.phase, 'ready');
  f.controller.setUserSpeech(scope, false);
  f.advance(4000);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1000);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Fin de conversation après silence.');
  f.acknowledgeClose();
  // Toujours là et toujours tourné vers le miroir : pas de réouverture en boucle.
  f.advance(5000);
  assert.equal(f.transport.opened.length, 1);
  assert.notEqual(f.state().presence.state, 'engaged');
  // Un regard détourné puis revenu rouvre une conversation.
  f.observe({ engaged: false });
  f.advance(400);
  f.observe({ engaged: true });
  f.advance(400);
  assert.equal(f.transport.opened.length, 2);
  assert.equal(f.state().session.phase, 'connecting');
});

test('fin de parole en mode détection : même règle de réouverture', (t) => {
  const f = fixture(t);
  f.controller.setSessionMode(1);
  f.controller.setSilenceClose({ enabled: true, delayMs: 3000 });
  f.engage();
  f.ready();
  f.advance(3000);
  assert.equal(f.state().session.phase, 'closing');
  f.acknowledgeClose();
  f.advance(5000);
  assert.equal(f.transport.opened.length, 1);
  f.observe({ engaged: false });
  f.advance(400);
  f.observe({ engaged: true });
  f.advance(400);
  assert.equal(f.transport.opened.length, 2);
});

test('fin de parole avec « Cornelius » exigé : le mot d’appel rouvre sans détourner le regard', (t) => {
  const f = fixture(t);
  f.controller.setWakeWordEnabled(true);
  f.controller.setWakeWordAvailability(true, null);
  f.controller.setSilenceClose({ enabled: true, delayMs: 3000 });
  f.engage();
  assert.equal(f.transport.opened.length, 0);
  assert.equal(f.controller.wakeDetected(), true);
  f.ready();
  f.advance(3000);
  assert.equal(f.state().session.phase, 'closing');
  f.acknowledgeClose();
  f.advance(1000);
  assert.equal(f.controller.wakeDetected(), true);
  assert.equal(f.transport.opened.length, 2);
});

test('fin de parole : une réponse en cours, le son de Cornelius ou une transcription repoussent la fin', (t) => {
  const f = fixture(t);
  f.controller.setSilenceClose({ enabled: true, delayMs: 3000 });
  f.engage();
  const scope = f.ready();
  assert.equal(f.controller.setAssistantBusy(scope, true), true);
  f.advance(10_000);
  assert.equal(f.state().session.phase, 'ready');
  f.controller.setAssistantBusy(scope, false);
  f.advance(2000);
  // Le son audible repousse la fin : le silence compte à partir de la fin du son.
  assert.equal(f.controller.noteAssistantOutput(scope), true);
  f.advance(2000);
  assert.equal(f.state().session.phase, 'ready');
  // Une transcription de la personne vaut une parole, même si le VAD local se tait.
  assert.equal(f.controller.noteUserTranscript(scope), true);
  f.advance(2000);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1000);
  assert.equal(f.state().session.phase, 'closing');
});

test('fin de parole : réglage validé, conservé et appliqué à une conversation déjà prête', (t) => {
  const f = fixture(t);
  f.engage();
  f.ready();
  f.advance(30_000);
  assert.throws(() => f.controller.setSilenceClose({ enabled: true, delayMs: 1000 }));
  assert.throws(() => f.controller.setSilenceClose({ enabled: true, delayMs: 400_000 }));
  f.controller.setSilenceClose({ enabled: true, delayMs: 4000 });
  assert.deepEqual(new SessionPreferences(f.db).getSilenceClose(), {
    enabled: true,
    delayMs: 4000,
  });
  assert.deepEqual(f.state().silenceClose, { enabled: true, delayMs: 4000 });
  f.advance(3000);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1000);
  assert.equal(f.state().session.phase, 'closing');
});

function voiceFixture(t: TestContext, recognition = true) {
  const f = fixture(t);
  f.controller.setSessionMode(4);
  f.controller.setVoiceRecognition(recognition);
  f.controller.setWakeWordAvailability(true, null);
  f.controller.heartbeat();
  // La caméra s’allume avec la conversation : nouvelle source d’images à chaque fois.
  const see = (people: (string | null)[], boot = 'voice-camera') =>
    f.observe({
      producerBootId: boot,
      health: 'ok',
      presence: people.length > 0,
      engaged: people.length > 0,
      people: people.map((profileId, index) => ({ trackId: 'face-' + index, profileId })),
    });
  return { ...f, see };
}

test('mode voix : la reconnaissance au mot d’appel rattache la personne seule et reconnue', (t) => {
  const f = voiceFixture(t);
  assert.equal(f.controller.wakeDetected(), true);
  assert.equal(f.state().activeProfile, null);
  f.see([f.alice.id]);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.equal(f.state().selection, 'automatic');
  // Identification douce : la session continue, ses outils sont actualisés.
  assert.equal(f.transport.identified.length, 1);
  assert.deepEqual(f.transport.closed, []);
  assert.equal(f.state().session.phase, 'connecting');
  assert.equal(f.state().presence.health, 'ok');
  assert.equal(f.state().presence.people[0]?.profileId, f.alice.id);
  // Fin de conversation : la caméra s’éteint, plus rien ne prouve que la personne est là.
  f.ready();
  f.controller.close('Fin de test.');
  f.acknowledgeClose();
  assert.equal(f.state().activeProfile, null);
  assert.equal(f.state().selection, 'household');
});

test('mode voix : une caméra lente à démarrer laisse quand même le temps de reconnaître', (t) => {
  const f = voiceFixture(t);
  assert.equal(f.controller.wakeDetected(), true);
  f.ready();
  // La caméra met 7 s à donner sa première image : le délai part de celle-ci.
  f.jump(7000);
  f.see([null]);
  f.jump(6000);
  f.see([f.alice.id]);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  assert.deepEqual(f.transport.closed, []);
});

test('mode voix : sans l’option, plusieurs personnes ou après la fenêtre, aucun profil', (t) => {
  const off = voiceFixture(t, false);
  assert.equal(off.controller.wakeDetected(), true);
  off.see([off.alice.id]);
  assert.equal(off.state().activeProfile, null);

  const crowd = voiceFixture(t);
  assert.equal(crowd.controller.wakeDetected(), true);
  crowd.see([crowd.alice.id, null]);
  assert.equal(crowd.state().activeProfile, null);
  crowd.see([null]);
  assert.equal(crowd.state().activeProfile, null);
  crowd.ready();
  crowd.jump(9000);
  crowd.see([crowd.alice.id]);
  assert.equal(crowd.state().activeProfile, null, 'fenêtre de reconnaissance expirée');
});

test('mode voix : une caméra qui démarre, redémarre ou tombe ne ferme pas la conversation', (t) => {
  const f = voiceFixture(t, false);
  assert.equal(f.controller.wakeDetected(), true);
  const scope = f.ready();
  f.see([], 'boot-a');
  f.see([null], 'boot-b');
  f.observe({ health: 'unavailable', presence: false, engaged: false, people: [] });
  f.controller.tick();
  assert.equal(f.state().session.phase, 'ready');
  assert.deepEqual(f.controller.scope(), scope);
});

test('mode voix : vie privée, une conversation personnelle se ferme devant plusieurs personnes', (t) => {
  const f = voiceFixture(t);
  f.controller.setPrivacyMode(true);
  assert.equal(f.controller.wakeDetected(), true);
  f.ready();
  f.see([f.alice.id]);
  assert.equal(f.state().activeProfile?.id, f.alice.id);
  f.see([f.alice.id, null]);
  assert.equal(f.state().session.phase, 'ready');
  f.see([f.alice.id, null]);
  assert.equal(f.state().session.phase, 'closing');
  assert.equal(f.state().session.reason, 'Mode vie privée : plusieurs personnes.');
});

test('mode voix : la caméra n’est saine que pendant les images fraîches', (t) => {
  const f = voiceFixture(t, false);
  assert.equal(f.controller.presenceScope().healthy, false);
  assert.equal(f.controller.wakeDetected(), true);
  f.ready();
  f.see([null]);
  assert.equal(f.controller.presenceScope().healthy, true);
  f.jump(2500);
  assert.equal(f.controller.presenceScope().healthy, false);
  assert.equal(f.state().session.phase, 'ready');
});

test('mot d’appel exigé : un changement de contexte reprend la même conversation', (t) => {
  // « Cornelius » pour tout le monde : la reprise garde aussi la personne reconnue.
  const voice = voiceFixture(t);
  assert.equal(voice.controller.wakeDetected(), true);
  voice.see([voice.alice.id]);
  voice.ready();
  voice.controller.setWebSearchEnabled(false);
  assert.equal(voice.state().session.phase, 'closing');
  voice.acknowledgeClose();
  assert.equal(voice.state().session.phase, 'connecting', 'la conversation reprend');
  assert.equal(voice.transport.opened.length, 2);
  assert.equal(voice.state().activeProfile?.id, voice.alice.id);
  // Une fin normale, elle, attend le prochain « Cornelius » et retire le profil.
  voice.ready();
  voice.controller.close('Fin de test.');
  voice.acknowledgeClose();
  assert.equal(voice.state().session.phase, 'idle');
  assert.equal(voice.state().activeProfile, null);

  // « Cornelius » réservé aux membres : même reprise, la personne étant toujours là.
  const members = fixture(t);
  members.controller.setOpening({ trigger: 'voice', audience: 'members', recognizeVoice: false });
  members.controller.setWakeWordAvailability(true, null);
  members.engage([members.alice.id]);
  assert.equal(members.state().session.phase, 'idle', 'la présence seule n’ouvre pas');
  assert.equal(members.controller.wakeDetected(), true);
  members.ready();
  members.controller.restart('Réglage modifié.');
  members.acknowledgeClose();
  assert.equal(members.state().session.phase, 'connecting');
  assert.equal(members.transport.opened.length, 2);

  // Un arrêt manuel pendant la clôture annule la reprise.
  members.ready();
  members.controller.restart('Réglage modifié.');
  members.controller.command({ type: 'stop' });
  members.acknowledgeClose();
  assert.equal(members.state().session.phase, 'idle');
});

test('fin de parole : un seul délai, toujours actif quand la caméra est éteinte en veille', (t) => {
  const f = voiceFixture(t, false);
  f.controller.setSilenceClose({ enabled: false, delayMs: 5000 });
  assert.equal(f.controller.wakeDetected(), true);
  f.ready();
  f.advance(4999);
  assert.equal(f.state().session.phase, 'ready');
  f.advance(1);
  assert.equal(f.state().session.phase, 'closing');
});
