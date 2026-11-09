import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../server/storage.js';
import { VoiceUsage, voiceUsageMeasure } from '../server/voice-usage.js';

test('temps de conversation : par jour du foyer et par fournisseur, coût du seul Mistral', () => {
  const db = openDatabase(':memory:');
  try {
    // 31 octobre 23 h 30 à Paris (22 h 30 UTC) : encore octobre pour le foyer.
    let now = Date.parse('2026-10-31T22:30:00Z');
    const usage = new VoiceUsage(
      db,
      () => now,
      () => 'Europe/Paris',
      () => 'mistral',
    );
    usage.add(90, 'mistral');
    now = Date.parse('2026-11-08T20:00:00Z');
    usage.add(117, 'mistral');
    usage.add(37.2, 'openai');
    usage.add(0, 'mistral');
    usage.add(Number.NaN, 'mistral');
    usage.add(60, 'autre' as 'openai');
    let view = usage.view();
    assert.deepEqual(view.today, { seconds: 155, sessions: 2, meteredSeconds: 117, cost: null });
    assert.deepEqual(view.month, { seconds: 155, sessions: 2, meteredSeconds: 117, cost: null });
    assert.deepEqual(view.previousMonth, {
      seconds: 90,
      sessions: 1,
      meteredSeconds: 90,
      cost: null,
    });
    assert.equal(view.perMinute, null);
    assert.equal(view.provider, 'mistral');
    assert.equal(view.meteredProvider, 'mistral');
    usage.setPrice(0.05, '$');
    view = usage.view();
    // Le temps passé avec OpenAI (facturé aux jetons) n’entre pas dans le coût.
    assert.equal(view.month.cost, 0.1);
    assert.equal(view.previousMonth.cost, 0.08);
    // Plus de 70 jours : effacé.
    now = Date.parse('2027-02-01T12:00:00Z');
    usage.add(60, 'openai');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM voice_usage_days WHERE day < '2026-12-01'").get()?.n,
      0,
    );
    assert.deepEqual(usage.view().today, {
      seconds: 60,
      sessions: 1,
      meteredSeconds: 0,
      cost: 0,
    });
  } finally {
    db.close();
  }
});

test('mesure de clôture : seule une conversation prête est comptée, une erreur n’interrompt rien', () => {
  const db = openDatabase(':memory:');
  try {
    const usage = new VoiceUsage(
      db,
      () => Date.parse('2026-11-08T20:00:00Z'),
      () => 'Europe/Paris',
    );
    let provider: 'openai' | 'mistral' = 'openai';
    const errors: unknown[] = [];
    const record = voiceUsageMeasure(
      usage,
      () => provider,
      (error) => errors.push(error),
    );
    record('ouverture', { seconds: 12 });
    record('cloture', { seconds: 30, ready: true });
    // Création refusée par le fournisseur : jamais prête, rien à compter.
    record('cloture', { seconds: 4, ready: false });
    provider = 'mistral';
    record('cloture', { seconds: 45, ready: true });
    assert.deepEqual(usage.view().today, {
      seconds: 75,
      sessions: 2,
      meteredSeconds: 45,
      cost: null,
    });
    const failing = voiceUsageMeasure(
      {
        add: () => {
          throw new Error('database is locked');
        },
      },
      () => provider,
      (error) => errors.push(error),
    );
    assert.doesNotThrow(() => failing('cloture', { seconds: 10, ready: true }));
    assert.equal(errors.length, 1);
  } finally {
    db.close();
  }
});
