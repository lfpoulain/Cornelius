import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryChange, MemoryTurn } from '../shared/memory.js';
import type { ConnectClientEvent, ConnectServerEvent } from 'openai/resources/live/sideband';
import { openDatabase, ProfileRepository, SessionPreferences } from '../server/storage.js';
import { MemoryRepository } from '../server/memory-store.js';
import {
  PersonalMemory,
  type MemoryExtractor,
  type MemoryExtractionInput,
} from '../server/memory.js';
import { SessionController } from '../server/controller.js';
import { LiveTransport } from '../server/live/transport.js';
import type { LiveGateway } from '../server/live/gateway.js';
import { liveConfiguration } from '../server/live/configuration.js';

const change = (patch: Partial<MemoryChange> = {}): MemoryChange => ({
  operation: 'add',
  memoryId: null,
  topic: 'communication',
  fact: 'Préfère des réponses courtes.',
  evidenceTurnIds: ['turn-1'],
  scope: 'durable',
  expiresAt: null,
  ...patch,
});
const proposal = (...changes: MemoryChange[]) => ({ schemaVersion: 1, changes });
function storeFixture(t: TestContext) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let now = 1_000_000;
  const profiles = new ProfileRepository(db);
  const alice = profiles.create('Alice');
  const bob = profiles.create('Bob');
  const repository = new MemoryRepository(db, () => now);
  const turns: MemoryTurn[] = [
    {
      id: 'turn-1',
      profileId: alice.id,
      version: 0,
      text: 'Je préfère des réponses courtes.',
      startMs: 100,
      endMs: 900,
    },
  ];
  const batch = repository.begin('session-1', alice.id, 0)!;
  return {
    db,
    profiles,
    alice,
    bob,
    repository,
    turns,
    batch,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test('les preuves, propriétaire et opérations sont vérifiés avant toute écriture atomique', (t) => {
  const f = storeFixture(t);
  assert.equal(
    f.repository.apply(
      f.batch,
      proposal(change(), change({ evidenceTurnIds: ['invented'] })),
      f.turns,
    ),
    false,
  );
  assert.equal(f.repository.list(f.alice.id).length, 0);
  const batch = f.repository.begin('session-2', f.alice.id, 0)!;
  assert.equal(f.repository.apply(batch, proposal(change()), f.turns), true);
  assert.equal(f.repository.apply(batch, proposal(change()), f.turns), false);
  assert.equal(f.repository.begin('session-2', f.alice.id, 1), null);
  const fact = f.repository.list(f.alice.id)[0]!;
  assert.equal(fact.evidence[0]!.turnId, 'turn-1');
  assert.equal(JSON.stringify(fact).includes('Je préfère'), false);
  assert.deepEqual(f.repository.list(f.bob.id), []);
  const foreign = f.repository.begin('session-3', f.bob.id, 0)!;
  const bobTurns = f.turns.map((turn) => ({ ...turn, profileId: f.bob.id }));
  assert.equal(
    f.repository.apply(
      foreign,
      proposal(change({ operation: 'update', memoryId: fact.id })),
      bobTurns,
    ),
    false,
  );
  assert.throws(
    () =>
      f.repository.edit(f.bob.id, fact.id, {
        version: 0,
        topic: 'test',
        fact: 'test',
        scope: 'durable',
        expiresAt: null,
      }),
    /introuvable/,
  );
});
test('correction, oubli et désactivation empêchent un ancien lot de restaurer un souvenir', (t) => {
  const f = storeFixture(t);
  f.repository.apply(f.batch, proposal(change()), f.turns);
  const fact = f.repository.list(f.alice.id)[0]!;
  const pending = f.repository.begin('pending', f.alice.id, 1)!;
  f.repository.edit(f.alice.id, fact.id, {
    version: 1,
    topic: fact.topic,
    fact: 'Préfère des réponses détaillées.',
    scope: 'durable',
    expiresAt: null,
  });
  assert.equal(f.repository.list(f.alice.id)[0]!.origin, 'admin');
  assert.deepEqual(f.repository.list(f.alice.id)[0]!.evidence, []);
  assert.equal(
    f.repository.apply(
      pending,
      proposal(change()),
      f.turns.map((turn) => ({ ...turn, version: 1 })),
    ),
    false,
  );
  assert.throws(() => f.repository.forget(f.alice.id, fact.id, 1), /changé/);
  f.repository.forget(f.alice.id, fact.id, 2);
  assert.equal(f.repository.list(f.alice.id).length, 0);
  const disabled = f.repository.begin('disabled', f.alice.id, 3)!;
  f.repository.setEnabled(f.alice.id, false, 3);
  assert.equal(f.repository.apply(disabled, proposal(change()), f.turns), false);
  assert.equal(f.repository.begin('new-disabled', f.alice.id, 4), null);
});
test('mises à jour et oublis automatiques exigent des preuves actuelles et incrémentent la version', (t) => {
  const f = storeFixture(t);
  f.repository.apply(f.batch, proposal(change()), f.turns);
  const id = f.repository.list(f.alice.id)[0]!.id;
  const update = f.repository.begin('update', f.alice.id, 1)!;
  assert.equal(
    f.repository.apply(
      update,
      proposal(change({ operation: 'update', memoryId: id, fact: 'Aime les détails.' })),
      f.turns.map((turn) => ({ ...turn, version: 1, text: 'Finalement, je préfère les détails.' })),
    ),
    true,
  );
  assert.equal(f.repository.list(f.alice.id)[0]!.fact, 'Aime les détails.');
  const forget = f.repository.begin('forget', f.alice.id, 2)!;
  assert.equal(
    f.repository.apply(
      forget,
      proposal(change({ operation: 'forget', memoryId: id, fact: null })),
      f.turns.map((turn) => ({ ...turn, version: 2, text: 'Oublie cette préférence.' })),
    ),
    true,
  );
  assert.deepEqual(f.repository.list(f.alice.id), []);
});
test('un identifiant inventé par un petit modèle devient un ajout, jamais une écriture ailleurs', (t) => {
  const f = storeFixture(t);
  assert.equal(
    f.repository.apply(
      f.batch,
      proposal(
        change({ operation: 'update', memoryId: 'invente-1' }),
        change({ memoryId: 'invente-2', topic: 'boisson', fact: 'Préfère le thé vert.' }),
      ),
      f.turns,
    ),
    true,
  );
  const facts = f.repository.list(f.alice.id);
  assert.deepEqual(facts.map((fact) => fact.fact).sort(), [
    'Préfère des réponses courtes.',
    'Préfère le thé vert.',
  ]);
  assert.equal(
    facts.some((fact) => fact.id.startsWith('invente')),
    false,
  );
  const foreign = f.repository.begin('session-bob', f.bob.id, 0)!;
  const bobTurns = f.turns.map((turn) => ({ ...turn, profileId: f.bob.id }));
  assert.equal(
    f.repository.apply(
      foreign,
      proposal(change({ operation: 'update', memoryId: facts[0]!.id, fact: 'Remplacé.' })),
      bobTurns,
    ),
    false,
  );
  assert.deepEqual(f.repository.list(f.bob.id), []);
  assert.equal(
    f.repository.list(f.alice.id).some((fact) => fact.fact === 'Remplacé.'),
    false,
  );
  const unproven = f.repository.begin('session-sans-preuve', f.alice.id, 1)!;
  assert.equal(
    f.repository.apply(
      unproven,
      proposal(
        change({ operation: 'update', memoryId: 'invente-4', evidenceTurnIds: ['invented'] }),
      ),
      f.turns.map((turn) => ({ ...turn, version: 1 })),
    ),
    false,
  );
});
test('une correction inventée sur un sujet connu ou un oubli inventé gardent le rejet du lot', (t) => {
  const f = storeFixture(t);
  assert.equal(
    f.repository.apply(
      f.batch,
      proposal(change({ topic: 'boisson', fact: 'Préfère le thé.' })),
      f.turns,
    ),
    true,
  );
  const avant = f.repository.list(f.alice.id);
  assert.deepEqual(
    avant.map((fact) => fact.fact),
    ['Préfère le thé.'],
  );
  // « En fait je préfère le café » : un update vers un identifiant inventé, sur le même sujet.
  const correction = f.repository.begin('session-correction', f.alice.id, 1)!;
  const turns1 = f.turns.map((turn) => ({ ...turn, version: 1 }));
  assert.equal(
    f.repository.apply(
      correction,
      proposal(
        change({
          operation: 'update',
          memoryId: 'invente-5',
          topic: 'Boisson ',
          fact: 'Préfère le café.',
        }),
      ),
      turns1,
    ),
    false,
  );
  assert.deepEqual(
    f.repository.list(f.alice.id),
    avant,
    'souvenir d’origine intact, pas de doublon',
  );
  // Un oubli vers un identifiant inventé : rejeté avec le lot, rien n'est oublié ni ajouté.
  const oubli = f.repository.begin('session-oubli', f.alice.id, 1)!;
  assert.equal(
    f.repository.apply(
      oubli,
      proposal(
        change({ topic: 'sport', fact: 'Joue au hockey.' }),
        change({ operation: 'forget', memoryId: 'invente-6', topic: 'boisson', fact: null }),
      ),
      turns1,
    ),
    false,
  );
  assert.deepEqual(f.repository.list(f.alice.id), avant);
  // Témoin : dans les mêmes conditions, une correction inventée sur un autre sujet devient un ajout.
  const autre = f.repository.begin('session-autre-sujet', f.alice.id, 1)!;
  assert.equal(
    f.repository.apply(
      autre,
      proposal(
        change({
          operation: 'update',
          memoryId: 'invente-7',
          topic: 'sport',
          fact: 'Joue au hockey.',
        }),
      ),
      turns1,
    ),
    true,
  );
  assert.deepEqual(
    f.repository
      .list(f.alice.id)
      .map((fact) => fact.fact)
      .sort(),
    ['Joue au hockey.', 'Préfère le thé.'],
  );
});
test('expiration, déduplication, suppression du profil et reprise sans transcription', (t) => {
  const f = storeFixture(t);
  assert.equal(
    f.repository.apply(
      f.batch,
      proposal(change({ scope: 'temporary', expiresAt: new Date(1_001_000).toISOString() })),
      f.turns,
    ),
    true,
  );
  f.advance(1001);
  assert.deepEqual(f.repository.list(f.alice.id), []);
  f.repository.purgeExpired();
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM memories').get()!.n, 0);
  const next = f.repository.begin('next', f.alice.id, 2)!;
  const turns = f.turns.map((turn) => ({ ...turn, version: 2 }));
  assert.equal(f.repository.apply(next, proposal(change(), change()), turns), true);
  assert.equal(f.repository.list(f.alice.id).length, 1);
  f.repository.begin('interrupted', f.alice.id, 3);
  f.repository.recover();
  assert.equal(
    f.repository.view(f.alice.id).batches.find((b) => b.interactionId === 'interrupted')!.status,
    'cancelled',
  );
  f.profiles.delete(f.alice.id);
  for (const table of ['memories', 'memory_batches', 'memory_policies'])
    assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0);
});
test('la mémoire et sa politique persistent après redémarrage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-memory-'));
  const path = join(directory, 'test.sqlite');
  let db = openDatabase(path);
  try {
    const profile = new ProfileRepository(db).create('Alice');
    const repository = new MemoryRepository(db);
    const batch = repository.begin('session', profile.id, 0)!;
    repository.apply(batch, proposal(change()), [
      {
        id: 'turn-1',
        profileId: profile.id,
        version: 0,
        text: 'Je préfère des réponses courtes.',
        startMs: 0,
        endMs: 500,
      },
    ]);
    repository.setEnabled(profile.id, false, 1);
    db.close();
    db = openDatabase(path);
    const saved = new MemoryRepository(db).view(profile.id);
    assert.equal(saved.enabled, false);
    assert.equal(saved.memories.length, 1);
    assert.equal(saved.version, 2);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function liveFixture(
  t: TestContext,
  options: { extractor?: MemoryExtractor; anonymous?: boolean; connectingMs?: number } = {},
) {
  const db = openDatabase(':memory:');
  let now = 1_000_000;
  const profiles = new ProfileRepository(db);
  const alice = profiles.create('Alice');
  const bob = profiles.create('Bob');
  const preferences = new SessionPreferences(db);
  preferences.setSessionMode(1);
  const sent: ConnectClientEvent[] = [];
  let handlers!: Parameters<LiveGateway['attach']>[1];
  const gateway: LiveGateway = {
    async create() {
      return { session: { id: 'fixture' }, transport: { type: 'webrtc', sdp: 'answer' } };
    },
    attach(_id, value) {
      handlers = value;
      return { send: (e) => sent.push(e), dispose() {} };
    },
  };
  const live = new LiveTransport(gateway, () => preferences.getOpenAIBlocked());
  const controller = new SessionController(profiles, live, () => now, preferences);
  live.attach(controller);
  const repository = new MemoryRepository(db, () => now);
  const extracted: MemoryExtractionInput[] = [];
  const memory = new PersonalMemory(
    repository,
    controller,
    options.extractor ??
      (async (input) => {
        extracted.push(structuredClone(input));
        return proposal(change({ evidenceTurnIds: [input.turns[0]!.id] }));
      }),
    () => now,
  );
  live.attachMemory(memory);
  t.after(async () => {
    await memory.dispose();
    live.dispose();
    db.close();
  });
  let sequence = 0;
  function observe(people: (string | null)[] = [alice.id]) {
    controller.heartbeat();
    controller.observe({
      schemaVersion: 1,
      producerBootId: 'camera',
      sequence: ++sequence,
      observedAt: now,
      health: 'ok',
      presence: people.length > 0,
      engaged: people.length > 0,
      people: people.map((profileId, i) => ({ trackId: String(i), profileId })),
    });
  }
  observe(options.anonymous ? [null] : [alice.id]);
  now += 500;
  observe(options.anonymous ? [null] : [alice.id]);
  const scope = controller.scope();
  await live.offer(scope, 'sdp');
  // Délai réel d’ouverture : la personne reste seule et reconnue pendant la connexion.
  for (let waited = 0; waited < (options.connectingMs ?? 0); waited += 100) {
    now += 100;
    observe(options.anonymous ? [null] : [alice.id]);
  }
  handlers.open();
  live.started(scope);
  const advance = (ms: number, people?: (string | null)[]) => {
    now += ms;
    observe(people);
  };
  const emit = (event: unknown) => handlers.event(event as ConnectServerEvent);
  const input = (id: string, text: string, start: number, end: number, output = false) =>
    emit({
      type: output ? 'session.output_transcript.delta' : 'session.input_transcript.delta',
      event_id: id,
      delta: text,
      start_ms: start,
      end_ms: end,
    });
  const close = async () => {
    controller.close('Fin de conversation.');
    emit({ type: 'session.closed', event_id: 'closed' });
    await memory.settled();
  };
  return {
    db,
    live,
    memory,
    repository,
    controller,
    profiles,
    preferences,
    alice,
    bob,
    scope,
    sent,
    extracted,
    observe,
    advance,
    input,
    emit,
    close,
  };
}
test('Live assemble les fragments une seule fois, extrait après clôture et restitue uniquement par outil', async (t) => {
  const f = await liveFixture(t);
  f.advance(600);
  f.input('a', 'Je préfère ', 100, 250);
  f.input('b', 'des réponses courtes.', 250, 500);
  f.input('b', 'doublon', 250, 500);
  assert.equal(f.extracted.length, 0);
  f.advance(100);
  await f.close();
  assert.equal(f.extracted.length, 1);
  assert.equal(f.extracted[0]!.turns.length, 1);
  assert.equal(f.extracted[0]!.turns[0]!.text, 'Je préfère des réponses courtes.');
  assert.equal(f.repository.list(f.alice.id).length, 1);
  assert.equal(
    f.sent.some((event) => JSON.stringify(event).includes('Préfère des réponses courtes.')),
    false,
  );
  const config = liveConfiguration(f.memory.tools());
  assert.equal(JSON.stringify(config).includes('Préfère des réponses courtes.'), false);
  assert.equal(f.memory.recall(f.scope, { query: null, limit: 10 }).status, 'failed');
});
test('memory__recall vérifie le profil présent, les arguments, la politique et la portée à chaque appel', async (t) => {
  const f = await liveFixture(t);
  const batch = f.repository.begin('seed', f.alice.id, 0)!;
  f.repository.apply(batch, proposal(change()), [
    {
      id: 'turn-1',
      profileId: f.alice.id,
      version: 0,
      text: 'Je préfère des réponses courtes.',
      startMs: 0,
      endMs: 1,
    },
  ]);
  const args = { query: 'réponses', limit: 10 };
  assert.equal(f.memory.recall(f.scope, args).status, 'succeeded');
  assert.equal(f.memory.recall(f.scope, { ...args, profileId: f.bob.id }).status, 'failed');
  assert.equal(f.memory.recall({ ...f.scope, contextVersion: 99 }, args).status, 'failed');
  f.emit({
    type: 'response.event',
    delegation_id: 'recall',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        name: 'memory__recall',
        call_id: 'recall-call',
        arguments: JSON.stringify(args),
      },
    },
  });
  assert.equal(
    f.sent.some(
      (event) =>
        event.type === 'response.item.create' &&
        JSON.stringify(event).includes('Préfère des réponses courtes.'),
    ),
    true,
  );
  f.advance(100, [f.alice.id, f.bob.id]);
  assert.equal(f.memory.recall(f.scope, args).status, 'failed');
  f.advance(100);
  f.repository.setEnabled(f.alice.id, false, 1);
  assert.equal(f.memory.recall(f.scope, args).status, 'failed');
});
test('les paroles anonymes livrées après reconnaissance ne sont jamais réattribuées', async (t) => {
  const f = await liveFixture(t, { anonymous: true });
  f.advance(700); // first identification
  f.input('late', 'Je préfère des réponses courtes.', 100, 400);
  f.advance(100);
  await f.close();
  assert.equal(f.extracted.length, 0);
});
test('un tour traversant une présence ambiguë est écarté en entier', async (t) => {
  const f = await liveFixture(t);
  f.advance(400);
  f.input('a', 'Je préfère ', 100, 300);
  f.advance(100, [f.alice.id, f.bob.id]);
  f.input('b', 'des réponses ', 300, 450);
  f.advance(200);
  f.input('c', 'courtes.', 450, 600);
  f.advance(100);
  await f.close();
  assert.equal(f.extracted.length, 0);
});
test('choisir Alice alors que Bob est seul et la grâce de visage ne permettent aucune écriture', async (t) => {
  const f = await liveFixture(t);
  f.controller.command({ type: 'select_profile', profileId: f.alice.id });
  f.advance(600, [f.bob.id]);
  f.input('bob', 'Je préfère les réponses courtes.', 100, 500);
  f.advance(100, []);
  assert.equal(f.controller.memoryProfileId(), null);
  assert.equal(f.memory.recall(f.scope, { query: null, limit: 10 }).status, 'failed');
  await f.close();
  assert.equal(f.extracted.length, 0);
});
test('une interruption des observations invalide la période manquante même après reprise', async (t) => {
  const f = await liveFixture(t);
  f.advance(3000);
  f.input('gap', 'Je préfère des réponses courtes.', 2100, 2800);
  f.advance(100);
  await f.close();
  assert.equal(f.extracted.length, 0);
});
test('une extraction en attente est annulée par un oubli, sans bloquer la session', async (t) => {
  let resolve!: (value: unknown) => void;
  let extraction!: MemoryExtractionInput;
  const f = await liveFixture(t, {
    extractor: async (input) => {
      extraction = structuredClone(input);
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  f.advance(600);
  f.input('a', 'Je préfère des réponses courtes.', 100, 500);
  f.advance(100);
  f.controller.close('Fin.');
  f.emit({ type: 'session.closed' });
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
  assert.equal(extraction.turns.length, 1);
  f.repository.forget(f.alice.id, null, 0);
  f.memory.invalidate(f.alice.id);
  resolve(proposal(change({ evidenceTurnIds: [extraction.turns[0]!.id] })));
  await f.memory.settled();
  assert.equal(f.repository.list(f.alice.id).length, 0);
  assert.equal(f.repository.view(f.alice.id).batches[0]!.status, 'cancelled');
});
test('blocage OpenAI, chevauchement vocal et panne d’extraction ne créent aucun souvenir', async (t) => {
  const f = await liveFixture(t);
  f.advance(600);
  f.input('a', 'Je préfère des réponses courtes.', 100, 500);
  f.input('out', 'D’accord.', 400, 550, true);
  f.advance(100);
  await f.close();
  assert.equal(f.extracted.length, 0);
  const g = await liveFixture(t);
  g.advance(600);
  g.input('a', 'Je préfère des réponses courtes.', 100, 500);
  g.preferences.setOpenAIBlocked(true);
  g.live.block();
  await g.memory.settled();
  assert.equal(g.extracted.length, 0);
  const h = await liveFixture(t, {
    extractor: async () => {
      throw new Error('private provider content');
    },
  });
  h.advance(600);
  h.input('a', 'Je préfère des réponses courtes.', 100, 500);
  h.advance(100);
  await h.close();
  assert.equal(h.repository.view(h.alice.id).batches[0]!.status, 'failed');
  assert.equal(
    JSON.stringify(h.repository.view(h.alice.id)).includes('private provider content'),
    false,
  );
});

test('un souvenir extrait revient seulement dans la conversation suivante du même profil', async (t) => {
  const f = await liveFixture(t);
  f.advance(600);
  f.input('a', 'Je préfère des réponses courtes.', 100, 500);
  f.advance(100);
  await f.close();
  f.controller.command({ type: 'start' });
  const scope = f.controller.scope();
  await f.live.offer(scope, 'next-sdp');
  f.live.started(scope);
  // Control readiness can arrive separately from browser readiness.
  f.controller.controlAttached(scope);
  const recalled = f.memory.recall(scope, { query: 'communication', limit: 10 });
  assert.equal(recalled.status, 'succeeded');
  assert.equal(JSON.stringify(recalled.result).includes('Préfère des réponses courtes.'), true);
  f.advance(100, [f.bob.id]);
  assert.equal(f.memory.recall(scope, { query: null, limit: 10 }).status, 'failed');
});

test('supprimer un profil ou bloquer OpenAI annule une extraction en attente', async (t) => {
  for (const operation of ['delete', 'block'] as const) {
    const f = await liveFixture(t, { extractor: async () => new Promise(() => {}) });
    f.advance(600);
    f.input('a', 'Je préfère des réponses courtes.', 100, 500);
    f.advance(100);
    f.controller.close('Fin.');
    f.emit({ type: 'session.closed' });
    if (operation === 'delete') {
      f.memory.invalidate(f.alice.id);
      f.profiles.delete(f.alice.id);
    } else {
      f.preferences.setOpenAIBlocked(true);
      f.live.block();
    }
    await f.memory.settled();
    assert.deepEqual(f.repository.list(f.alice.id), []);
  }
});

test('un premier tour prononcé pendant la connexion reste attribuable à la personne seule', async (t) => {
  const f = await liveFixture(t, { connectingMs: 800 });
  f.advance(600);
  // Horodaté 100 ms après le début distant, donc avant la notification de démarrage locale.
  f.input('early', 'Je préfère des réponses courtes.', 100, 600);
  f.advance(100);
  await f.close();
  assert.equal(f.extracted.length, 1);
  assert.equal(f.extracted[0]!.turns[0]!.text, 'Je préfère des réponses courtes.');
});

test('la question de Cornelius accompagne la réponse courte comme contexte, jamais comme preuve', async (t) => {
  const f = await liveFixture(t);
  f.advance(600);
  f.input('question', 'Quel est ton plat préféré ?', 100, 900, true);
  f.input('answer', 'Les lasagnes.', 1200, 1700);
  f.advance(1300);
  await f.close();
  assert.equal(f.extracted.length, 1);
  const turn = f.extracted[0]!.turns[0]!;
  assert.equal(turn.text, 'Les lasagnes.');
  assert.equal(turn.precededBy, 'Quel est ton plat préféré ?');
  // Une proposition qui citerait la parole de Cornelius comme preuve reste refusée.
  const batch = f.repository.begin('assistant-proof', f.alice.id, 1)!;
  assert.equal(
    f.repository.apply(batch, proposal(change({ evidenceTurnIds: ['question'] })), [turn]),
    false,
  );
});

test('le résultat d’une extraction sans fait utile est lisible dans l’administration', async (t) => {
  const f = await liveFixture(t, { extractor: async () => proposal() });
  f.advance(600);
  f.input('a', 'Merci beaucoup.', 100, 500);
  f.advance(100);
  await f.close();
  const [batch] = f.repository.view(f.alice.id).batches;
  assert.equal(batch!.status, 'applied');
  assert.equal(batch!.reason, 'Aucun fait à retenir dans cette conversation.');
  const second = f.repository.begin('one-fact', f.alice.id, 0)!;
  f.repository.apply(second, proposal(change()), [
    { id: 'turn-1', profileId: f.alice.id, version: 0, text: 'Je préfère', startMs: 0, endMs: 1 },
  ]);
  assert.equal(
    f.repository.view(f.alice.id).batches.find((entry) => entry.id === second.id)!.reason,
    '1 changement enregistré.',
  );
});
