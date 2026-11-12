import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import addon from './helpers/demo-addon/index.js';
import type { AddonHttpRequest } from '../shared/addons.js';
import { SessionController } from '../server/controller.js';
import { AddonRuntime } from '../server/addons/runtime.js';
import { AmbientModules } from '../server/addons/ambient.js';
import { validateAddonDefinition } from '../server/addons/registry.js';
import { AddonRepository, openDatabase, ProfileRepository } from '../server/storage.js';

function fixture(t: TestContext, definition = addon) {
  const db = openDatabase(':memory:');
  const profiles = new ProfileRepository(db);
  const alice = profiles.create('Alice');
  const bob = profiles.create('Bob');
  const instances = new AddonRepository(db);
  let now = Date.parse('2026-09-22T10:00:00Z');
  let sequence = 0;
  let opens = 0;
  const clock = () => now;
  const controller = new SessionController(
    profiles,
    {
      open: () => {
        opens++;
      },
      close: () => {},
    },
    clock,
  );
  controller.setBrowserAudioReady(false);
  const calls: AddonHttpRequest[] = [];
  let handler: (request: AddonHttpRequest) => Promise<{ status: number; body: unknown }> = async (
    request,
  ) => ({ status: 200, body: { name: request.url.split('/').at(-1), available: 12 } });
  const runtime = new AddonRuntime({
    addons: [definition],
    instances,
    now: clock,
    http: {
      async fetch(request) {
        calls.push(request);
        const result = await handler(request);
        return {
          status: result.status,
          headers: {},
          text: () => JSON.stringify(result.body),
          json: () => result.body,
          bytes: () => new Uint8Array(0),
        };
      },
    },
  });
  const ambient = new AmbientModules(
    runtime,
    () => controller.snapshot().state,
    () => controller.publish(),
    clock,
  );
  controller.setAmbientProjection((state) => ambient.view(state));
  let publishes = 0;
  const unsubscribe = controller.subscribe(() => {
    publishes++;
    ambient.tick();
  });
  t.after(() => {
    unsubscribe();
    ambient.dispose();
    db.close();
  });
  function observe(ids: (string | null)[]) {
    controller.heartbeat();
    controller.observe({
      schemaVersion: 1,
      producerBootId: 'test',
      sequence: ++sequence,
      observedAt: now,
      health: 'ok',
      presence: ids.length > 0,
      engaged: false,
      people: ids.map((profileId, index) => ({ trackId: String(index), profileId })),
    });
    controller.tick();
    ambient.tick();
  }
  return {
    db,
    alice,
    bob,
    controller,
    runtime,
    instances,
    ambient,
    calls,
    opens: () => opens,
    add: (profileId: string | null, displayEnabled = true, parkingId = 'demo') =>
      instances.createInstance({
        addonId: addon.id,
        profileId,
        ref: null,
        label: parkingId,
        displayEnabled,
        config: { parkingId },
        configVersion: 1,
      }),
    respond: (next: typeof handler) => {
      handler = next;
    },
    recognize: async (ids: (string | null)[]) => {
      observe(ids);
      now += 401;
      observe(ids);
      await setImmediate();
    },
    advance: async (ms: number, ids: (string | null)[] = [alice.id]) => {
      let remaining = ms;
      while (remaining > 0) {
        const step = Math.min(remaining, 1000);
        now += step;
        remaining -= step;
        observe(ids);
        await setImmediate();
      }
    },
    view: () => controller.snapshot().state.ambientDisplays,
    /** Avance l'horloge sans observation ni publication : seul l'affichage peut republier. */
    jump: (ms: number) => {
      now += ms;
    },
    publishes: () => publishes,
  };
}

test('affichage choisi par source, dès reconnaissance, sans audio ni carte ni appel Live', async (t) => {
  const f = fixture(t);
  const personal = f.add(f.alice.id, true, 'alice');
  f.add(f.bob.id, true, 'bob');
  f.add(null, true, 'foyer');
  f.add(f.alice.id, false, 'cache-seulement');
  assert.equal(f.view().length, 0);
  assert.equal(f.calls.length, 0);
  await f.recognize([f.alice.id]);
  assert.deepEqual(
    f
      .view()
      .map((entry) => entry.label)
      .sort(),
    ['alice', 'foyer'],
  );
  assert.equal(
    f.view().find((entry) => entry.instanceId === personal.id)?.content?.value,
    '12 places',
  );
  assert.equal(f.calls.length, 2);
  assert.equal(f.opens(), 0);
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
  assert.deepEqual(f.controller.snapshot().state.cards, []);
});

test('le cache frais est partagé avec une lecture vocale ; expiration et nouvelle collecte automatiques', async (t) => {
  const f = fixture(t);
  f.add(f.alice.id);
  await f.recognize([f.alice.id]);
  await f.runtime.read('parking', f.alice.id, null, new AbortController().signal);
  assert.equal(f.calls.length, 1);
  await f.advance(59_000);
  assert.equal(f.calls.length, 1);
  await f.advance(1_001);
  assert.equal(f.calls.length, 2);
  assert.equal(f.view()[0]?.status, 'ready');
});

test('changement de profil, perte de reconnaissance et vie privée filtrent immédiatement les données', async (t) => {
  const f = fixture(t);
  f.add(f.alice.id, true, 'alice');
  f.add(f.bob.id, true, 'bob');
  f.add(null, true, 'foyer');
  await f.recognize([f.alice.id]);
  await f.recognize([f.bob.id]);
  assert.deepEqual(
    f
      .view()
      .map((entry) => entry.label)
      .sort(),
    ['bob', 'foyer'],
  );
  await f.recognize([null]);
  assert.deepEqual(
    f.view().map((entry) => entry.label),
    ['foyer'],
  );
  await f.recognize([f.alice.id, f.bob.id]);
  f.controller.setPrivacyMode(true);
  assert.deepEqual(f.view(), []);
});

test('absence confirmée, caméra indisponible ou navigateur perdu retirent les informations', async (t) => {
  const f = fixture(t);
  f.add(f.alice.id);
  await f.recognize([f.alice.id]);
  await f.advance(1_600, []);
  await f.advance(1_600, []);
  assert.deepEqual(f.view(), []);
  await f.recognize([f.alice.id]);
  assert.equal(f.view().length, 1);
  const state = f.controller.snapshot().state;
  assert.deepEqual(f.ambient.view({ ...state, browserConnected: false }), []);
  assert.deepEqual(
    f.ambient.view({ ...state, presence: { ...state.presence, health: 'unavailable' } }),
    [],
  );
});

test('désactivation et suppression retirent une source même sans nouvelle session', async (t) => {
  const f = fixture(t);
  const source = f.add(f.alice.id);
  await f.recognize([f.alice.id]);
  f.instances.updateInstance(source.id, { displayEnabled: false });
  f.ambient.tick();
  assert.deepEqual(f.view(), []);
  f.instances.updateInstance(source.id, { displayEnabled: true });
  f.ambient.tick();
  assert.equal(f.view().length, 1);
  f.instances.deleteInstance(source.id);
  f.ambient.tick();
  assert.deepEqual(f.view(), []);
});

test('une panne conserve un résultat daté et applique un délai entre tentatives', async (t) => {
  const f = fixture(t);
  f.add(f.alice.id);
  await f.recognize([f.alice.id]);
  const fetchedAt = f.view()[0]!.fetchedAt;
  f.respond(async () => ({ status: 503, body: {} }));
  await f.advance(60_001);
  assert.equal(f.calls.length, 2);
  assert.equal(f.view()[0]?.status, 'stale');
  assert.equal(f.view()[0]?.fetchedAt, fetchedAt);
  await f.advance(29_000);
  assert.equal(f.calls.length, 2);
  await f.advance(1_001);
  assert.equal(f.calls.length, 3);
  f.respond(async () => ({ status: 200, body: { name: 'demo', available: 7 } }));
  await f.advance(60_001);
  assert.equal(f.view()[0]?.content?.value, '7 places');
  assert.equal(f.view()[0]?.status, 'ready');
});

test('une première panne reste explicite, sans données inventées', async (t) => {
  const f = fixture(t);
  f.add(f.alice.id);
  f.respond(async () => ({ status: 503, body: {} }));
  await f.recognize([f.alice.id]);
  assert.equal(f.view()[0]?.status, 'error');
  assert.equal(f.view()[0]?.content, null);
  assert.equal(f.view()[0]?.fetchedAt, null);
});

test('un résultat tardif après changement de profil ne revient ni à l’écran ni en cache', async (t) => {
  const f = fixture(t);
  const source = f.add(f.alice.id);
  let release!: () => void;
  f.respond(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { status: 200, body: { name: 'demo', available: 12 } };
  });
  await f.recognize([f.alice.id]);
  assert.equal(f.view()[0]?.status, 'loading');
  await f.recognize([f.bob.id]);
  assert.equal(f.calls[0]?.signal?.aborted, true);
  release();
  await setImmediate();
  assert.deepEqual(f.view(), []);
  assert.equal(f.instances.getSnapshot(source), null);
});

test('capacité optionnelle v1 validée ; affichage invalide refusé avant publication', async (t) => {
  assert.equal(validateAddonDefinition({ ...addon, ambient: undefined }), null);
  assert.notEqual(validateAddonDefinition({ ...addon, ambient: {} }), null);
  assert.notEqual(validateAddonDefinition({ ...addon, ambient: null }), null);
  const f = fixture(t);
  const source = f.add(f.alice.id);
  await f.recognize([f.alice.id]);
  const broken = new AddonRuntime({
    addons: [
      {
        ...addon,
        ambient: {
          present: () => ({ layout: 'metric', title: '', value: null, subtitle: null, items: [] }),
        },
      },
    ],
    instances: f.instances,
    http: {
      fetch: async () => {
        throw new Error('Aucun appel attendu');
      },
    },
  });
  const display = broken.ambientDisplay(source);
  assert.equal(display.status, 'error');
  assert.equal(display.content, null);
});
test('un succès vide est présenté par le module qui sait le dire, sans collecte répétée', async (t) => {
  let presentations = 0;
  let collects = 0;
  const f = fixture(t, {
    ...addon,
    async collect() {
      collects++;
      return {
        data: { name: 'demo', available: 0 },
        empty: true,
        source: { provider: 'test', sourceId: 'demo' },
      };
    },
    ambient: {
      present(snapshot, ctx) {
        presentations++;
        assert.equal(snapshot.status, 'empty');
        return { ...addon.ambient!.present(snapshot, ctx), value: 'Rien à signaler' };
      },
    },
  });
  f.add(f.alice.id);
  await f.recognize([f.alice.id]);
  assert.equal(f.view()[0]?.status, 'empty');
  assert.equal(f.view()[0]?.content?.value, 'Rien à signaler');
  assert.ok(presentations > 0);
  await f.advance(3000);
  assert.equal(collects, 1, 'relevé vide encore frais : pas de nouvelle collecte');
});

test('un succès vide que le module ne sait pas dire reste « aucune donnée », sans erreur', async (t) => {
  const f = fixture(t, {
    ...addon,
    async collect() {
      return {
        data: { name: 'demo', available: 0 },
        empty: true,
        source: { provider: 'test', sourceId: 'demo' },
      };
    },
    ambient: {
      present() {
        throw new Error('Rien à afficher.');
      },
    },
  });
  f.add(f.alice.id);
  await f.recognize([f.alice.id]);
  assert.equal(f.view()[0]?.status, 'empty');
  assert.equal(f.view()[0]?.content, null);
});

test('une présentation qui fixe refreshAt est recalculée à cet instant, sans collecte', async (t) => {
  let presentations = 0;
  const f = fixture(t, {
    ...addon,
    freshMs: 60 * 60 * 1000,
    ambient: {
      present(snapshot, ctx) {
        presentations++;
        // Bascule moins d'une seconde après le début : « 17 h » en accéléré, avant que la
        // présence, faute d'observation, ne retombe.
        const evening = Date.parse('2026-09-22T10:00:00.900Z');
        return {
          ...addon.ambient!.present(snapshot, ctx),
          value: ctx.now() >= evening ? 'Ce soir' : 'Demain',
          ...(ctx.now() >= evening ? {} : { refreshAt: new Date(evening).toISOString() }),
        };
      },
    },
  });
  f.add(f.alice.id);
  await f.recognize([f.alice.id]);
  assert.equal(f.view()[0]?.content?.value, 'Demain');
  const before = { presentations, publishes: f.publishes(), calls: f.calls.length };
  f.jump(200);
  f.ambient.tick();
  assert.equal(f.publishes(), before.publishes, 'trop tôt : rien à republier');
  f.jump(400);
  f.ambient.tick();
  assert.equal(f.publishes(), before.publishes + 1);
  assert.equal(f.view()[0]?.content?.value, 'Ce soir');
  assert.ok(presentations > before.presentations);
  assert.equal(f.calls.length, before.calls, 'aucune nouvelle collecte');
});

test('les configurations modifiées pendant une collecte ne réaffichent pas les anciennes données', async (t) => {
  const f = fixture(t);
  const source = f.add(f.alice.id);
  let release!: () => void;
  f.respond(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { status: 200, body: { name: 'ancien', available: 12 } };
  });
  await f.recognize([f.alice.id]);
  f.instances.updateInstance(source.id, { config: { parkingId: 'nouveau' } });
  f.instances.clearState(source.id);
  f.respond(async () => ({ status: 200, body: { name: 'nouveau', available: 3 } }));
  f.ambient.tick();
  await setImmediate();
  release();
  await setImmediate();
  assert.equal(f.view()[0]?.content?.subtitle, 'nouveau');
  assert.equal(f.view()[0]?.content?.value, '3 places');
});
