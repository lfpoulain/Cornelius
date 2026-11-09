import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import clockModule from '../addons/clock/index.js';
import type { AddonDefinition } from '../shared/addons.js';
import { ActionExecutor } from '../server/actions.js';
import { registerAddons } from '../server/addons-api.js';
import { validateAddonDefinition } from '../server/addons/registry.js';
import { AddonRuntime } from '../server/addons/runtime.js';
import { DiagnosticLog } from '../server/logs.js';
import {
  ActionRepository,
  AddonRepository,
  openDatabase,
  ProfileRepository,
} from '../server/storage.js';

const clock = clockModule as unknown as AddonDefinition;
const config = { timeZone: 'Europe/Paris', showDate: true, showSeconds: false };
const http = { fetch: () => Promise.reject(new Error('aucun réseau dans ce test')) };

function setup(t: TestContext, addon: AddonDefinition) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const logs = new DiagnosticLog();
  const runtime = new AddonRuntime({ addons: [addon], instances, http, logs });
  instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'salon',
    label: 'Salon',
    config,
    configVersion: 1,
  });
  return {
    runtime,
    instances,
    logs: () => logs.snapshot().entries,
    read: () => runtime.read(addon.id, null, 'salon', new AbortController().signal),
  };
}

test('une exception imprévue du module donne un message simple, le texte brut va au journal', async (t) => {
  const raw = 'TypeError: Cannot read properties of undefined (reading "temp") ' + 'x'.repeat(400);
  const f = setup(t, {
    ...clock,
    async collect() {
      throw new TypeError(raw);
    },
  });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(
    result.summary,
    'Source indisponible : Le module a rencontré une erreur inattendue.',
  );
  assert.deepEqual(result.error, {
    code: 'upstream',
    message: 'Le module a rencontré une erreur inattendue.',
    retryable: false,
  });
  assert.doesNotMatch(JSON.stringify(f.runtime.toolResult(result)), /Cannot read/u);
  const logged = f.logs().find((entry) => entry.event === 'Erreur inattendue du module');
  assert.ok(logged, 'le message brut est journalisé');
  assert.equal(logged.details.message, raw.slice(0, 300));
  assert.equal(logged.details.addonId, 'clock');
});

test('une carte hors contrat est un échec « illisible », pas un succès refusé à l’affichage', async (t) => {
  const f = setup(t, {
    ...clock,
    present(snapshot, context) {
      return { ...clock.present(snapshot, context), title: 'Heure '.repeat(30) };
    },
  });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'malformed');
  assert.equal(result.summary, 'Données reçues mais illisibles.');
  assert.equal(f.runtime.toolResult(result).status, 'failed');
  const logged = f.logs().find((entry) => entry.event === 'Carte de module non conforme');
  assert.ok(logged);
  assert.deepEqual(logged.details.errors, ['/title must NOT have more than 80 characters']);
});

test('la raison d’un module refusé nomme le schéma et le premier message de validation', () => {
  assert.equal(
    validateAddonDefinition({
      ...clock,
      configSchema: { type: 'object', properties: { timeZone: { type: 'texte' } } },
    }),
    'schéma de configuration invalide : data/properties/timeZone/type must be equal to one of the allowed values.',
  );
  assert.equal(
    validateAddonDefinition({ ...clock, dataSchema: { type: 'object', titel: 'x' } }),
    'schéma de données invalide : strict mode: unknown keyword: "titel".',
  );
  const [tool] = clock.tools;
  assert.match(
    validateAddonDefinition({
      ...clock,
      tools: [{ ...tool!, parameters: { type: 'object', minProperties: -1 } }],
    }) ?? '',
    /^paramètres de l’outil « .+ » invalide : data\/minProperties must be >= 0\.$/u,
  );
});

test('un outil à la demande déclare une longueur de question bornée', () => {
  const [tool] = clock.tools;
  assert.equal(
    validateAddonDefinition({ ...clock, tools: [{ ...tool!, query: { maxLength: 500 } }] }),
    null,
  );
  for (const query of [null, {}, { maxLength: 0 }, { maxLength: 2.5 }, { maxLength: 5000 }])
    assert.equal(
      validateAddonDefinition({ ...clock, tools: [{ ...tool!, query }] }),
      'définition d’outil invalide.',
    );
});

test('le catalogue expose les modules refusés et leur raison', async (t) => {
  const db = openDatabase(':memory:');
  const instances = new AddonRepository(db);
  const actionRepository = new ActionRepository(db);
  const app = Fastify();
  const rejected = [{ name: 'parking', reason: 'schéma de données invalide : must be object.' }];
  registerAddons(app, {
    runtime: new AddonRuntime({ addons: [clock], instances, http }),
    actions: new ActionExecutor(actionRepository, http),
    instances,
    actionRepository,
    profiles: new ProfileRepository(db),
    logs: new DiagnosticLog(),
    rejectedAddons: rejected,
    requireAdmin: async () => {},
  });
  t.after(async () => {
    await app.close();
    db.close();
  });
  const catalog = await app.inject({ method: 'GET', url: '/api/admin/addons' });
  assert.equal(catalog.statusCode, 200);
  assert.deepEqual(catalog.json<{ rejected: unknown }>().rejected, rejected);
});

test('le formulaire d’une source reçoit ses réglages migrés, sans écriture en base', async (t) => {
  // Réglages v1 : sans showSeconds. La v2 l'ajoute, allumé, en gardant les choix existants.
  const migrate = (fromVersion: number, value: unknown) => {
    if (fromVersion !== 1) throw new Error(`version ${fromVersion} inconnue`);
    return { ...(value as Record<string, unknown>), showSeconds: true };
  };
  const clockV2: AddonDefinition = { ...clock, configVersion: 2, configMigrate: migrate };
  const broken: AddonDefinition = {
    ...clock,
    id: 'brokenclock',
    configVersion: 2,
    configMigrate: () => {
      throw new Error('migration cassée');
    },
  };
  const db = openDatabase(':memory:');
  const instances = new AddonRepository(db);
  const actionRepository = new ActionRepository(db);
  const logs = new DiagnosticLog();
  const app = Fastify();
  registerAddons(app, {
    runtime: new AddonRuntime({ addons: [clockV2, broken], instances, http, logs }),
    actions: new ActionExecutor(actionRepository, http),
    instances,
    actionRepository,
    profiles: new ProfileRepository(db),
    logs,
    requireAdmin: async () => {},
  });
  t.after(async () => {
    await app.close();
    db.close();
  });
  const stored = { timeZone: 'Europe/Paris', showDate: false };
  const salon = instances.createInstance({
    addonId: 'clock',
    profileId: null,
    ref: 'salon',
    label: 'Salon',
    config: stored,
    configVersion: 1,
  });
  instances.createInstance({
    addonId: 'brokenclock',
    profileId: null,
    ref: 'cuisine',
    label: 'Cuisine',
    config: stored,
    configVersion: 1,
  });

  const catalog = await app.inject({ method: 'GET', url: '/api/admin/addons' });
  assert.equal(catalog.statusCode, 200);
  const views = catalog.json<{
    instances: { addonId: string; config: Record<string, unknown>; configVersion: number }[];
  }>().instances;
  const view = (addonId: string) => views.find((entry) => entry.addonId === addonId);
  assert.deepEqual(view('clock')?.config, { ...stored, showSeconds: true });
  assert.equal(view('clock')?.configVersion, 1);
  // Rien n'est écrit tant que le formulaire n'est pas enregistré.
  assert.deepEqual(instances.getInstance(salon.id)?.config, stored);
  assert.equal(instances.getInstance(salon.id)?.configVersion, 1);
  // Une migration qui lève une erreur ne casse pas la page : réglages bruts, trace au journal.
  assert.deepEqual(view('brokenclock')?.config, stored);
  assert.ok(
    logs
      .snapshot()
      .entries.some(
        (entry) =>
          entry.event === 'Migration des réglages impossible' &&
          entry.details.addonId === 'brokenclock',
      ),
  );
});
