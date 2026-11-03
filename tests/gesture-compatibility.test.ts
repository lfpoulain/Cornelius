import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/storage.js';
import { SatelliteStore } from '../server/satellites-store.js';
import { SatelliteGestures, validateGestureConfig } from '../server/satellite-gestures.js';
import { defaultGestureConfig, GESTURES, type Gesture } from '../shared/satellite-gestures.js';
import type { SatelliteHub } from '../server/satellites.js';
import type { SessionController } from '../server/controller.js';
import type { HomeAssistant } from '../server/home-assistant.js';
test('migration additive et lecture des anciens réglages sans modification', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const store = new SatelliteStore(db, () => 1);
  const satellite = store.create('Legacy').satellite;
  const before = JSON.stringify(store.list());
  const gestures = new SatelliteGestures({
    db,
    store,
    hub: {} as SatelliteHub,
    controller: {} as SessionController,
    home: {} as HomeAssistant,
  });
  assert.deepEqual(gestures.config(satellite.id), defaultGestureConfig());
  assert.equal(JSON.stringify(store.list()), before);
  assert.equal(
    validateGestureConfig({ ...defaultGestureConfig(), lightEntityIds: ['lock.door'] }),
    false,
  );
  assert.equal(
    validateGestureConfig({ ...defaultGestureConfig(), lightEntityIds: ['light.desk'] }),
    true,
  );
  assert.equal(GESTURES.length, 7);
});
test('aucune commande implicite sans lampe sélectionnée ; cercles inertes', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const store = new SatelliteStore(db, () => 1);
  const s = store.create('Office').satellite;
  let calls = 0;
  const home = {
    view: () => ({ selected: ['light.desk'], entities: [{ id: 'light.desk', domain: 'light' }] }),
    runSatelliteGesture: async () => {
      calls++;
      return { status: 'succeeded', result: { confirmed: true } };
    },
  } as unknown as HomeAssistant;
  const g = new SatelliteGestures({
    db,
    store,
    home,
    hub: { status: () => ({ online: true }) } as unknown as SatelliteHub,
    controller: {} as SessionController,
  });
  const config = defaultGestureConfig();
  config.enabled = true;
  config.bindings.right = 'lights_on';
  g.save(s.id, config);
  await g.receive(s.id, 'right');
  assert.equal(calls, 0);
  await g.receive(s.id, 'clockwise' as Gesture);
  assert.equal(calls, 0);
});

test('lampe explicite autorisée puis révocation et désactivation des gestes', async (t) => {
  let clock = 100000;
  t.mock.method(Date, 'now', () => clock);
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const store = new SatelliteStore(db, () => 1);
  const s = store.create('Office').satellite;
  let calls = 0;
  let selected = ['light.desk'];
  const home = {
    view: () => ({ selected, entities: [{ id: 'light.desk', domain: 'light' }] }),
    runSatelliteGesture: async (args: unknown) => {
      assert.deepEqual(args, { entityId: 'light.desk', action: 'turn_on', brightnessPct: null });
      calls++;
      return { status: 'succeeded', result: { confirmed: true } };
    },
  } as unknown as HomeAssistant;
  const g = new SatelliteGestures({
    db,
    store,
    home,
    hub: { status: () => ({ online: true }) } as unknown as SatelliteHub,
    controller: {} as SessionController,
  });
  const config = defaultGestureConfig();
  config.enabled = true;
  config.bindings.right = 'lights_on';
  config.lightEntityIds = ['light.desk'];
  g.save(s.id, config);
  await g.receive(s.id, 'right');
  assert.equal(calls, 1);
  clock += 1000;
  selected = [];
  await g.receive(s.id, 'right');
  assert.equal(calls, 1);
  clock += 1000;
  selected = ['light.desk'];
  config.enabled = false;
  g.save(s.id, config);
  await g.receive(s.id, 'right');
  assert.equal(calls, 1);
});
