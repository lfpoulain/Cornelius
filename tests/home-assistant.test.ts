import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { HomeAssistant, normalizeEntity } from '../server/home-assistant.js';
import { HomeAssistantRepository } from '../server/home-assistant-store.js';
import { HOME_ASSISTANT_CUT, HOME_ASSISTANT_UNREACHABLE } from '../server/home-assistant-socket.js';
import { openDatabase } from '../server/storage.js';
import { createHttpClient } from '../server/addons/http.js';
import { validators } from '../shared/validation.js';
import { fakeHomeAssistant, haState } from './helpers/home-assistant.js';

async function fixture(t: TestContext) {
  const fake = await fakeHomeAssistant();
  const db = openDatabase(':memory:');
  const repository = new HomeAssistantRepository(db);
  const home = new HomeAssistant(repository, createHttpClient());
  t.after(async () => {
    home.dispose();
    db.close();
    await fake.close();
  });
  await home.configure({ url: fake.url, token: fake.token, revision: 0 });
  // La sélection puis l’autorisation : deux enregistrements distincts, comme dans l’administration.
  const select = (selected = ['light.salon', 'switch.bureau'], enabled = true) => {
    home.select({ selected, revision: home.view().revision });
    return home.setAccess({ enabled, revision: home.view().revision });
  };
  return { fake, db, repository, home, select };
}
const command = (
  entityId = 'light.salon',
  action = 'turn_on',
  brightnessPct: number | null = null,
) => ({ entityId, action, brightnessPct });
const signal = () => new AbortController().signal;
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(20);
  }
  assert.ok(predicate(), 'Condition non atteinte');
}

test('connexion, découverte des lumières, prises et capteurs, secret absent des vues et outils', async (t) => {
  const f = await fixture(t);
  assert.equal(f.home.view().connected, true);
  assert.equal(f.home.view().entities.length, 6);
  assert.equal(f.home.view().entities.find((e) => e.id === 'light.salon')?.brightness, true);
  // Une serrure est lisible, jamais commandable.
  assert.equal(f.home.view().entities.find((e) => e.id === 'lock.porte')?.domain, 'lock');
  assert.deepEqual(f.home.tools(), []);
  f.select();
  assert.equal(f.home.tools().length, 1);
  assert.equal(f.home.tools()[0]!.name, 'home_assistant__control');
  assert.ok(!JSON.stringify([f.home.view(), f.home.tools()]).includes(f.fake.token));
  assert.ok(!JSON.stringify(f.home.tools()).includes('light.cachee'));
  assert.equal(f.repository.get().token, f.fake.token);
  const restored = new HomeAssistant(f.repository, createHttpClient());
  assert.deepEqual(restored.view().selected, ['light.salon', 'switch.bureau']);
  assert.equal(restored.view().connected, false);
  restored.dispose();
});

test('alias Assist chargés, filtrés pour Luna et actualisés sans copier les anciennes valeurs', async (t) => {
  const f = await fixture(t);
  const salon = () => f.home.view().entities.find((entity) => entity.id === 'light.salon');
  assert.deepEqual(salon()?.aliases, ['Lumière du canapé', 'Salon cosy']);
  assert.ok(f.fake.wsCalls.includes('config/entity_registry/get_entries'));
  f.select(['light.salon']);
  let contextRefreshes = 0;
  f.home.onAliasesChanged = () => contextRefreshes++;
  const tool = () => JSON.stringify(f.home.tools());
  assert.ok(tool().includes('Lumière du canapé'));
  assert.ok(!tool().includes('Bureau secret'));
  assert.ok(!tool().includes('Lampe cachée'));
  f.fake.aliases.set('switch.bureau', ['Prise du bureau bis']);
  f.fake.emitRegistry('switch.bureau');
  await until(
    () =>
      f.home.view().entities.find((entity) => entity.id === 'switch.bureau')?.aliases[0] ===
      'Prise du bureau bis',
  );
  assert.equal(contextRefreshes, 0);
  f.fake.states.set('light.salon', haState('light.salon', 'on', true));
  f.fake.emit(f.fake.states.get('light.salon')!);
  await until(() => salon()?.state === 'on');
  assert.deepEqual(salon()?.aliases, ['Lumière du canapé', 'Salon cosy']);

  f.fake.aliases.set('light.salon', ['Coin détente']);
  f.fake.emitRegistry('light.salon');
  await until(() => salon()?.aliases[0] === 'Coin détente');
  assert.deepEqual(salon()?.aliases, ['Coin détente']);
  assert.equal(contextRefreshes, 1);
  assert.ok(tool().includes('Coin détente'));
  assert.ok(!tool().includes('ancienne valeur'));
  assert.ok(!tool().includes('Lumière du canapé'));

  f.fake.aliases.delete('light.salon');
  f.fake.emitRegistry('light.salon');
  await until(() => salon()?.aliases.length === 0);
  assert.ok(!tool().includes('Coin détente'));
  f.fake.aliases.set('light.salon', ['Après reconnexion']);
  f.fake.drop();
  await until(() => !f.home.view().connected);
  await until(() => f.home.view().connected);
  assert.deepEqual(salon()?.aliases, ['Après reconnexion']);
});

test('lecture individuelle des alias si la lecture groupée est indisponible', async (t) => {
  const f = await fixture(t);
  f.select(['light.salon']);
  f.fake.aliases.set('light.salon', ['Canapé de secours']);
  f.fake.options.aliasBatchDenied = true;
  await f.home.refresh();
  assert.deepEqual(f.home.view().entities.find((entity) => entity.id === 'light.salon')?.aliases, [
    'Canapé de secours',
  ]);
  assert.ok(JSON.stringify(f.home.tools()).includes('Canapé de secours'));
});

test('refuse les entités, domaines, actions et paramètres non autorisés sans effet', async (t) => {
  const f = await fixture(t);
  f.select();
  for (const args of [
    command('lock.porte'),
    command('light.cachee'),
    command('all'),
    command('light.salon', 'toggle'),
    command('light.salon', 'turn_on', 101),
    command('light.salon', 'turn_on', 0),
    { ...command(), service: 'lock.unlock' },
    { ...command(), entityId: ['light.salon'] },
    command('switch.bureau', 'turn_on', 50),
    command('light.salon', 'turn_off', 50),
  ])
    assert.equal((await f.home.run(args, signal())).status, 'failed');
  assert.equal(f.fake.calls.length, 0);
  f.select([], false);
  const refused = await f.home.run(command(), signal());
  assert.equal(refused.error?.code, 'forbidden');
  // Le modèle vocal peut répéter ce refus : jamais le nom interne « Luna ».
  assert.equal(refused.summary, 'Cet appareil n’est pas autorisé pour Cornelius.');
});

test('commande précise, luminosité et retour confirmé par un état réel', async (t) => {
  const f = await fixture(t);
  f.select();
  const result = await f.home.run(command('light.salon', 'turn_on', 40), signal());
  assert.equal(result.status, 'succeeded');
  assert.equal(result.result?.confirmed, true);
  assert.equal(validators.toolResult(result), true, JSON.stringify(validators.toolResult.errors));
  assert.deepEqual(f.fake.calls, [
    { path: '/api/services/light/turn_on', body: { entity_id: 'light.salon', brightness_pct: 40 } },
  ]);
  const read = await f.home.run(command('light.salon', 'read'), signal());
  assert.equal(read.result?.confirmed, true);
  assert.equal(f.fake.calls.length, 1);
});

test('un appareil qui remonte son état en différé est quand même confirmé', async (t) => {
  const f = await fixture(t);
  f.select();
  f.fake.options.applyDelayMs = 600;
  const started = Date.now();
  const result = await f.home.run(command('light.salon', 'turn_on', 40), signal());
  assert.equal(result.result?.confirmed, true, result.summary);
  assert.match(result.summary, /confirmé par Home Assistant/);
  assert.ok(Date.now() - started >= 500);
});

test('un accusé HTTP ne devient jamais une confirmation fictive', async (t) => {
  const f = await fixture(t);
  f.select();
  f.fake.options.apply = false;
  const result = await f.home.run(command(), signal());
  assert.equal(result.result?.accepted, true);
  assert.equal(result.result?.confirmed, false);
  assert.match(result.summary, /non confirmé/);
  f.fake.options.serviceStatus = 500;
  const failed = await f.home.run(command(), signal());
  assert.equal(failed.status, 'unknown');
  assert.equal(f.fake.calls.length, 2);
});

test('état indisponible, réponse malformée et session annulée ne déclenchent aucune commande', async (t) => {
  const f = await fixture(t);
  f.select();
  f.fake.states.get('light.salon')!.state = 'unavailable';
  assert.equal((await f.home.run(command(), signal())).status, 'failed');
  f.fake.options.malformed = true;
  assert.equal((await f.home.run(command(), signal())).error?.code, 'malformed');
  const abort = new AbortController();
  abort.abort();
  assert.equal((await f.home.run(command(), abort.signal)).status, 'cancelled');
  assert.equal(f.fake.calls.length, 0);
});

test('une révocation pendant la lecture empêche l’envoi et une révision périmée est refusée', async (t) => {
  const f = await fixture(t);
  f.select();
  f.fake.options.holdRead = true;
  const running = f.home.run(command(), signal());
  await delay(30);
  const oldRevision = f.home.view().revision;
  f.select([], false);
  f.fake.releaseRead();
  assert.equal((await running).status, 'cancelled');
  assert.equal(f.fake.calls.length, 0);
  assert.throws(() => f.home.select({ selected: [], revision: oldRevision }), /actualisez/);
  assert.throws(() => f.home.setAccess({ enabled: true, revision: oldRevision }), /actualisez/);
});

test('l’import Assist respecte les refus explicites et les défauts sans changer les autorisations', async (t) => {
  const f = await fixture(t);
  const result = await f.home.assistSelection();
  assert.deepEqual(result.selected.sort(), ['light.default', 'light.salon']);
  assert.deepEqual(f.home.view().selected, []);
  f.fake.options.assistDenied = true;
  await assert.rejects(f.home.assistSelection(), /Droits/);
  assert.ok(!JSON.stringify(f.home.view()).includes(f.fake.token));
});

test('événements WebSocket, suppression et reconnexion resynchronisent le catalogue', async (t) => {
  const f = await fixture(t);
  f.select();
  f.fake.states.set('light.salon', haState('light.salon', 'on', true));
  f.fake.emit(f.fake.states.get('light.salon')!);
  await until(() => f.home.view().entities.find((e) => e.id === 'light.salon')?.state === 'on');
  f.fake.states.delete('switch.bureau');
  f.fake.emit(null, 'switch.bureau');
  await until(() => !f.home.view().entities.some((e) => e.id === 'switch.bureau'));
  f.fake.drop();
  await until(() => !f.home.view().connected);
  f.fake.states.get('light.salon')!.state = 'off';
  await until(() => f.home.view().connected);
  assert.equal(f.home.view().entities.find((e) => e.id === 'light.salon')?.state, 'off');
});

test('une nouvelle adresse exige son propre jeton et efface les autorisations précédentes', async (t) => {
  const f = await fixture(t);
  f.select();
  const second = await fakeHomeAssistant();
  t.after(() => second.close());
  await assert.rejects(
    f.home.configure({ url: second.url, revision: f.home.view().revision }),
    /nouveau jeton/,
  );
  await assert.rejects(
    f.home.configure({ url: f.fake.url, token: 'bad-token', revision: f.home.view().revision }),
    /refusé/,
  );
  assert.equal(f.home.view().enabled, true);
  await f.home.configure({
    url: second.url,
    token: second.token,
    revision: f.home.view().revision,
  });
  assert.deepEqual(f.home.view().selected, []);
  assert.equal(f.home.view().enabled, false);
  f.home.disconnect(f.home.view().revision);
  assert.equal(f.repository.get().token, '');
  assert.equal(f.home.view().connected, false);
});

test('normalisation ne propose jamais une luminosité pour un interrupteur ou une lampe on/off', () => {
  assert.equal(normalizeEntity(haState('switch.bureau', 'on', true))?.brightness, false);
  assert.equal(normalizeEntity(haState('light.simple'))?.brightness, false);
  assert.equal(normalizeEntity(haState('script.scene')), null);
});

test('les commandes administrateur sont indépendantes de Luna sans étendre ses autorisations', async (t) => {
  const f = await fixture(t);
  assert.equal(f.home.view().enabled, false);
  const manual = await f.home.runManual(command('switch.bureau'), signal());
  assert.equal(manual.result?.confirmed, true);
  assert.deepEqual(f.home.view().selected, []);
  assert.deepEqual(f.home.tools(), []);
  assert.equal((await f.home.run(command('switch.bureau'), signal())).error?.code, 'forbidden');
  f.select(['light.salon']);
  assert.equal(
    (await f.home.runManual(command('switch.bureau', 'turn_off'), signal())).result?.confirmed,
    true,
  );
  assert.equal((await f.home.run(command('switch.bureau'), signal())).error?.code, 'forbidden');
  assert.equal(
    (await f.home.run({ ...command('switch.bureau'), actor: 'admin' }, signal())).error?.code,
    'invalid_params',
  );
  assert.equal(
    (await f.home.runManual(command('switch.inconnu'), signal())).error?.code,
    'forbidden',
  );
  assert.equal(
    (await f.home.runManual(command('lock.porte'), signal())).error?.code,
    'invalid_params',
  );
  assert.equal(f.fake.calls.length, 2);
});

test('capteurs : lecture seule, échéance et durée calculées par le serveur, jamais de commande', async (t) => {
  const f = await fixture(t);
  const sensor = (id: string, state: string, attributes: Record<string, unknown>) =>
    ({
      ...haState(id, state),
      attributes: { friendly_name: id, ...attributes },
    }) as unknown as ReturnType<typeof haState>;
  const now = Date.now();
  const states = [
    sensor('timer.four', 'active', {
      duration: '0:20:00',
      finishes_at: new Date(now + 12.5 * 60_000).toISOString(),
    }),
    sensor('sensor.lave_linge_fin', new Date(now + 45 * 60_000).toISOString(), {
      device_class: 'timestamp',
    }),
    sensor('sensor.lave_linge_restant', '23', { unit_of_measurement: 'min' }),
    sensor('sensor.salon_temperature', '21.5', {
      unit_of_measurement: '°C',
      device_class: 'temperature',
    }),
    sensor('sensor.cave', 'unavailable', {}),
  ];
  for (const state of states) {
    f.fake.states.set(state.entity_id, state);
    f.fake.emit(state);
  }
  await until(() => f.home.view().entities.length === 11);
  f.select([
    'light.salon',
    'timer.four',
    'sensor.lave_linge_fin',
    'sensor.lave_linge_restant',
    'sensor.salon_temperature',
    'sensor.cave',
  ]);
  const tools = f.home.tools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['home_assistant__control', 'home_assistant__read'],
  );
  assert.ok(!JSON.stringify(tools[0]).includes('timer.four'));
  assert.ok(JSON.stringify(tools[1]).includes('sensor.lave_linge_fin'));
  assert.ok(!JSON.stringify(tools[1]).includes('light.salon'));
  const read = (entityId: string) => f.home.run({ entityId }, signal(), 'home_assistant__read');

  const timer = await read('timer.four');
  assert.equal(timer.status, 'succeeded');
  const timerResult = timer.result as { remainingMinutes: number; endsAtLocal: string };
  assert.ok([12, 13].includes(timerResult.remainingMinutes));
  assert.match(timerResult.endsAtLocal, /^\d{2}:\d{2}$/u);
  assert.match(timer.summary, /Fin prévue à \d{2}:\d{2}, dans 1[23] min\./u);

  const end = (await read('sensor.lave_linge_fin')).result as { remainingMinutes: number };
  assert.ok([44, 45].includes(end.remainingMinutes));
  const remaining = (await read('sensor.lave_linge_restant')).result as {
    durationMinutes: number;
    remainingMinutes: number | null;
  };
  assert.equal(remaining.durationMinutes, 23);
  assert.equal(remaining.remainingMinutes, null);
  const temperature = await read('sensor.salon_temperature');
  assert.equal(temperature.status, 'succeeded');
  assert.deepEqual(
    (temperature.result as { entity: { state: string; unit: string } }).entity.state,
    '21.5',
  );
  assert.equal((temperature.result as { entity: { unit: string } }).entity.unit, '°C');
  assert.equal((await read('sensor.cave')).error?.code, 'unavailable');

  // Lire une lumière, un capteur non autorisé ou commander un capteur : refusé.
  assert.equal((await read('light.salon')).error?.code, 'forbidden');
  assert.equal((await read('lock.porte')).error?.code, 'forbidden');
  const command = await f.home.run(
    { entityId: 'timer.four', action: 'turn_off', brightnessPct: null },
    signal(),
  );
  assert.equal(command.error?.code, 'invalid_params');
  assert.equal(f.fake.calls.length, 0);
});

test('import Assist : règles d’exposition par défaut de Home Assistant et plafond de 100 entités', async (t) => {
  const f = await fixture(t);
  const sensor = (id: string, deviceClass: string | null) =>
    ({
      ...haState(id, '1'),
      attributes: { friendly_name: id, ...(deviceClass ? { device_class: deviceClass } : {}) },
    }) as unknown as ReturnType<typeof haState>;
  const added = [
    sensor('sensor.salon_temperature', 'temperature'),
    sensor('sensor.compteur_puissance', 'power'),
    sensor('binary_sensor.porte_entree', 'door'),
    sensor('binary_sensor.batterie_faible', 'battery'),
  ];
  for (const state of added) {
    f.fake.states.set(state.entity_id, state);
    f.fake.emit(state);
    f.fake.registry.push({ entity_id: state.entity_id, options: {} });
  }
  f.fake.registry.push({ entity_id: 'lock.porte', options: {} });
  await until(() => f.home.view().entities.length === 10);
  let result = await f.home.assistSelection();
  // Expositions explicites, puis domaines et classes exposés par défaut par Home Assistant.
  assert.deepEqual(
    new Set(result.selected),
    new Set([
      'light.salon',
      'light.default',
      'sensor.salon_temperature',
      'binary_sensor.porte_entree',
    ]),
  );

  // Un grand catalogue : au plus 100 entités, les expositions explicites d’abord.
  for (let index = 0; index < 120; index++) {
    const state = haState('switch.prise_' + index);
    f.fake.states.set(state.entity_id, state);
    f.fake.emit(state);
    f.fake.registry.push({ entity_id: state.entity_id, options: {} });
  }
  await until(() => f.home.view().entities.length === 130);
  result = await f.home.assistSelection();
  assert.equal(result.selected.length, 100);
  assert.equal(result.selected[0], 'light.salon');
  assert.match(result.warning ?? '', /seules les 100 premières/);
  f.select(result.selected);
  assert.equal(f.home.view().selected.length, 100);
});

test('réservé aux personnes reconnues : outils masqués, appels refusés et réglage conservé', async (t) => {
  const f = await fixture(t);
  f.select(['light.salon', 'lock.porte']);
  // Comportement historique : ouvert à toute conversation.
  assert.equal(f.home.view().knownPeopleOnly, false);
  assert.equal(f.home.tools(false).length, 2);
  f.home.setAccess({ knownPeopleOnly: true, revision: f.home.view().revision });
  assert.equal(f.home.view().knownPeopleOnly, true);
  assert.deepEqual(f.home.tools(false), []);
  assert.deepEqual(
    f.home.tools(true).map((tool) => tool.name),
    ['home_assistant__control', 'home_assistant__read'],
  );

  const calls = f.fake.calls.length;
  const command_ = await f.home.run(command(), signal(), 'home_assistant__control', false);
  assert.equal(command_.status, 'failed');
  assert.equal(command_.error?.code, 'forbidden');
  const lock = await f.home.run(
    { entityId: 'lock.porte' },
    signal(),
    'home_assistant__read',
    false,
  );
  assert.equal(lock.error?.code, 'forbidden');
  assert.equal(f.fake.calls.length, calls, 'aucune commande ne part vers Home Assistant');
  assert.equal(
    (await f.home.run(command(), signal(), 'home_assistant__control', true)).status,
    'succeeded',
  );

  const restored = new HomeAssistant(f.repository, createHttpClient());
  assert.equal(restored.view().knownPeopleOnly, true);
  restored.dispose();
  // Enregistrer la sélection ne touche pas à la règle d’accès.
  f.home.select({ selected: ['light.salon'], revision: f.home.view().revision });
  assert.equal(f.home.view().knownPeopleOnly, true);
  f.home.disconnect(f.home.view().revision);
  assert.equal(f.home.view().knownPeopleOnly, true);
});

test('la sélection et les autorisations s’enregistrent séparément', async (t) => {
  const f = await fixture(t);
  f.home.select({ selected: ['light.salon'], revision: f.home.view().revision });
  assert.deepEqual(f.home.view().selected, ['light.salon']);
  assert.equal(f.home.view().enabled, false, 'la sélection n’active rien');
  assert.deepEqual(f.home.tools(), []);
  f.home.setAccess({ enabled: true, revision: f.home.view().revision });
  assert.equal(f.home.view().enabled, true);
  assert.equal(f.home.view().knownPeopleOnly, false);
  assert.deepEqual(f.home.view().selected, ['light.salon'], 'l’autorisation garde la sélection');
  assert.deepEqual(
    f.home.tools().map((tool) => tool.name),
    ['home_assistant__control'],
  );
  f.home.setAccess({ knownPeopleOnly: true, revision: f.home.view().revision });
  assert.equal(f.home.view().enabled, true, 'chaque réglage ne change que lui-même');
  assert.equal(f.home.view().knownPeopleOnly, true);
  assert.equal(f.repository.get().knownPeopleOnly, true);
});

test('adresse injoignable et coupure en cours d’utilisation ont chacune leur message', async (t) => {
  const db = openDatabase(':memory:');
  const home = new HomeAssistant(new HomeAssistantRepository(db), createHttpClient());
  const fake = await fakeHomeAssistant();
  let closed = false;
  t.after(async () => {
    home.dispose();
    db.close();
    if (!closed) await fake.close();
  });
  // Un port libéré : rien n’y répond.
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  probe.close();
  await once(probe, 'close');
  await assert.rejects(
    home.configure({ url: 'http://127.0.0.1:' + port, token: 'jeton', revision: 0 }),
    (error: Error) => error.message === HOME_ASSISTANT_UNREACHABLE,
  );
  assert.match(HOME_ASSISTANT_UNREACHABLE, /http:\/\/homeassistant\.local:8123/);
  await home.configure({ url: fake.url, token: fake.token, revision: 0 });
  assert.equal(home.view().connected, true);
  await fake.close();
  closed = true;
  await until(() => !home.view().connected);
  assert.equal(home.view().error, HOME_ASSISTANT_CUT);
  // Les nouveaux essais échouent aussi, sans mettre l’adresse en cause.
  await delay(1_300);
  assert.equal(home.view().error, HOME_ASSISTANT_CUT);
});

test('gestes satellite : lampes sélectionnées sans identité, protection vocale et révocation conservées', async (t) => {
  const f = await fixture(t);
  f.select();
  f.home.setAccess({ knownPeopleOnly: true, revision: f.home.view().revision });
  const voice = await f.home.run(command(), signal(), 'home_assistant__control', false);
  assert.equal(voice.status, 'failed');
  assert.equal(f.fake.calls.length, 0);
  const gesture = await f.home.runSatelliteGesture(command(), signal());
  assert.equal(gesture.result?.confirmed, true);
  assert.equal(f.home.view().knownPeopleOnly, true);
  const count = f.fake.calls.length;
  for (const args of [
    command('light.cachee'),
    command('lock.door'),
    command('cover.office', 'open_cover'),
    command('light.salon', 'toggle'),
    command('light.salon', 'turn_on', 50),
  ]) {
    assert.equal((await f.home.runSatelliteGesture(args, signal())).status, 'failed');
  }
  assert.equal(f.fake.calls.length, count);
  f.home.setAccess({ enabled: false, revision: f.home.view().revision });
  assert.equal((await f.home.runSatelliteGesture(command(), signal())).status, 'failed');
  assert.equal(f.fake.calls.length, count);
});
