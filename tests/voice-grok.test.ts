import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { openDatabase, SessionPreferences } from '../server/storage.js';
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

/** Faux serveur xAI : répond à session.update par session.updated, garde les messages reçus. */
async function fakeXai(t: test.TestContext) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(wss, 'listening');
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  });
  const received: Record<string, unknown>[] = [];
  const connection = once(wss, 'connection') as Promise<[WebSocket, IncomingMessage]>;
  void connection.then(([socket]) => {
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      received.push(event);
      if (
        event.type === 'session.update' &&
        received.filter((e) => e.type === 'session.update').length === 1
      )
        socket.send(JSON.stringify({ type: 'session.updated', session: { id: 'sess_1' } }));
    });
  });
  const { port } = wss.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${port}/v1/realtime`, connection, received };
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
  const adapter = createGrokVoiceAdapter('cle-xai-secrete', logs, { voice: 'ara', url: xai.url });
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
  const session = createGrokVoiceAdapter('cle', undefined, { url: xai.url }).connect(
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
  const session = createGrokVoiceAdapter('cle', undefined, { url: xai.url }).connect(
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
  const session = createGrokVoiceAdapter('cle', undefined, { url: xai.url }).connect(
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
  const session = createGrokVoiceAdapter('cle', logs, { url: xai.url }).connect(
    configuration,
    () => {},
  );
  const [socket] = await xai.connection;
  socket.removeAllListeners('message');
  socket.send(
    JSON.stringify({ type: 'error', error: { code: 'invalid_api_key', message: 'phrase privée' } }),
  );
  await assert.rejects(session, /invalid_api_key/u);
  assert.ok(!JSON.stringify(logs.snapshot()).includes('phrase privée'));
});
