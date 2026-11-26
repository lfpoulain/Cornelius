import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { generate } from 'selfsigned';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  createGrokVoiceAdapter,
  grokTools,
  GROK_LEAD_MS,
  GROK_MAX_SESSION_MS,
  GROK_MODEL,
  GROK_VAD,
} from '../server/voice/grok.js';
import type { VoiceConfiguration, VoiceEvent } from '../server/voice/provider.js';
import { DiagnosticLog } from '../server/logs.js';
import { LiveTransport } from '../server/live/transport.js';
import { liveConfiguration } from '../server/live/configuration.js';
import { createVoiceGateway } from '../server/voice/live-bridge.js';
import type { VoiceConnection } from '../server/voice/provider.js';
import { migrations, openDatabase, SessionPreferences } from '../server/storage.js';
import { CustomProviderRepository } from '../server/custom-provider.js';
import { VoiceUsage } from '../server/voice-usage.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  isVoiceProvider,
  isXaiVoice,
  voiceProviderKey,
  voiceProviderLabel,
} from '../shared/voice-provider.js';

const configuration: VoiceConfiguration = {
  instructions: 'Consignes de Cornelius',
  tools: [
    { name: 'radio__jouer', description: 'Fait jouer un poste', parameters: { type: 'object' } },
  ],
  webSearch: true,
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Faux serveur xAI en TLS (certificat jetable) : répond au premier session.update, garde le reste. */
async function fakeXai(t: test.TestContext) {
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
  });
  const server = createHttpsServer({ key: pems.private, cert: pems.cert });
  const wss = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.closeAllConnections();
    server.close();
  });
  const received: Record<string, unknown>[] = [];
  const connection = once(wss, 'connection') as Promise<[WebSocket, IncomingMessage]>;
  void connection.then(([socket]) => {
    let updates = 0;
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      received.push(event);
      if (event.type === 'session.update' && ++updates === 1)
        socket.send(JSON.stringify({ type: 'session.updated', session: { id: 'sess_1' } }));
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    options: { baseURL: `https://127.0.0.1:${port}/v1`, socket: { ca: pems.cert } },
    connection,
    received,
  };
}

test('Grok Voice : modèle épinglé, libellé, clé et préférence du fournisseur', () => {
  assert.equal(GROK_MODEL, 'grok-voice-3.0');
  assert.equal(GROK_MAX_SESSION_MS, 15 * 60_000);
  assert.equal(GROK_VAD.threshold, 0.6);
  assert.equal(isVoiceProvider('xai'), true);
  assert.equal(voiceProviderKey('xai'), 'XAI_API_KEY');
  assert.equal(voiceProviderLabel('xai'), 'xAI · Grok Voice');
  assert.equal(isXaiVoice('ara'), true);
  assert.equal(isXaiVoice('cedar'), false);
  const db = openDatabase(':memory:');
  const preferences = new SessionPreferences(db);
  preferences.setVoiceProvider('xai');
  assert.equal(new SessionPreferences(db).getVoiceProvider(), 'xai');
  assert.equal(preferences.getXaiVoice(), 'eve');
  preferences.setXaiVoice('rex');
  assert.equal(new SessionPreferences(db).getXaiVoice(), 'rex');
  assert.throws(() => preferences.setXaiVoice('cedar' as never));
  db.close();
});

test('Grok Voice : outils de Cornelius en fonctions, recherche web de xAI si permise', () => {
  assert.deepEqual(grokTools(configuration), [
    {
      type: 'function',
      name: 'radio__jouer',
      description: 'Fait jouer un poste',
      parameters: { type: 'object' },
    },
    { type: 'web_search' },
  ]);
  assert.deepEqual(grokTools({ ...configuration, tools: [], webSearch: false }), []);
});

test('Grok Voice : session en PCM 16 kHz, clé dans l’en-tête seulement, jamais au journal', async (t) => {
  const xai = await fakeXai(t);
  const logs = new DiagnosticLog({ console: false, secrets: ['cle-xai-secrete'] });
  const events: VoiceEvent[] = [];
  const adapter = createGrokVoiceAdapter('cle-xai-secrete', logs, { voice: 'ara', ...xai.options });
  const session = adapter.connect(configuration, (event) => events.push(event));
  const [, request] = await xai.connection;
  assert.equal(request.headers.authorization, 'Bearer cle-xai-secrete');
  assert.equal(new URL(request.url!, 'ws://x').searchParams.get('model'), GROK_MODEL);
  const connection = await session;
  const update = xai.received[0] as { session: Record<string, unknown> };
  assert.equal(update.session.instructions, 'Consignes de Cornelius');
  assert.equal(update.session.voice, 'ara');
  assert.deepEqual(update.session.turn_detection, GROK_VAD);
  assert.deepEqual(update.session.audio, {
    input: { format: { type: 'audio/pcm', rate: 16_000 } },
    output: { format: { type: 'audio/pcm', rate: 16_000 } },
  });
  assert.deepEqual(events[0], { type: 'connected', id: 'sess_1' });
  connection.audio(Buffer.from([1, 0, 2, 0]));
  await wait(30);
  assert.deepEqual(xai.received.at(-1), { type: 'input_audio_buffer.append', audio: 'AQACAA==' });
  await connection.close();
  assert.equal(events.at(-1)?.type, 'closed');
  assert.ok(!JSON.stringify(logs.snapshot()).includes('cle-xai-secrete'));
});

test('Grok Voice : voix rythmée, transcription unique, outil puis une seule relance', async (t) => {
  const xai = await fakeXai(t);
  const events: VoiceEvent[] = [];
  const session = createGrokVoiceAdapter('cle', undefined, xai.options).connect(
    configuration,
    (event) => events.push(event),
  );
  const [socket] = await xai.connection;
  const connection = await session;
  const send = (event: Record<string, unknown>) => socket.send(JSON.stringify(event));

  // La phrase se complète : seule la dernière version part, quand Grok répond.
  send({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'u1',
    transcript: 'Fais',
  });
  send({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'u1',
    transcript: 'Fais jouer Radio X',
  });
  send({ type: 'response.created' });
  // 3 s de voix d'un coup : le navigateur n'en reçoit qu'une avance bornée.
  send({ type: 'response.output_audio.delta', delta: Buffer.alloc(3 * 32_000).toString('base64') });
  send({
    type: 'response.function_call_arguments.done',
    call_id: 'c1',
    name: 'radio__jouer',
    arguments: '{"nom":"CHOI"}',
  });
  send({ type: 'response.done' });
  await wait(50);
  const heard = events.filter((event) => event.type === 'user_transcript');
  assert.deepEqual(
    heard.map((event) => (event as { text: string }).text),
    ['Fais jouer Radio X'],
  );
  const sentMs =
    events
      .filter((event) => event.type === 'assistant_speech')
      .reduce((total, event) => total + (event as { pcm: Buffer }).pcm.length, 0) / 32;
  assert.ok(sentMs <= GROK_LEAD_MS + 100, `avance transmise : ${sentMs} ms`);
  assert.ok(events.some((event) => event.type === 'state' && event.state === 'thinking'));
  assert.deepEqual(
    events.find((event) => event.type === 'tool_call'),
    { type: 'tool_call', id: 'c1', name: 'radio__jouer', arguments: '{"nom":"CHOI"}' },
  );
  // La réponse est finie : le résultat de l'outil part, suivi d'une seule relance.
  connection.result('c1', '{"ok":true}');
  await wait(30);
  const tail = xai.received.slice(-2).map((event) => event.type);
  assert.deepEqual(tail, ['conversation.item.create', 'response.create']);
  // La personne reprend la parole : la voix en attente est abandonnée.
  send({ type: 'input_audio_buffer.speech_started' });
  await wait(30);
  assert.ok(events.some((event) => event.type === 'interrupted'));
  const after = events.length;
  await wait(300);
  assert.equal(events.slice(after).filter((event) => event.type === 'assistant_speech').length, 0);
  await connection.close();
});

test('Grok Voice : un bruit sans réponse ne laisse pas Cornelius en « réfléchit »', async (t) => {
  const xai = await fakeXai(t);
  const events: VoiceEvent[] = [];
  const session = createGrokVoiceAdapter('cle', undefined, xai.options).connect(
    configuration,
    (event) => events.push(event),
  );
  const [socket] = await xai.connection;
  const connection = await session;
  socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
  socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_stopped' }));
  await wait(30);
  assert.ok(!events.some((event) => event.type === 'state' && event.state === 'thinking'));
  await connection.close();
});

test('Grok Voice : données trop grosses ignorées, appel d’outil trop long refusé sans exécution', async (t) => {
  const xai = await fakeXai(t);
  const events: VoiceEvent[] = [];
  const session = createGrokVoiceAdapter('cle', undefined, xai.options).connect(
    configuration,
    (event) => events.push(event),
  );
  const [socket] = await xai.connection;
  const connection = await session;
  socket.send(
    JSON.stringify({
      type: 'response.function_call_arguments.done',
      call_id: 'c2',
      name: 'radio__jouer',
      arguments: 'x'.repeat(70_000),
    }),
  );
  socket.send(
    JSON.stringify({
      type: 'response.output_audio_transcript.done',
      item_id: 'a1',
      transcript: 'y'.repeat(10_000),
    }),
  );
  await wait(30);
  assert.ok(!events.some((event) => event.type === 'tool_call'));
  const refused = xai.received.find((event) => event.type === 'conversation.item.create') as {
    item: { call_id: string; output: string };
  };
  assert.equal(refused.item.call_id, 'c2');
  assert.match(refused.item.output, /refusé/u);
  const answer = events.find((event) => event.type === 'assistant_transcript') as { text: string };
  assert.equal(answer.text.length, 4_000);
  await connection.close();
});

test('Grok Voice : un refus de xAI échoue proprement, sans message de xAI au journal', async (t) => {
  const xai = await fakeXai(t);
  const logs = new DiagnosticLog({ console: false });
  const session = createGrokVoiceAdapter('cle', logs, xai.options).connect(configuration, () => {});
  const [socket] = await xai.connection;
  socket.removeAllListeners('message');
  socket.send(
    JSON.stringify({ type: 'error', error: { code: 'invalid_api_key', message: 'phrase privée' } }),
  );
  await assert.rejects(session, /invalid_api_key/u);
  assert.ok(!JSON.stringify(logs.snapshot()).includes('phrase privée'));
});

test('OpenAI et Mistral inchangés : rythme de la voix, « réfléchit » et seuil restent propres à xAI', async () => {
  // La passerelle partagée avec Mistral transmet la voix telle qu'elle arrive, sans la rythmer,
  // et relaie l'état « réfléchit » que donne le fournisseur.
  let emit!: (event: VoiceEvent) => void;
  const events: Record<string, unknown>[] = [];
  const gateway = createVoiceGateway({
    connect: async (_config, handler) => {
      emit = handler;
      return { audio() {}, result() {}, async update() {}, async close() {} } as VoiceConnection;
    },
  });
  assert.equal(gateway.provider, 'mistral');
  const live = gateway.connect!(liveConfiguration(), {
    open() {},
    event: (event) => events.push(event as unknown as Record<string, unknown>),
    failure() {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  emit({ type: 'state', state: 'thinking' });
  emit({ type: 'assistant_speech', pcm: Buffer.alloc(3 * 32_000) });
  const audio = events.filter((event) => event.type === 'session.output_audio.delta');
  assert.equal(audio.length, 1);
  assert.equal(Buffer.from(String(audio[0]!.delta), 'base64').length, 3 * 32_000);
  assert.ok(events.some((event) => event.type === 'voice.state' && event.state === 'thinking'));
  live.dispose();
  // Le seuil de détection n'est envoyé qu'à xAI : la configuration Live d'OpenAI ne le porte pas.
  assert.ok(!JSON.stringify(liveConfiguration()).includes(String(GROK_VAD.threshold)));
  // Facturation à la minute : Mistral et xAI, jamais OpenAI.
  const logs = new DiagnosticLog({ console: false });
  const metered = (provider: 'openai' | 'mistral' | 'xai') =>
    new LiveTransport({ provider } as never, () => false, logs).meteredByDuration();
  assert.deepEqual([metered('openai'), metered('mistral'), metered('xai')], [false, true, true]);
});

test('Bloquer les services IA coupe xAI comme les deux autres fournisseurs', () => {
  let connects = 0;
  const gateway = createVoiceGateway(
    {
      connect: async () => {
        connects += 1;
        return { audio() {}, result() {}, async update() {}, async close() {} } as VoiceConnection;
      },
    },
    'xai',
  );
  const logs = new DiagnosticLog({ console: false });
  const live = new LiveTransport(gateway, () => true, logs);
  assert.equal(live.provider(), 'xai');
  assert.equal(live.unavailableReason(), 'Connexions IA bloquées dans l’administration.');
  assert.throws(() => live.open({ interactionId: 'i1' } as never), /bloquées/u);
  assert.equal(connects, 0);
});

test('Grok Voice : la mémoire garde son propre fournisseur, rien ne part chez xAI après la conversation', () => {
  const db = openDatabase(':memory:');
  try {
    const memory = new CustomProviderRepository(db);
    memory.set({ ...memory.get(), memoryProvider: 'mistral' });
    new SessionPreferences(db).setVoiceProvider('xai');
    assert.equal(new CustomProviderRepository(db).get().memoryProvider, 'mistral');
    new SessionPreferences(db).setVoiceProvider('openai');
    new SessionPreferences(db).setVoiceProvider('xai');
    assert.equal(new CustomProviderRepository(db).get().memoryProvider, 'mistral');
  } finally {
    db.close();
  }
});

test('Grok Voice : une base 0.4.1 avec des données OpenAI et Mistral monte sans rien perdre', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-xai-'));
  const path = join(directory, 'cornelius.sqlite');
  try {
    // Base 0.4.1 : les migrations jusqu'à la dernière de cette version (avant celles de beta).
    const v041 = migrations.findIndex((sql) => sql.includes('wait_for_reply_preferences'));
    assert.ok(v041 > 0);
    let raw = new DatabaseSync(path);
    raw.exec('PRAGMA foreign_keys = ON');
    for (const sql of migrations.slice(0, v041)) raw.exec(sql);
    raw.exec(`PRAGMA user_version = ${v041}`);
    raw.exec(`UPDATE voice_provider_preferences SET provider = 'mistral' WHERE id = 1;
      INSERT INTO voice_usage_days (day, provider, seconds, sessions) VALUES
        ('2026-11-24', 'openai', 120, 2), ('2026-11-24', 'mistral', 60, 1);
      UPDATE voice_usage_price SET per_minute = 0.04, currency = '$' WHERE id = 1;`);
    raw.close();

    let db = openDatabase(path);
    assert.equal(Number(db.prepare('PRAGMA user_version').get()?.user_version), migrations.length);
    let preferences = new SessionPreferences(db);
    assert.equal(preferences.getVoiceProvider(), 'mistral');
    assert.deepEqual(
      db
        .prepare('SELECT day, provider, seconds, sessions FROM voice_usage_days ORDER BY provider')
        .all()
        .map((row) => ({ ...row })),
      [
        { day: '2026-11-24', provider: 'mistral', seconds: 60, sessions: 1 },
        { day: '2026-11-24', provider: 'openai', seconds: 120, sessions: 2 },
      ],
    );
    assert.equal(preferences.getXaiVoice(), 'eve');
    // La contrainte reconstruite accepte xAI, et refuse toujours l'inconnu.
    preferences.setVoiceProvider('xai');
    const usage = new VoiceUsage(
      db,
      () => Date.parse('2026-11-24T15:00:00Z'),
      () => 'America/Toronto',
    );
    usage.add(30, 'xai');
    assert.throws(() =>
      db.prepare("UPDATE voice_provider_preferences SET provider = 'autre' WHERE id = 1").run(),
    );
    assert.equal(usage.view().perMinute, 0.04);
    db.close();

    // Migration rejouée : rien n'est perdu.
    db = new DatabaseSync(path);
    const ours = migrations.findIndex((sql) => sql.includes('voice_provider_preferences_xai'));
    db.exec(`PRAGMA user_version = ${ours}`);
    db.close();
    db = openDatabase(path);
    preferences = new SessionPreferences(db);
    assert.equal(preferences.getVoiceProvider(), 'xai');
    assert.equal(
      Number(
        db.prepare("SELECT seconds FROM voice_usage_days WHERE provider = 'xai'").get()?.seconds,
      ),
      30,
    );
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
