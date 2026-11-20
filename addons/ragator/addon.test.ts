import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AddonRepository,
  AddonRuntime,
  openDatabase,
  validateAddonDefinition,
} from '#cornelius/testing';
import type { AddonHttpClient, AddonHttpRequest } from '#cornelius/addons';
import { validators } from '#cornelius/validation';
import addon from './index.js';
import answer from './fixtures/answer.json' with { type: 'json' };
import collections from './fixtures/collections.json' with { type: 'json' };

const tool = 'ragator__ask';

function setup(t: { after(fn: () => void): void }, config: Record<string, unknown> = {}) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'videos',
    label: 'Vidéos des Frères Poulain',
    config: { ...addon.configDefaults, ...config },
    configVersion: addon.configVersion,
  });
  let status = 200;
  let body: string | null = null;
  const calls: AddonHttpRequest[] = [];
  const http: AddonHttpClient = {
    async fetch(request) {
      calls.push(request);
      const text =
        body ?? JSON.stringify(request.url.endsWith('/api/collections') ? collections : answer);
      return {
        status,
        headers: {},
        text: () => text,
        json: () => JSON.parse(text) as unknown,
        bytes: () => new TextEncoder().encode(text),
      };
    },
  };
  const runtime = new AddonRuntime({ addons: [addon], instances, http });
  const signal = new AbortController().signal;
  return {
    runtime,
    instances,
    instance,
    calls,
    ask: (query: unknown) => runtime.invoke(tool, null, null, signal, { instanceRef: null, query }),
    respond: (nextStatus: number, nextBody: string | null) => {
      status = nextStatus;
      body = nextBody;
    },
  };
}

test('définition v1 et configuration par défaut', (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...addon.configDefaults, baseUrl: 'http://h/api' }).ok,
    false,
  );
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...addon.configDefaults, baseUrl: 'ftp://h' }).ok,
    false,
  );
  assert.deepEqual(
    f.runtime.tools().map((descriptor) => descriptor.name),
    [tool],
  );
});

test('une question part à Ragator et revient en carte citée, sans les citations à l’oral', async (t) => {
  const f = setup(t, { collection: 'les-freres-poulain' });
  const invoked = await f.ask('  À quoi sert le module Peltier de la glacière ?  ');
  assert.ok(invoked);
  const { outcome, tool: result } = invoked;
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(f.calls[0]?.url, 'http://127.0.0.1:3210/api/ask');
  assert.equal(f.calls[0]?.method, 'POST');
  assert.ok(f.calls[0]?.signal);
  assert.deepEqual(JSON.parse(f.calls[0]!.body!), {
    question: 'À quoi sert le module Peltier de la glacière ?',
    mode: 'court',
    collection: 'les-freres-poulain',
  });
  assert.equal(outcome.card.subtitle, 'À quoi sert le module Peltier de la glacière ?');
  assert.doesNotMatch(outcome.presentation.summary, /\[|t00062/);
  assert.match(outcome.presentation.summary, /^Le module Peltier transfère la chaleur/);
  assert.deepEqual(outcome.card.items, [
    {
      label: 'Les glacières sur batterie coûtent 1100 €. La nôtre : 54 €',
      value: 'à 3:45 · vidéo du 13/08/2026',
    },
  ]);
  assert.equal(validators.moduleSnapshot(outcome.snapshot), true);
  assert.equal(validators.moduleCard(outcome.card), true);
  assert.equal(validators.toolResult(result), true);
  assert.equal(result.status, 'succeeded');
});

test('chaque question est posée à nouveau, sans cache ni relevé enregistré', async (t) => {
  const f = setup(t);
  const first = await f.ask('Question une ?');
  const second = await f.ask('Question deux ?');
  assert.equal(f.calls.length, 2);
  assert.equal(first?.outcome.ok && second?.outcome.ok, true);
  if (!first?.outcome.ok || !second?.outcome.ok) return;
  assert.notEqual(first.outcome.snapshot.snapshotId, second.outcome.snapshot.snapshotId);
  assert.equal(f.instances.getSnapshot(f.instance), null);
});

test('une panne ne ressert jamais la réponse à une autre question', async (t) => {
  const f = setup(t);
  assert.equal((await f.ask('Question une ?'))?.outcome.ok, true);
  f.respond(503, '{}');
  const failed = await f.ask('Question deux ?');
  assert.equal(failed?.outcome.ok, false);
  if (failed?.outcome.ok !== false) return;
  assert.equal(failed.outcome.error.code, 'unavailable');
  assert.equal(failed.outcome.summary, 'Source indisponible : Ragator a rencontré une erreur.');
});

test('le mode détaillé est transmis', async (t) => {
  const f = setup(t, { detailed: true });
  await f.ask('Question ?');
  assert.equal(JSON.parse(f.calls[0]!.body!).mode, 'détaillé');
  assert.equal(JSON.parse(f.calls[0]!.body!).collection, undefined);
});

test('une question absente ou trop longue ne part pas', async (t) => {
  const f = setup(t);
  for (const query of [undefined, '', '   ', 42, 'x'.repeat(1001)]) {
    const invoked = await f.ask(query);
    assert.equal(invoked?.outcome.ok, false);
    if (invoked?.outcome.ok === false) assert.equal(invoked.outcome.error.code, 'invalid_params');
  }
  assert.equal(f.calls.length, 0);
});

test('un refus de Ragator est rapporté tel quel, sans source', async (t) => {
  const f = setup(t);
  f.respond(
    200,
    JSON.stringify({
      ...answer,
      answer: 'Le corpus ne fournit pas cette information.',
      refused: true,
      sources: [],
    }),
  );
  const invoked = await f.ask('Quelle est la couleur du ciel sur Mars ?');
  assert.equal(invoked?.outcome.ok, true);
  if (!invoked?.outcome.ok) return;
  assert.equal(invoked.outcome.presentation.summary, 'Le corpus ne fournit pas cette information.');
  assert.deepEqual(invoked.outcome.card.items, []);
});

test('une longue réponse générale tient dans la carte : cinq vidéos, texte coupé', async (t) => {
  const f = setup(t);
  const sources = Array.from({ length: 8 }, (_, index) => ({
    ...answer.sources[0],
    videoId: `video${String(index).padStart(6, '0')}`,
    title: `Vidéo ${index} ${'très longue '.repeat(10)}`,
    startS: 3725.6,
  }));
  f.respond(
    200,
    JSON.stringify({
      ...answer,
      route: 'chercher',
      answer: Array.from({ length: 40 }, (_, i) => `Ligne ${i} [video${i}:t00001 @ 01:02].`).join(
        '\n',
      ),
      degradedReason: 'recherche lexicale seule',
      sources: [...sources, sources[0]],
    }),
  );
  const invoked = await f.ask('Quand utilisent-ils de la résine époxy ?');
  assert.equal(invoked?.outcome.ok, true);
  if (!invoked?.outcome.ok) return;
  const card = invoked.outcome.card;
  assert.equal(card.items.length, 5);
  assert.equal(card.items[0]?.value, 'à 1:02:05 · vidéo du 13/08/2026');
  assert.ok((card.description ?? '').length <= 500);
  assert.match(invoked.outcome.presentation.summary, /\(Réponse dégradée\.\)$/);
  assert.equal(validators.moduleCard(card), true);
});

test('les statuts de Ragator deviennent des erreurs compréhensibles', async (t) => {
  const cases: [number, string, string][] = [
    [401, '{}', 'auth'],
    [403, '{"error":"hôte refusé"}', 'forbidden'],
    [429, '{}', 'quota'],
    [400, '{"error":"collection inconnue « x » ; collections : a"}', 'not_found'],
    [404, '{}', 'not_found'],
    [200, 'pas du json', 'malformed'],
    [200, '{"answer":"ok"}', 'malformed'],
  ];
  for (const [status, body, code] of cases) {
    const f = setup(t, { collection: 'x' });
    f.respond(status, body);
    const invoked = await f.ask('Question ?');
    assert.equal(invoked?.outcome.ok, false, `${status} ${body}`);
    if (invoked?.outcome.ok === false) assert.equal(invoked.outcome.error.code, code);
  }
});

test('Tester vérifie la connexion et la collection, sans poser de question', async (t) => {
  const f = setup(t, { collection: 'Les Frères Poulain' });
  const snapshot = await f.runtime.test(f.instance);
  assert.equal(f.calls[0]?.url, 'http://127.0.0.1:3210/api/collections');
  assert.equal(f.calls[0]?.method, 'GET');
  assert.equal(snapshot.status, 'ready');
  assert.deepEqual(snapshot.data, {
    kind: 'status',
    videos: 404,
    collections: 2,
    collection: 'Les Freres Poulain',
  });
  assert.equal(validators.moduleSnapshot(snapshot), true);
});

test('Tester signale une collection inconnue', async (t) => {
  const f = setup(t, { collection: 'inconnue' });
  const snapshot = await f.runtime.test(f.instance);
  assert.equal(snapshot.status, 'error');
  assert.equal(f.instances.getError(f.instance.id)?.code, 'not_found');
});

test('une source inconnue ne déclenche aucune requête', async (t) => {
  const f = setup(t);
  const invoked = await f.runtime.invoke(tool, null, 'autre', new AbortController().signal, {
    query: 'Question ?',
  });
  assert.equal(invoked?.outcome.ok, false);
  assert.equal(f.calls.length, 0);
});
