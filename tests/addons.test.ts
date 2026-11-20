import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddonHttpClient, AddonHttpRequest } from '../shared/addons.js';
import { validators } from '../shared/validation.js';
import { AddonRepository, openDatabase, ProfileRepository } from '../server/storage.js';
import { AddonRuntime } from '../server/addons/runtime.js';
import { loadAddons, validateAddonDefinition } from '../server/addons/registry.js';
import weatherFixture from '../addons/weather/fixtures/daily.json' with { type: 'json' };
import { weatherLabel } from '../addons/weather/index.js';
import placesFixture from '../addons/transit/fixtures/places.json' with { type: 'json' };
import routesFixture from '../addons/transit/fixtures/routes.json' with { type: 'json' };
import departuresFixture from '../addons/transit/fixtures/departures.json' with { type: 'json' };

interface Stub {
  client: AddonHttpClient;
  calls: AddonHttpRequest[];
  respond: (next: { status: number; body: string }) => void;
  respondWith: (
    handler: (request: AddonHttpRequest) => Promise<{ status: number; body: string }>,
  ) => void;
}

function stub(): Stub {
  let handler: (
    request: AddonHttpRequest,
  ) => Promise<{ status: number; body: string }> = async () => ({
    status: 200,
    body: '{}',
  });
  const calls: AddonHttpRequest[] = [];
  return {
    calls,
    respond: (next) => {
      handler = async () => next;
    },
    respondWith: (next) => {
      handler = next;
    },
    client: {
      async fetch(request) {
        calls.push(request);
        const response = await handler(request);
        return {
          status: response.status,
          headers: {},
          text: () => response.body,
          json: () => JSON.parse(response.body) as unknown,
          bytes: () => new Uint8Array(0),
        };
      },
    },
  };
}

function fixture(secrets: Record<string, string>, startNow = Date.parse('2026-09-17T06:10:00Z')) {
  const db = openDatabase(':memory:');
  const instances = new AddonRepository(db);
  let now = startNow;
  const http = stub();
  const runtime = new AddonRuntime({
    addons: addonRegistry,
    instances,
    http: http.client,
    now: () => now,
    secrets,
  });
  const signal = new AbortController().signal;
  return {
    db,
    instances,
    runtime,
    http,
    signal,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const weatherFixtureBody = JSON.stringify(weatherFixture);
const departuresBody = JSON.stringify(departuresFixture);

/** Les modules sont découverts comme en production : aucun registre écrit à la main. */
// Modules livrés seulement : un dépôt cornelius-modules cloné à côté ne change pas ces tests.
const addonRegistry = (await loadAddons({ externalRoot: null })).addons;

test('le registre découvre les modules du dossier addons et applique le contrat v1', () => {
  // Au moins les modules livrés : un module ajouté dans addons/ ne doit pas casser ce test.
  const ids = addonRegistry.map((addon) => addon.id);
  for (const id of ['clock', 'transit', 'weather']) assert.ok(ids.includes(id), id);
  assert.equal(
    addonRegistry.every((addon) => addon.apiVersion === 1 && addon.id.length > 0),
    true,
  );
});

function weather(t: { after: (fn: () => void) => void }) {
  const f = fixture({ meteoConceptToken: 'jeton-test' });
  t.after(() => f.db.close());
  f.instances.createInstance({
    addonId: 'weather',
    profileId: null,
    ref: 'foyer',
    label: 'Météo du foyer',
    config: { insee: '75056', lat: null, lon: null, days: 3 },
    configVersion: 1,
  });
  return f;
}

/** Arrêt Hôtel de Ville (Paris) ; le 18/09/2026 11:05 heure de Paris. */
function transit(t: { after: (fn: () => void) => void }) {
  const f = fixture({ primApiKey: 'cle-test' }, Date.parse('2026-09-18T09:05:00Z'));
  t.after(() => f.db.close());
  f.instances.createInstance({
    addonId: 'transit',
    profileId: null,
    ref: 'maison',
    label: 'Bus maison',
    config: {
      stopAreaId: 'stop_area:IDFM:71264',
      stopAreaLabel: 'Hôtel de Ville (Paris)',
      routeId: null,
      routeLabel: null,
    },
    configVersion: 1,
  });
  return f;
}

test('la météo collecte, normalise, date et présente une carte spécialisée valide', async (t) => {
  const f = weather(t);
  f.http.respond({ status: 200, body: weatherFixtureBody });
  const outcome = await f.runtime.read('weather', null, 'foyer', f.signal);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.snapshot.status, 'ready');
  assert.equal(outcome.snapshot.revision, 1);
  assert.equal(outcome.snapshot.moduleId, 'weather');
  assert.equal(outcome.snapshot.dataVersion, 1);
  assert.equal(outcome.snapshot.fetchedAt, '2026-09-17T06:10:00.000Z');
  assert.equal(outcome.snapshot.validUntil, '2026-09-17T06:40:00.000Z');
  assert.equal(
    validators.moduleSnapshot(outcome.snapshot),
    true,
    JSON.stringify(validators.moduleSnapshot.errors),
  );
  assert.equal(
    validators.moduleCard(outcome.card),
    true,
    JSON.stringify(validators.moduleCard.errors),
  );
  assert.equal(outcome.card.cardType, 'module');
  assert.equal(outcome.card.addonId, 'weather');
  assert.equal(outcome.card.primaryValue, '12 / 21 °C');
  assert.equal(outcome.card.subtitle, 'Paris · Peu nuageux');
  assert.equal(outcome.card.stale, false);
  assert.match(outcome.presentation.summary, /Météo à Paris/);
  assert.equal(f.http.calls.length, 1);
  assert.match(f.http.calls[0]!.url, /forecast\/daily\?insee=75056/u);
});

test('la météo ne conserve que le nombre de jours configuré malgré les 14 renvoyés', async (t) => {
  const f = weather(t);
  const forecast = Array.from({ length: 14 }, (_, index) => ({
    datetime: `2026-09-${String(index + 1).padStart(2, '0')}`,
    tmin: 10,
    tmax: 20,
    weather: 0,
    probarain: 0,
    wind10m: 5,
  }));
  f.http.respond({
    status: 200,
    body: JSON.stringify({ city: { name: 'Paris' }, forecast }),
  });
  const outcome = await f.runtime.read('weather', null, 'foyer', f.signal);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal((outcome.snapshot.data!.days as unknown[]).length, 3);
  assert.equal(outcome.snapshot.status, 'ready');
});

test('le bus collecte les passages Navitia et présente une carte spécialisée valide', async (t) => {
  const f = transit(t);
  f.http.respond({ status: 200, body: departuresBody });
  const outcome = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.snapshot.status, 'ready');
  assert.equal(outcome.card.primaryValue, '2 min');
  assert.equal(outcome.card.subtitle, 'Ligne 72 → Gare de Lyon (Paris)');
  assert.match(outcome.presentation.summary, /dans 2 minutes/);
  assert.equal(outcome.card.items[0]!.label, 'Prochain');
  assert.match(f.http.calls[0]!.url, /stop_areas\/stop_area:IDFM:71264\/departures/u);
  assert.equal(f.http.calls[0]!.headers?.apikey, 'cle-test');
});

test('PRIM : réponses allégées, et une réponse illisible dit pourquoi', async (t) => {
  const f = transit(t);
  f.http.respond({ status: 200, body: departuresBody });
  assert.equal((await f.runtime.read('transit', null, 'maison', f.signal)).ok, true);
  assert.match(f.http.calls[0]!.url, /[?&]disable_geojson=true(&|$)/u);
  // Les réponses Navitia dépassent vite la limite par défaut de 256 Ko.
  assert.ok((f.http.calls[0]!.maxBytes ?? 0) >= 1024 * 1024);
  for (const [body, message] of [
    ['<html><body>Maintenance</body></html>', /une page web/u],
    ['{"departures": [', /^Réponse PRIM illisible\.$/u],
    ['{"departures": [' + ' '.repeat(4 * 1024 * 1024), /trop volumineuse/u],
  ] as const) {
    const fresh = transit(t);
    fresh.http.respond({ status: 200, body });
    const outcome = await fresh.runtime.read('transit', null, 'maison', fresh.signal);
    assert.equal(outcome.ok, false);
    if (outcome.ok) continue;
    assert.equal(outcome.error.code, 'malformed');
    assert.match(outcome.error.message, message);
  }
});

test('un filtre de direction ne garde que la route choisie', async (t) => {
  const f = transit(t);
  const instance = f.instances.listInstances()[0]!;
  f.instances.updateInstance(instance.id, {
    config: {
      stopAreaId: 'stop_area:IDFM:71264',
      stopAreaLabel: 'Hôtel de Ville (Paris)',
      routeId: 'route:IDFM:C01072-inbound',
      routeLabel: '72 → Gare de Lyon (Paris)',
    },
  });
  f.http.respond({ status: 200, body: departuresBody });
  const outcome = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.snapshot.data!.direction, 'Gare de Lyon (Paris)');
  const departures = outcome.snapshot.data!.departures as {
    id: string;
    cancelled: boolean;
  }[];
  assert.equal(departures.filter((departure) => !departure.cancelled).length, 2);
  assert.equal(
    departures.every((departure) => departure.id.startsWith('route:IDFM:C01072-inbound')),
    true,
  );
});

test('un cache frais évite un second appel et l’expiration déclenche une nouvelle collecte', async (t) => {
  const f = transit(t);
  f.http.respond({ status: 200, body: departuresBody });
  const first = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(first.ok, true);
  const cached = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(cached.ok, true);
  assert.equal(f.http.calls.length, 1);
  f.advance(61_000);
  await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(f.http.calls.length, 2);
  const second = f.instances.getSnapshot(f.instances.listInstances()[0]!);
  assert.equal(second?.revision, 2);
});

test('des collectes concurrentes sont regroupées en une seule requête', async (t) => {
  const f = transit(t);
  let release!: () => void;
  f.http.respondWith(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ status: 200, body: departuresBody });
      }),
  );
  const first = f.runtime.read('transit', null, 'maison', f.signal);
  const second = f.runtime.read('transit', null, 'maison', f.signal);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(f.http.calls.length, 1);
});

test('un échec après un succès conserve le dernier fait en le marquant périmé', async (t) => {
  const f = transit(t);
  f.http.respond({ status: 200, body: departuresBody });
  await f.runtime.read('transit', null, 'maison', f.signal);
  f.advance(61_000);
  f.http.respond({ status: 503, body: '{}' });
  const stale = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(stale.ok, true);
  if (!stale.ok) return;
  assert.equal(stale.stale, true);
  assert.equal(stale.card.stale, true);
  assert.equal(stale.card.primaryValue, '1 min');
  assert.equal(
    validators.moduleCard(stale.card),
    true,
    JSON.stringify(validators.moduleCard.errors),
  );
  assert.equal(stale.snapshot.status, 'stale');
  assert.equal(
    validators.moduleSnapshot(stale.snapshot),
    true,
    JSON.stringify(validators.moduleSnapshot.errors),
  );
  const tool = f.runtime.toolResult(stale);
  assert.equal(tool.status, 'stale');
  assert.equal(validators.toolResult(tool), true, JSON.stringify(validators.toolResult.errors));
});

test('une première collecte en erreur ne prétend pas avoir un dernier succès', async (t) => {
  const f = transit(t);
  f.http.respond({ status: 503, body: '{}' });
  const outcome = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.status, 'failed');
  const stored = f.instances.getSnapshot(f.instances.listInstances()[0]!)!;
  assert.equal(stored.status, 'error');
  assert.equal(stored.data, null);
  assert.equal(stored.revision, 0);
  assert.equal(stored.fetchedAt, null);
  assert.equal(stored.validUntil, null);
  assert.equal(
    validators.moduleSnapshot(stored),
    true,
    JSON.stringify(validators.moduleSnapshot.errors),
  );
  const tool = f.runtime.toolResult(outcome);
  assert.equal(tool.status, 'failed');
  assert.equal(tool.error?.code, 'unavailable');
  assert.equal(tool.error?.retryable, true);
});

test('une configuration incomplète est refusée avant tout appel réseau', async (t) => {
  const f = weather(t);
  f.instances.createInstance({
    addonId: 'weather',
    profileId: null,
    ref: 'vide',
    label: 'Sans lieu',
    config: { insee: null, lat: null, lon: null, days: 3 },
    configVersion: 1,
  });
  const outcome = await f.runtime.read('weather', null, 'vide', f.signal);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, 'config_invalid');
  assert.equal(f.http.calls.length, 0);
});

test('un arrêt non choisi est refusé avant tout appel réseau', async (t) => {
  const f = transit(t);
  f.instances.createInstance({
    addonId: 'transit',
    profileId: null,
    ref: 'vide',
    label: 'Sans arrêt',
    config: { stopAreaId: '', stopAreaLabel: '', routeId: null, routeLabel: null },
    configVersion: 1,
  });
  const outcome = await f.runtime.read('transit', null, 'vide', f.signal);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, 'config_invalid');
  assert.equal(f.http.calls.length, 0);
});

test('le serveur résout l’instance autorisée et refuse une référence ambiguë', async (t) => {
  const f = transit(t);
  f.instances.createInstance({
    addonId: 'transit',
    profileId: null,
    ref: 'travail',
    label: 'Bus travail',
    config: {
      stopAreaId: 'stop_area:IDFM:99999',
      stopAreaLabel: 'Autre arrêt',
      routeId: null,
      routeLabel: null,
    },
    configVersion: 1,
  });
  f.http.respond({ status: 200, body: departuresBody });
  const ambiguous = await f.runtime.read('transit', null, null, f.signal);
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.equal(ambiguous.error.code, 'config_invalid');
  const resolved = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(resolved.ok, true);
  const unknown = await f.runtime.read('transit', null, 'absent', f.signal);
  assert.equal(unknown.ok, false);
  const unknownAddon = await f.runtime.read('inconnu', null, null, f.signal);
  assert.equal(unknownAddon.ok, false);
  if (!unknownAddon.ok) assert.equal(unknownAddon.error.code, 'not_found');
});

test('la recherche assistée trouve un arrêt puis ses directions', async (t) => {
  const f = transit(t);
  f.http.respondWith(async (request) => {
    if (request.url.includes('/places?'))
      return { status: 200, body: JSON.stringify(placesFixture) };
    if (request.url.includes('/routes?'))
      return { status: 200, body: JSON.stringify(routesFixture) };
    return { status: 404, body: '{}' };
  });
  const places = await f.runtime.search(
    'transit',
    { kind: 'place', query: 'Hôtel de Ville' },
    f.signal,
  );
  assert.deepEqual(places, [
    {
      id: 'stop_area:IDFM:71264',
      label: 'Hôtel de Ville (Paris)',
      detail: 'Paris · 75056',
    },
  ]);
  const routes = await f.runtime.search(
    'transit',
    { kind: 'route', values: { stopAreaId: 'stop_area:IDFM:71264' } },
    f.signal,
  );
  assert.deepEqual(routes, [
    { id: 'route:IDFM:C01072-inbound', label: '72 → Gare de Lyon (Paris)' },
    {
      id: 'route:IDFM:C01072-outbound',
      label: '72 → Parc de Saint-Cloud (Saint-Cloud)',
    },
  ]);
  const filtered = await f.runtime.search(
    'transit',
    { kind: 'route', query: 'lyon', values: { stopAreaId: 'stop_area:IDFM:71264' } },
    f.signal,
  );
  assert.equal(filtered.length, 1);
  await assert.rejects(
    () => f.runtime.search('transit', { kind: 'inconnu' }, f.signal),
    /inconnu/u,
  );
  await assert.rejects(
    () => f.runtime.search('weather', { kind: 'place' }, f.signal),
    /indisponible/u,
  );
});

test('les outils exposés portent le préfixe du module et l’instanceRef requis', () => {
  const f = fixture({});
  try {
    const tools = f.runtime.tools();
    const names = tools.map((tool) => tool.name);
    for (const name of ['clock__read', 'transit__read', 'weather__read'])
      assert.ok(names.includes(name), name);
    for (const tool of tools) {
      // Un outil à la demande (ragator__ask) exige aussi sa question.
      assert.deepEqual(
        tool.parameters.required,
        tool.name === 'ragator__ask' ? ['instanceRef', 'query'] : ['instanceRef'],
      );
    }
    assert.deepEqual(f.runtime.parseTool('transit__read'), {
      addonId: 'transit',
      toolName: 'read',
    });
    assert.equal(f.runtime.parseTool('ui__show_luna_card'), null);
    assert.equal(f.runtime.parseTool('transit__write'), null);
    assert.equal(f.runtime.sourceLabel('transit'), 'Île-de-France Mobilités');
    assert.equal(f.runtime.sourceLabel('weather'), 'Météo Concept');
    assert.deepEqual(
      f.runtime
        .definitions()
        .find((addon) => addon.id === 'transit')!
        .search.map((field) => field.kind),
      ['place', 'route'],
    );
    assert.deepEqual(f.runtime.definitions().find((addon) => addon.id === 'weather')!.search, []);
  } finally {
    f.db.close();
  }
});

test('les libellés météo suivent la table officielle des codes temps', () => {
  assert.equal(weatherLabel(0), 'Soleil');
  assert.equal(weatherLabel(2), 'Ciel voilé');
  assert.equal(weatherLabel(4), 'Très nuageux');
  assert.equal(weatherLabel(5), 'Couvert');
  assert.equal(weatherLabel(6), 'Brouillard');
  assert.equal(weatherLabel(7), 'Brouillard givrant');
  assert.equal(weatherLabel(11), 'Pluie');
  assert.equal(weatherLabel(16), 'Bruine');
  assert.equal(weatherLabel(21), 'Neige');
  assert.equal(weatherLabel(40), 'Averses de pluie');
  assert.equal(weatherLabel(48), 'Averses de pluie');
  assert.equal(weatherLabel(61), 'Averses de neige');
  assert.equal(weatherLabel(105), 'Orages');
  assert.equal(weatherLabel(235), 'Averses de grêle');
  assert.equal(weatherLabel(999), 'Conditions variables');
  assert.equal(weatherLabel(undefined), 'Conditions variables');
});

test('un passage supprimé n’évince pas un passage réel', async (t) => {
  const f = transit(t);
  const visit = (departureTime: string, extra: string[] = []) => ({
    route: { id: 'route:IDFM:C01072-inbound', direction: { name: 'Gare de Lyon (Paris)' } },
    stop_point: { id: 'stop_point:IDFM:71265', name: 'Hôtel de Ville' },
    stop_date_time: {
      departure_date_time: departureTime,
      base_departure_date_time: departureTime || '20260918T114000',
      data_freshness: 'base_schedule',
    },
    display_informations: { label: '72', code: '72', direction: 'Gare de Lyon (Paris)' },
    additional_informations: extra,
  });
  f.http.respond({
    status: 200,
    body: JSON.stringify({
      departures: [visit('', ['cancelled']), visit('', ['deleted']), visit('20260918T113000')],
    }),
  });
  const outcome = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.snapshot.status, 'ready');
  assert.equal(outcome.card.primaryValue, '25 min');
  const departures = outcome.snapshot.data!.departures as { cancelled: boolean }[];
  assert.equal(departures.filter((departure) => !departure.cancelled).length, 1);
});

test('deux profils utilisent chacun leur propre arrêt', async (t) => {
  const f = fixture({ primApiKey: 'cle-test' }, Date.parse('2026-09-18T09:05:00Z'));
  t.after(() => f.db.close());
  const profiles = new ProfileRepository(f.db);
  const alice = profiles.create('Alice');
  const bob = profiles.create('Bob');
  f.instances.createInstance({
    addonId: 'transit',
    profileId: alice.id,
    ref: 'alice',
    label: 'Bus Alice',
    config: {
      stopAreaId: 'stop_area:IDFM:111',
      stopAreaLabel: 'Arrêt d’Alice',
      routeId: null,
      routeLabel: null,
    },
    configVersion: 1,
  });
  f.instances.createInstance({
    addonId: 'transit',
    profileId: bob.id,
    ref: 'bob',
    label: 'Bus Bob',
    config: {
      stopAreaId: 'stop_area:IDFM:222',
      stopAreaLabel: 'Arrêt de Bob',
      routeId: null,
      routeLabel: null,
    },
    configVersion: 1,
  });
  f.http.respond({ status: 200, body: departuresBody });
  const fromAlice = await f.runtime.read('transit', alice.id, null, f.signal);
  const fromBob = await f.runtime.read('transit', bob.id, null, f.signal);
  assert.equal(fromAlice.ok, true);
  assert.equal(fromBob.ok, true);
  assert.match(f.http.calls[0]!.url, /stop_area:IDFM:111/u);
  assert.match(f.http.calls[1]!.url, /stop_area:IDFM:222/u);
  assert.deepEqual(
    f.runtime.sourcesFor(alice.id).map((entry) => entry.label),
    ['Bus Alice'],
  );
  assert.deepEqual(
    f.runtime.sourcesFor(bob.id).map((entry) => entry.label),
    ['Bus Bob'],
  );
});

test('le catalogue expose les sources autorisées avec leur référence', (t) => {
  const f = transit(t);
  assert.deepEqual(f.runtime.sourcesFor(null), [
    { addonId: 'transit', ref: 'maison', label: 'Bus maison' },
  ]);
});

test('la description des outils porte les sources autorisées, jamais un contexte livré', (t) => {
  const f = transit(t);
  const tool = f.runtime.tools(null).find((entry) => entry.name === 'transit__read')!;
  assert.match(tool.description, /Source autorisée : maison \(Bus maison\)/u);
  assert.doesNotMatch(tool.description, /contexte/u);
});

test('un profil résolu sans source autorisée le dit explicitement dans la description', (t) => {
  const f = fixture({ primApiKey: 'cle-test' });
  t.after(() => f.db.close());
  const profiles = new ProfileRepository(f.db);
  const alice = profiles.create('Alice');
  const bob = profiles.create('Bob');
  f.instances.createInstance({
    addonId: 'transit',
    profileId: alice.id,
    ref: 'alice',
    label: 'Bus Alice',
    config: {
      stopAreaId: 'stop_area:IDFM:111',
      stopAreaLabel: 'Arrêt d’Alice',
      routeId: null,
      routeLabel: null,
    },
    configVersion: 1,
  });
  const tool = f.runtime.tools(bob.id).find((entry) => entry.name === 'transit__read')!;
  assert.match(tool.description, /Aucune source/u);
  assert.doesNotMatch(tool.description, /Bus Alice/u);
});

test('un propriétaire non résolu garde une description neutre, sans négation prématurée', (t) => {
  const f = fixture({ meteoConceptToken: 'jeton-test' });
  t.after(() => f.db.close());
  const profiles = new ProfileRepository(f.db);
  const alice = profiles.create('Alice');
  f.instances.createInstance({
    addonId: 'transit',
    profileId: alice.id,
    ref: 'alice',
    label: 'Bus Alice',
    config: {
      stopAreaId: 'stop_area:IDFM:111',
      stopAreaLabel: 'Arrêt d’Alice',
      routeId: null,
      routeLabel: null,
    },
    configVersion: 1,
  });
  // Session anonyme du mode 1 : rien n'est affirmé sur un profil pas encore reconnu.
  const anonymous = f.runtime.tools(null).find((entry) => entry.name === 'transit__read')!;
  assert.doesNotMatch(anonymous.description, /Aucune source/u);
  assert.doesNotMatch(anonymous.description, /Bus Alice/u);
  // Une fois le profil connu, la source autorisée est nommée.
  const recognized = f.runtime.tools(alice.id).find((entry) => entry.name === 'transit__read')!;
  assert.match(recognized.description, /Source autorisée : alice \(Bus Alice\)/u);
});

test('un résultat vide ne fabrique pas de carte mais reste distinct d’une panne', async (t) => {
  const f = weather(t);
  f.http.respond({
    status: 200,
    body: JSON.stringify({ city: { name: 'Paris' }, forecast: [] }),
  });
  const outcome = await f.runtime.read('weather', null, 'foyer', f.signal);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.status, 'empty');
  const stored = f.instances.getSnapshot(f.instances.listInstances()[0]!)!;
  assert.equal(stored.status, 'empty');
  assert.equal(
    validators.moduleSnapshot(stored),
    true,
    JSON.stringify(validators.moduleSnapshot.errors),
  );
});

test('un module invalide est refusé avant sa première lecture', () => {
  const valid = addonRegistry[0]!;
  assert.equal(validateAddonDefinition(valid), null);
  for (const patch of [
    { tools: [{ name: 42 }] },
    { tools: [valid.tools[0], valid.tools[0]] },
    { dataSchema: { type: 'inconnu' } },
    { search: { find: () => [] } },
    { configVersion: 0 },
  ])
    assert.notEqual(validateAddonDefinition({ ...valid, ...patch }), null);
});

test('les jetons déclarés par un module sont facultatifs et contrôlés au chargement', () => {
  const clock = addonRegistry.find((addon) => addon.id === 'clock')!;
  // Rétrocompatible : un module sans jeton déclaré reste valide.
  assert.equal(clock.secrets, undefined);
  assert.equal(validateAddonDefinition(clock), null);
  const secret = {
    name: 'demoToken',
    env: 'CORNELIUS_DEMO_TOKEN',
    label: 'un jeton de démonstration',
    url: 'https://demo.example/inscription',
    note: 'gratuit',
  };
  assert.equal(validateAddonDefinition({ ...clock, secrets: [secret] }), null);
  assert.equal(
    validateAddonDefinition({ ...clock, secrets: [{ name: 'demoToken', env: 'X', label: 'x' }] }),
    null,
  );
  for (const secrets of [
    'CORNELIUS_DEMO_TOKEN',
    [{ ...secret, env: 'cornelius_demo' }],
    [{ ...secret, name: 'nom invalide' }],
    [{ ...secret, label: '  ' }],
    [{ ...secret, url: 'javascript:alert(1)' }],
    [{ ...secret, note: 42 }],
    [secret, secret],
  ])
    assert.notEqual(validateAddonDefinition({ ...clock, secrets }), null, JSON.stringify(secrets));
});

test('météo et transports déclarent les variables .env lues par la configuration', async () => {
  const declared = Object.fromEntries(
    addonRegistry.map((addon) => [addon.id, addon.secrets?.map((secret) => secret.env)]),
  );
  assert.deepEqual(declared.weather, ['CORNELIUS_METEO_CONCEPT_TOKEN']);
  assert.deepEqual(declared.transit, ['CORNELIUS_PRIM_API_KEY']);
  const { loadConfig } = await import('../server/config.js');
  const saved = { ...process.env };
  try {
    process.env.CORNELIUS_ADMIN_PASSWORD = 'mot-de-passe-test';
    process.env.CORNELIUS_METEO_CONCEPT_TOKEN = 'jeton-meteo';
    process.env.CORNELIUS_PRIM_API_KEY = 'cle-prim';
    const config = loadConfig();
    // Le nom déclaré est celui que le module passe à context.secret().
    const secrets: Record<string, string | undefined> = {
      meteoConceptToken: config.meteoConceptToken,
      primApiKey: config.primApiKey,
    };
    for (const addon of addonRegistry)
      for (const secret of addon.secrets ?? [])
        assert.equal(secrets[secret.name], process.env[secret.env], secret.env);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('le catalogue indique la présence d’un jeton, jamais sa valeur', (t) => {
  const absent = fixture({});
  t.after(() => absent.db.close());
  const weatherOf = (f: { runtime: AddonRuntime }) =>
    f.runtime.definitions().find((definition) => definition.id === 'weather')!;
  assert.deepEqual(
    weatherOf(absent).secrets.map((secret) => secret.configured),
    [false],
  );
  const present = fixture({ meteoConceptToken: 'valeur-secrete-meteo' });
  t.after(() => present.db.close());
  assert.equal(weatherOf(present).secrets[0]!.configured, true);
  assert.ok(!JSON.stringify(present.runtime.definitions()).includes('valeur-secrete-meteo'));
  // Un jeton vide ou blanc compte comme absent.
  const blank = fixture({ meteoConceptToken: '   ' });
  t.after(() => blank.db.close());
  assert.equal(weatherOf(blank).secrets[0]!.configured, false);
});

test('la météo accepte les codes INSEE corses et refuse les coordonnées manquantes', (t) => {
  const f = weather(t);
  const config = { insee: '2A004', lat: null, lon: null, days: 3 };
  assert.equal(f.runtime.validateConfig('weather', config).ok, true);
  assert.equal(f.runtime.validateConfig('weather', { ...config, insee: '2B033' }).ok, true);
  assert.equal(f.runtime.validateConfig('weather', { ...config, insee: null }).ok, false);
  assert.equal(
    f.runtime.validateConfig('weather', { ...config, insee: null, lat: 48.85, lon: 2.35 }).ok,
    true,
  );
  assert.equal(weatherLabel(null), 'Conditions variables');
});

test('une météo incomplète ou mal datée ne fabrique pas des faits à zéro', async (t) => {
  for (const body of [
    null,
    {},
    { forecast: [{ datetime: '2026-09-17' }] },
    { forecast: [{ ...weatherFixture.forecast[0], datetime: '2026-02-30' }] },
  ]) {
    const f = weather(t);
    f.http.respond({ status: 200, body: JSON.stringify(body) });
    const result = await f.runtime.read('weather', null, 'foyer', f.signal);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'malformed');
  }
});

test('la recherche d’arrêt ignore adresses et points d’intérêt', async (t) => {
  const f = transit(t);
  f.http.respond({
    status: 200,
    body: JSON.stringify({
      places: [
        ...placesFixture.places,
        { id: 'address:123', name: 'Adresse', embedded_type: 'address' },
      ],
    }),
  });
  const results = await f.runtime.search(
    'transit',
    { kind: 'place', query: 'Hôtel de Ville' },
    f.signal,
  );
  assert.equal(results.length, 1);
  assert.equal(new URL(f.http.calls[0]!.url).searchParams.get('type[]'), 'stop_area');
});

test('la direction choisie filtre la requête avant la limite de passages fournisseur', async (t) => {
  const f = transit(t);
  const instance = f.instances.listInstances()[0]!;
  f.instances.updateInstance(instance.id, {
    config: { ...instance.config, routeId: 'route:IDFM:C01072-inbound' },
  });
  f.http.respond({ status: 200, body: departuresBody });
  await f.runtime.read('transit', null, 'maison', f.signal);
  assert.match(
    f.http.calls[0]!.url,
    /stop_areas\/stop_area:IDFM:71264\/routes\/route:IDFM:C01072-inbound\/departures/u,
  );
});

test('les passages de directions différentes portent leur propre destination', async (t) => {
  const f = transit(t);
  f.http.respond({ status: 200, body: departuresBody });
  const result = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.card.items[1]!.value, /Parc de Saint-Cloud/u);
  assert.match(result.presentation.summary, /horaire théorique/u);
  assert.doesNotMatch(result.card.items.map((item) => item.value).join(' '), /théorique/u);
});

test('des bus anciens ne sont jamais annoncés comme arrivant dans zéro minute', async (t) => {
  const f = transit(t);
  f.http.respond({ status: 200, body: departuresBody });
  await f.runtime.read('transit', null, 'maison', f.signal);
  f.advance(60 * 60_000);
  f.http.respond({ status: 503, body: '{}' });
  const result = await f.runtime.read('transit', null, 'maison', f.signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, null);
  assert.equal(result.card.stale, true);
  assert.match(result.presentation.summary, /dépassés/u);
});

test('un changement d’heure ne décale pas les passages avant la transition', async (t) => {
  const f = transit(t);
  const departure = structuredClone(departuresFixture.departures[0]!);
  departure.stop_date_time.departure_date_time = '20260329T013000';
  departure.stop_date_time.base_departure_date_time = '20260329T013000';
  f.http.respond({ status: 200, body: JSON.stringify({ departures: [departure] }) });
  await f.runtime.read('transit', null, 'maison', f.signal);
  const data = f.instances.getSnapshot(f.instances.listInstances()[0]!)!.data!;
  assert.equal(
    (data.departures as { expectedAt: string }[])[0]!.expectedAt,
    '2026-03-29T00:30:00.000Z',
  );
});

test('une configuration modifiée pendant la collecte conserve uniquement son nouveau résultat', async (t) => {
  const f = weather(t);
  let release!: () => void;
  f.http.respondWith(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ status: 200, body: weatherFixtureBody });
      }),
  );
  const first = f.runtime.read('weather', null, 'foyer', f.signal);
  const instance = f.instances.listInstances()[0]!;
  f.instances.updateInstance(instance.id, { config: { ...instance.config, insee: '35238' } });
  f.instances.clearState(instance.id);
  f.http.respond({
    status: 200,
    body: JSON.stringify({ ...weatherFixture, city: { name: 'Rennes' } }),
  });
  const second = await f.runtime.read('weather', null, 'foyer', f.signal);
  release();
  assert.equal((await first).ok, false);
  assert.equal(second.ok, true);
  assert.equal(f.http.calls.length, 2);
  assert.equal(
    f.instances.getSnapshot(f.instances.getInstance(instance.id)!)!.data!.city,
    'Rennes',
  );
});

test('supprimer une source en cours de collecte ne recrée pas son cache', async (t) => {
  const f = weather(t);
  let release!: () => void;
  f.http.respondWith(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ status: 200, body: weatherFixtureBody });
      }),
  );
  const read = f.runtime.read('weather', null, 'foyer', f.signal);
  const instance = f.instances.listInstances()[0]!;
  f.instances.deleteInstance(instance.id);
  release();
  assert.equal((await read).ok, false);
  assert.equal(f.instances.getSnapshot(instance), null);
});

test('annuler le premier lecteur ne fait pas échouer le second lecteur actif', async (t) => {
  const f = weather(t);
  const controller = new AbortController();
  let release!: () => void;
  f.http.respondWith(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ status: 200, body: weatherFixtureBody });
      }),
  );
  const first = f.runtime.read('weather', null, 'foyer', controller.signal);
  const second = f.runtime.read('weather', null, 'foyer', f.signal);
  controller.abort();
  f.http.respond({ status: 200, body: weatherFixtureBody });
  release();
  assert.equal((await first).ok, false);
  assert.equal((await second).ok, true);
  assert.equal(f.http.calls.length, 2);
});

test('les sept jours configurés sont transmis à l’outil et la carte garde cinq lignes', async (t) => {
  const f = weather(t);
  const instance = f.instances.listInstances()[0]!;
  f.instances.updateInstance(instance.id, { config: { ...instance.config, days: 7 } });
  f.http.respond({
    status: 200,
    body: JSON.stringify({
      ...weatherFixture,
      forecast: Array.from({ length: 7 }, (_, index) => ({
        ...weatherFixture.forecast[0],
        datetime: `2026-09-${17 + index}`,
      })),
    }),
  });
  const outcome = await f.runtime.read('weather', null, 'foyer', f.signal);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.card.items.length, 5);
  assert.equal(validators.moduleCard(outcome.card), true);
  const result = f.runtime.toolResult(outcome);
  assert.equal((result.result!.data as { days: unknown[] }).days.length, 7);
});

test('la météo et les bus produisent leur présentation permanente dédiée', async (t) => {
  for (const kind of ['weather', 'transit'] as const) {
    await t.test(kind, async (t) => {
      const f = kind === 'weather' ? weather(t) : transit(t);
      f.http.respond({
        status: 200,
        body: kind === 'weather' ? weatherFixtureBody : departuresBody,
      });
      const outcome = await f.runtime.read(kind, null, null, f.signal);
      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;
      const display = f.runtime.ambientDisplay(outcome.instance);
      assert.equal(validators.ambientPresentation(display.content), true);
      assert.equal(display.content?.layout, kind === 'weather' ? 'metric' : 'list');
      if (kind === 'transit') assert.ok(display.content!.items.length > 0);
      assert.equal(display.status, 'ready');
    });
  }
});
