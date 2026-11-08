import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../server/storage.js';
import { VoiceUsage } from '../server/voice-usage.js';

test('temps de conversation : par jour du foyer, mois en cours et précédent, coût estimé', () => {
  const db = openDatabase(':memory:');
  try {
    // 31 octobre 23 h 30 à Paris (22 h 30 UTC) : encore octobre pour le foyer.
    let now = Date.parse('2026-10-31T22:30:00Z');
    const usage = new VoiceUsage(
      db,
      () => now,
      () => 'Europe/Paris',
    );
    usage.add(90);
    now = Date.parse('2026-11-08T20:00:00Z');
    usage.add(117);
    usage.add(37.2);
    usage.add(0);
    usage.add(Number.NaN);
    let view = usage.view();
    assert.deepEqual(view.today, { seconds: 155, sessions: 2, cost: null });
    assert.deepEqual(view.month, { seconds: 155, sessions: 2, cost: null });
    assert.deepEqual(view.previousMonth, { seconds: 90, sessions: 1, cost: null });
    assert.equal(view.perMinute, null);
    usage.setPrice(0.05, '$');
    view = usage.view();
    assert.equal(view.month.cost, 0.13);
    assert.equal(view.previousMonth.cost, 0.08);
    // Plus de 70 jours : effacé.
    now = Date.parse('2027-02-01T12:00:00Z');
    usage.add(60);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM voice_usage WHERE day < '2026-12-01'").get()?.n,
      0,
    );
    assert.deepEqual(usage.view().today, { seconds: 60, sessions: 1, cost: 0.05 });
  } finally {
    db.close();
  }
});
