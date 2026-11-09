import assert from 'node:assert/strict';
import test from 'node:test';
import { setSatelliteVolume } from '../server/satellite-volume.js';
import { SatelliteStore } from '../server/satellites-store.js';
import { openDatabase } from '../server/storage.js';

function fixture() {
  const db = openDatabase(':memory:');
  const store = new SatelliteStore(db, () => 1000);
  const { satellite } = store.create('Bureau');
  const sent: number[] = [];
  const hub = { refresh: (updated: { volume: number }) => void sent.push(updated.volume) };
  const run = (args: unknown) => setSatelliteVolume(store, hub, satellite.id, args);
  return { db, store, satellite, sent, run };
}

test('volume à la voix : niveau dit, plus fort, moins fort, bornes', () => {
  const f = fixture();
  try {
    // Par défaut 70 en base, soit 7 sur 10.
    const set = f.run({ level: 4, change: null });
    assert.equal(set.status, 'succeeded');
    assert.equal(set.summary, 'Volume réglé à 4 sur 10.');
    assert.equal(f.store.get(f.satellite.id)?.volume, 40);
    assert.deepEqual(f.sent, [40]);
    assert.equal(f.run({ level: null, change: 'louder' }).result?.level, 6);
    assert.equal(f.run({ level: null, change: 'quieter' }).result?.level, 4);
    f.run({ level: 10, change: null });
    assert.match(f.run({ level: null, change: 'louder' }).summary, /déjà à 10 sur 10, le maximum/u);
    f.run({ level: 1, change: null });
    const muted = f.run({ level: null, change: 'quieter' });
    assert.equal(muted.result?.level, 0);
    // Les sonneries du satellite passent par le même volume : Cornelius le rappelle.
    assert.match(muted.summary, /réveils et minuteurs de ce satellite seront muets aussi/u);
    assert.doesNotMatch(f.run({ level: 3, change: null }).summary, /muets/u);
  } finally {
    f.db.close();
  }
});

test('volume à la voix : demandes invalides refusées sans rien changer', () => {
  const f = fixture();
  try {
    for (const args of [
      null,
      {},
      { level: 11, change: null },
      { level: 5, change: 'louder' },
      { level: null, change: null },
      { level: 5.5, change: null },
      { level: null, change: 'max' },
      { level: 5, change: null, satellite: 'autre' },
    ])
      assert.equal(f.run(args).status, 'failed', JSON.stringify(args));
    assert.equal(f.store.get(f.satellite.id)?.volume, 70);
    assert.deepEqual(f.sent, []);
    assert.equal(
      setSatelliteVolume(f.store, { refresh() {} }, 'inconnu', { level: 3, change: null }).status,
      'unknown',
    );
  } finally {
    f.db.close();
  }
});
