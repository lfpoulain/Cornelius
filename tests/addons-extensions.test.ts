import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AddonCollectContext,
  AddonDefinition,
  AddonPresentContext,
} from '../shared/addons.js';
import { validators } from '../shared/validation.js';
import { AddonRuntime } from '../server/addons/runtime.js';
import { validateAddonDefinition } from '../server/addons/registry.js';
import { AddonRepository, openDatabase } from '../server/storage.js';
import demoAddon from './helpers/demo-addon/index.js';

// Le module de démonstration, vu comme une définition quelconque pour être dérivé.
const demo = demoAddon as unknown as AddonDefinition;

/** Extensions compatibles v1 du cœur 0.2.0 : arguments, fuseau, vide dit, 24 h, display. */
function fixture(
  t: { after(fn: () => void): void },
  definition: AddonDefinition,
  options: { timeZone?: string } = {},
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: definition.id,
    profileId: null,
    ref: 'maison',
    label: 'Maison',
    config: { ...definition.configDefaults },
    configVersion: definition.configVersion,
  });
  let now = Date.parse('2026-10-20T08:00:00Z');
  const runtime = new AddonRuntime({
    addons: [definition],
    instances,
    now: () => now,
    timeZone: options.timeZone,
    http: {
      async fetch() {
        return {
          status: 200,
          headers: {},
          text: () => '{"name":"Gare","available":4}',
          json: () => ({ name: 'Gare', available: 4 }),
          bytes: () => new Uint8Array(0),
        };
      },
    },
  });
  return {
    runtime,
    instances,
    instance,
    advance: (ms: number) => {
      now += ms;
    },
    invoke: (args: Record<string, unknown> = {}) =>
      runtime.invoke(`${definition.id}__read`, null, null, new AbortController().signal, {
        instanceRef: null,
        ...args,
      }),
  };
}

const withArguments = (seen: AddonCollectContext[]): AddonDefinition => ({
  ...demo,
  tools: [
    {
      ...demo.tools[0]!,
      arguments: {
        jours: { type: 'integer', minimum: 1, maximum: 14, description: 'Nombre de jours.' },
        carburant: { type: 'string', enum: ['gazole', 'sp98'], description: 'Carburant.' },
        detail: { type: 'boolean', description: 'Réponse détaillée.' },
      },
    },
  ],
  async collect(context) {
    seen.push(context as AddonCollectContext);
    return demo.collect(context);
  },
});

test('les arguments typés sont annoncés au modèle, facultatifs, avec leurs bornes', (t) => {
  const f = fixture(t, withArguments([]));
  assert.equal(validateAddonDefinition(withArguments([])), null);
  const [tool] = f.runtime.tools();
  const parameters = tool!.parameters as {
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };
  assert.deepEqual(parameters.properties.jours, {
    type: ['integer', 'null'],
    minimum: 1,
    maximum: 14,
    description: 'Nombre de jours.',
  });
  assert.deepEqual(parameters.properties.carburant?.enum, ['gazole', 'sp98', null]);
  assert.deepEqual(parameters.required, ['instanceRef', 'jours', 'carburant', 'detail']);
});

test('sans argument, lecture ordinaire en cache ; avec, lecture à la demande', async (t) => {
  const seen: AddonCollectContext[] = [];
  const f = fixture(t, withArguments(seen));
  await f.invoke({ jours: null, carburant: null, detail: null });
  await f.invoke();
  assert.equal(seen.length, 1, 'lecture ordinaire mise en cache');
  assert.equal(seen[0]!.args, undefined);
  const result = await f.invoke({ jours: '3', carburant: 'sp98', detail: false });
  assert.equal(result?.tool.status, 'succeeded');
  assert.deepEqual(seen[1]!.args, { jours: 3, carburant: 'sp98', detail: false });
  await f.invoke({ jours: 3 });
  assert.equal(seen.length, 3, 'une lecture à la demande ne passe pas par le cache');
  // Le relevé enregistré reste celui de la lecture ordinaire.
  assert.match(f.instances.getSnapshot(f.instance)!.snapshotId, /:r1$/u);
});

test('un argument hors bornes ou hors liste est refusé avant la collecte', async (t) => {
  const seen: AddonCollectContext[] = [];
  const f = fixture(t, withArguments(seen));
  for (const [args, message] of [
    [{ jours: 30 }, /entier de 1 à 14/u],
    [{ jours: 2.5 }, /entier de 1 à 14/u],
    [{ carburant: 'diesel' }, /valeur non proposée/u],
    [{ detail: 'oui' }, /oui ou non/u],
  ] as const) {
    const result = await f.invoke(args);
    assert.equal(result?.tool.status, 'failed');
    assert.equal(result?.tool.error?.code, 'invalid_params');
    assert.match(result?.tool.summary ?? '', message);
  }
  assert.equal(seen.length, 0);
});

test('des arguments mal déclarés refusent le module au chargement', () => {
  const tool = demo.tools[0]!;
  for (const args of [
    { instanceRef: { type: 'boolean', description: 'x' } },
    { jours: { type: 'integer', description: 'x' } },
    { jours: { type: 'integer', description: 'x', minimum: 5, maximum: 1 } },
    { choix: { type: 'string', description: 'x', enum: [] } },
    { choix: { type: 'number', description: 'x' } },
    { a: { type: 'boolean', description: '' } },
  ])
    assert.notEqual(
      validateAddonDefinition({ ...demo, tools: [{ ...tool, arguments: args }] }),
      null,
      JSON.stringify(args),
    );
});

test('le fuseau du foyer arrive dans la collecte et la présentation', async (t) => {
  const zones: string[] = [];
  const definition: AddonDefinition = {
    ...demo,
    async collect(context) {
      zones.push(context.timeZone);
      return demo.collect(context);
    },
    present(snapshot, context: AddonPresentContext) {
      zones.push(context.timeZone);
      return demo.present(snapshot, context);
    },
  };
  const paris = fixture(t, definition);
  await paris.invoke();
  const reunion = fixture(t, definition, { timeZone: 'Indian/Reunion' });
  await reunion.invoke();
  assert.deepEqual(zones, ['Europe/Paris', 'Europe/Paris', 'Indian/Reunion', 'Indian/Reunion']);
});

test('la fraîcheur peut aller jusqu’à 24 heures, pas au-delà', async (t) => {
  const f = fixture(t, { ...demo, freshMs: 30 * 24 * 60 * 60 * 1000 });
  await f.invoke();
  const snapshot = f.instances.getSnapshot(f.instance)!;
  assert.equal(
    Date.parse(snapshot.validUntil!) - Date.parse(snapshot.fetchedAt!),
    24 * 60 * 60 * 1000,
  );
});

test('rien à signaler : la carte et la phrase du module, statut « empty »', async (t) => {
  const quiet: AddonDefinition = {
    ...demo,
    async collect(context) {
      return { ...(await demo.collect(context)), empty: true };
    },
    present(snapshot, context) {
      return { ...demo.present(snapshot, context), summary: 'Rien de prévu cette semaine.' };
    },
  };
  const f = fixture(t, quiet);
  const result = await f.invoke();
  assert.equal(result?.outcome.ok, true);
  assert.equal(result?.tool.status, 'empty');
  assert.equal(result?.tool.summary, 'Rien de prévu cette semaine.');
  assert.equal(validators.toolResult(result?.tool), true);

  // Sans phrase du module (exception), la phrase générique du cœur.
  const mute = fixture(t, {
    ...quiet,
    present() {
      throw new Error('Aucune donnée à présenter.');
    },
  });
  const silent = await mute.invoke();
  assert.equal(silent?.outcome.ok, false);
  assert.equal(silent?.tool.status, 'empty');
  assert.match(silent?.tool.summary ?? '', /aucune donnée utile/u);
});

test('display : contrôlé au chargement, transmis au catalogue, aperçu calculé', async (t) => {
  const display = {
    name: 'Parking',
    description: 'Places libres du parking de votre choix.',
    icon: 'car' as const,
    group: 'daily' as const,
    keywords: ['parking', 'places'],
    example: { label: 'Parking de la gare', ref: 'gare' },
    spoken: { head: 'les places', repeats: ['parking'] },
  };
  assert.equal(validateAddonDefinition({ ...demo, display }), null);
  for (const patch of [
    { name: '' },
    { icon: 'licorne' },
    { group: 'capabilities' },
    { example: { label: 'Gare', ref: 'Gare !' } },
    { spoken: { head: 'les places', repeats: ['Parking'] } },
    { description: 'x'.repeat(161) },
  ])
    assert.notEqual(
      validateAddonDefinition({ ...demo, display: { ...display, ...patch } }),
      null,
      JSON.stringify(patch),
    );
  const f = fixture(t, { ...demo, display });
  assert.deepEqual(f.runtime.definitions()[0]?.display, display);
  assert.equal(f.runtime.preview(f.instance), null, 'pas encore de relevé');
  await f.invoke();
  assert.equal(f.runtime.preview(f.instance), '4 places · Gare');
});
