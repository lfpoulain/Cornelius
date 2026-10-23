import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { ConnectServerEvent } from 'openai/resources/live/sideband';
import {
  createGroqGateway as realCreateGroqGateway,
  type GroqOptions,
  createGroqMemoryExtractor,
  GroqUtterance,
  pcmWave,
} from '../server/groq.js';
import { liveConfiguration } from '../server/live/configuration.js';
import { LiveTransport } from '../server/live/transport.js';
import { SessionController } from '../server/controller.js';
import { openDatabase, ProfileRepository, SessionPreferences } from '../server/storage.js';

// Le SDK vérifie le support FormData avec une URL data:, sans réseau.
function createGroqGateway(key: string, options: GroqOptions) {
  return realCreateGroqGateway(key, {
    ...options,
    fetch: (input, init) =>
      String(input) === 'data:,' ? globalThis.fetch(input, init) : options.fetch!(input, init),
  });
}
const key = 'gsk-test-not-a-real-secret-1234';
const silent = Buffer.alloc(1024);
const voiced = Buffer.alloc(1024);
for (let i = 0; i < voiced.length; i += 2) voiced.writeInt16LE(i % 4 ? 6000 : -6000, i);
function say(connection: { sendAudio(pcm: Buffer): void }) {
  for (let i = 0; i < 10; i++) connection.sendAudio(voiced);
  for (let i = 0; i < 22; i++) connection.sendAudio(silent);
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await setImmediate();
  assert.ok(check(), 'Le résultat attendu doit arriver.');
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function reply(content = 'Bonjour, comment allez-vous ?') {
  return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] };
}

test('Groq : WAV 16 kHz et découpage borné, silence et clic isolé ignorés', () => {
  const vad = new GroqUtterance();
  for (let i = 0; i < 100; i++) assert.equal(vad.push(silent), null);
  assert.equal(vad.push(voiced), null);
  for (let i = 0; i < 30; i++) assert.equal(vad.push(silent), null);
  let result: Buffer | null = null;
  for (let i = 0; i < 1000 && !result; i++) result = vad.push(voiced);
  assert.ok(result && result.length <= 960512, 'Une phrase continue est bornée à 30 secondes.');
  const wav = pcmWave(voiced);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.deepEqual(wav.subarray(44), voiced);
});

test('Groq : transcription, réponse, semi-duplex et aucune requête OpenAI', async (t) => {
  const requests: { url: string; body: unknown }[] = [];
  const texts: string[] = [];
  const events: ConnectServerEvent[] = [];
  const gateway = createGroqGateway(key, {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.headers.get('authorization'), 'Bearer ' + key);
      assert.equal(new URL(request.url).origin, 'https://api.groq.com');
      if (request.url.endsWith('/audio/transcriptions')) {
        const form = await request.formData();
        assert.equal(form.get('language'), 'fr');
        assert.equal(form.get('model'), 'whisper-large-v3-turbo');
        const file = form.get('file') as File;
        assert.equal(Buffer.from(await file.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
        requests.push({ url: request.url, body: null });
        return json({ text: 'Bonjour Cornelius' });
      }
      const body = (await request.json()) as { model: string; tools: { type: string }[] };
      requests.push({ url: request.url, body });
      assert.equal(body.model, 'openai/gpt-oss-20b');
      assert.ok(body.tools.every((tool) => tool.type === 'function'));
      return json(reply());
    },
  });
  const connection = gateway.connect!(liveConfiguration(), {
    open() {},
    event: (event) => events.push(event),
    failure: assert.fail,
    text: (text) => texts.push(text),
  });
  t.after(() => connection.dispose());
  await setImmediate();
  assert.equal(requests.length, 0, 'Pas de requête au démarrage ou en veille.');
  say(connection);
  await until(() => texts.length === 1);
  say(connection);
  await setImmediate();
  assert.equal(requests.length, 2, 'Le haut-parleur ne se retranscrit pas lui-même.');
  connection.playback!(false);
  say(connection);
  await until(() => texts.length === 2);
  assert.equal(events.filter((event) => event.type === 'session.input_transcript.delta').length, 2);
  connection.dispose();
  say(connection);
  await setImmediate();
  assert.equal(requests.length, 4);
});

test('Groq : appels des outils et cartes exécutés par LiveTransport, fermeture immédiate', async (t) => {
  const db = openDatabase(':memory:');
  const preferences = new SessionPreferences(db);
  preferences.setSessionMode(1);
  const requests: Record<string, unknown>[] = [];
  let completion = 0;
  const gateway = createGroqGateway(key, {
    fetch: async (input, init) => {
      const req = new Request(input, init);
      if (req.url.endsWith('/audio/transcriptions'))
        return json({ text: 'Affiche le nombre trois.' });
      const body = (await req.json()) as Record<string, unknown>;
      requests.push(body);
      if (++completion === 1)
        return json({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-card',
                    type: 'function',
                    function: {
                      name: 'ui__show_luna_card',
                      arguments: JSON.stringify({
                        schemaVersion: 1,
                        cardType: 'luna',
                        title: 'Un nombre',
                        primaryValue: '3',
                        subtitle: null,
                        description: null,
                        items: [],
                        sources: [],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      assert.ok(
        (body.messages as { role: string; content: string }[]).some(
          (message) => message.role === 'tool' && JSON.parse(message.content).accepted,
        ),
      );
      return json(reply('Voici le nombre trois.'));
    },
  });
  let now = Date.now();
  const live = new LiveTransport(
    gateway,
    () => false,
    undefined,
    {},
    () => now,
    'Groq',
  );
  const controller = new SessionController(new ProfileRepository(db), live, () => now, preferences);
  live.attach(controller);
  t.after(() => {
    live.dispose();
    db.close();
  });
  let sequence = 0;
  const observe = () => {
    controller.heartbeat();
    controller.observe({
      schemaVersion: 1,
      producerBootId: 'test',
      sequence: ++sequence,
      observedAt: now,
      health: 'ok',
      presence: true,
      engaged: true,
      people: [{ trackId: 'person', profileId: null }],
    });
  };
  observe();
  now += 900;
  observe();
  const scope = controller.scope();
  const texts: string[] = [];
  live.connectBrowser(scope, (message) => {
    if (message.type === 'speech') texts.push(message.text);
  });
  await setImmediate();
  assert.equal(controller.sessionState().phase, 'ready');
  say({ sendAudio: (pcm) => live.browserAudio(scope, pcm) });
  await until(() => texts.length === 1);
  assert.equal(controller.snapshot().state.cards[0]?.content.title, 'Un nombre');
  assert.equal(requests.length, 2);
  assert.ok(!JSON.stringify(requests[0]?.tools).includes('web_search'));
  controller.close('Fin du test.');
  assert.notEqual(controller.sessionState().phase, 'closing');
  assert.throws(() => live.browserAudio(scope, voiced), /périmée/);
});

test('Groq : annulation pendant HTTP et suppression des résultats tardifs', async () => {
  let requestSignal: AbortSignal | null = null;
  let finish!: (response: Response) => void;
  const texts: string[] = [];
  const events: ConnectServerEvent[] = [];
  const gateway = createGroqGateway(key, {
    fetch: async (_input, init) => {
      requestSignal = init?.signal ?? null;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  const connection = gateway.connect!(liveConfiguration(), {
    open() {},
    event: (event) => events.push(event),
    failure: assert.fail,
    text: (text) => texts.push(text),
  });
  say(connection);
  await until(() => !!finish);
  connection.dispose();
  assert.equal((requestSignal as AbortSignal | null)?.aborted, true);
  finish(json({ text: 'Une réponse qui arrive trop tard.' }));
  await setImmediate();
  assert.deepEqual(texts, []);
  assert.ok(!events.some((event) => event.type.includes('transcript')));
});

test('Groq : erreurs 401/429 sans secret, sans paroles et sans relance', async () => {
  for (const status of [401, 429]) {
    let calls = 0;
    const events: ConnectServerEvent[] = [];
    const gateway = createGroqGateway(key, {
      fetch: async () => {
        calls++;
        return json({ error: { message: key + ' paroles privées' } }, status);
      },
    });
    const connection = gateway.connect!(liveConfiguration(), {
      open() {},
      event: (event) => events.push(event),
      failure: assert.fail,
    });
    say(connection);
    await until(() => events.some((event) => event.type === 'error'));
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(events).includes(key));
    assert.ok(!JSON.stringify(events).includes('paroles privées'));
    assert.ok(
      JSON.stringify(events).includes(status === 401 ? 'Clé Groq refusée' : 'Quota Groq atteint'),
    );
    connection.dispose();
  }
});

test('Groq : un outil absent des droits du profil ne part jamais au transport', async () => {
  const events: ConnectServerEvent[] = [];
  const gateway = createGroqGateway(key, {
    fetch: async (input) =>
      String(input).endsWith('/audio/transcriptions')
        ? json({ text: 'Allume.' })
        : json({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'forbidden',
                      type: 'function',
                      function: { name: 'home_assistant__control', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          }),
  });
  const connection = gateway.connect!(liveConfiguration(), {
    open() {},
    event: (event) => events.push(event),
    failure: assert.fail,
  });
  say(connection);
  await until(() => events.some((event) => event.type === 'error'));
  assert.ok(
    !events.some(
      (event) =>
        event.type === 'response.event' && event.event.type === 'response.output_item.done',
    ),
  );
  connection.dispose();
});

test('Groq : extraction mémoire JSON sans Responses OpenAI, réponse tronquée refusée', async () => {
  let truncated = false;
  const extractor = createGroqMemoryExtractor(key, {
    model: 'modele-configure',
    fetch: async (input, init) => {
      assert.equal(String(input), 'https://api.groq.com/openai/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'modele-configure');
      assert.deepEqual(body.response_format, { type: 'json_object' });
      const result = reply('{"schemaVersion":1,"changes":[]}');
      if (truncated) result.choices[0]!.finish_reason = 'length';
      return json(result);
    },
  });
  const input = { now: new Date().toISOString(), turns: [], memories: [] } as unknown as Parameters<
    typeof extractor
  >[0];
  assert.deepEqual(await extractor(input, new AbortController().signal), {
    schemaVersion: 1,
    changes: [],
  });
  truncated = true;
  await assert.rejects(extractor(input, new AbortController().signal), /incomplète/);
});
