import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { DEFAULT_ADMIN_PASSWORD } from '../server/config.js';
import {
  buildLocalSttHints,
  buildLocalTurnContextHeader,
  cleanSpeechText,
  compactToolOutput,
  compactToolsForLocal,
  createLocalVoiceAdapter,
  fixMojibake,
  formatToolsForOllama,
  hasStreamingRepetitionLoop,
  isUsableTranscript,
  looksLikeEmptyLookupStall,
  normalizeLocalToolArgs,
  popCompleteSentences,
  rmsPcm16,
} from '../server/voice/local.js';
import {
  buildLocalProviderInstructions,
  createVoiceGateway,
  LOCAL_PROVIDER_INSTRUCTIONS,
} from '../server/voice/live-bridge.js';
import type { VoiceEvent } from '../server/voice/provider.js';
import {
  extractConfidentTranscript,
  pcmToWav,
  resamplePcm16Mono,
  synthesizeOpenAiTts,
  transcribeOpenAiStt,
} from '../server/voice/wyoming.js';
import { readinessChecklist } from '../shared/readiness.js';
import { isVoiceProvider, voiceProviderLabel } from '../shared/voice-provider.js';

function makePcmFrame(amplitude: number, samples = 512): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(amplitude, i * 2);
  return buf;
}

test('voiceProvider recognises local and readiness requires no cloud key', () => {
  assert.equal(isVoiceProvider('local'), true);
  assert.match(voiceProviderLabel('local'), /Local/);
  const items = readinessChecklist({
    state: {
      schemaVersion: 1,
      voiceProvider: 'local',
      setup: { voiceKey: true, perception: true },
      browserConnected: true,
      browserAudioReady: true,
      wakeWord: { enabled: true, ready: true },
      presence: { health: 'ok', state: 'engaged', peopleCount: 1, people: [] },
      session: {
        phase: 'idle',
        mode: 3,
        interactionId: null,
        profileEpoch: 1,
        contextVersion: 1,
      },
      profiles: [],
      cards: [],
      ambient: [],
      alarms: { ringing: [], timers: [], nextAlarm: null, reminders: [] },
    } as never,
    devices: null,
    defaultPassword: false,
    enrolledFaces: 1,
  });
  const keyItem = items.find((item) => item.id === 'openai-key');
  assert.equal(keyItem?.status, 'done');
  assert.equal(keyItem?.title, 'Moteur vocal local');
});

test('resamplePcm16Mono converts 22050 Hz to 16000 Hz cleanly', () => {
  const oneSecond22k = makePcmFrame(1200, 22050);
  const resampled = resamplePcm16Mono(oneSecond22k, 22050, 16000);
  assert.equal(resampled.length, 16000 * 2);
  assert.equal(resampled.readInt16LE(100), 1200);
});

test('sentence splitter and speech cleaner strip markdown', () => {
  assert.equal(cleanSpeechText('**Bonjour** [Ewan](https://x) `ok`'), 'Bonjour Ewan ok');
  const { sentences, rest } = popCompleteSentences('Première phrase. Deuxième phrase ! En cou');
  assert.deepEqual(sentences, ['Première phrase.', 'Deuxième phrase !']);
  assert.equal(rest, 'En cou');
});

test('createLocalVoiceAdapter handles speech -> STT -> Ollama tool call -> Piper TTS', async () => {
  const events: VoiceEvent[] = [];
  let ollamaRound = 0;

  const adapter = createLocalVoiceAdapter({
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen2.5:14b',
    whisper: { host: '127.0.0.1', port: 10300 },
    piper: { host: '127.0.0.1', port: 10200 },
    transcribe: async () => 'Allume la lampe du salon',
    synthesize: async ({ text }) => makePcmFrame(800, Math.min(800, text.length * 10)),
    fetch: async () => {
      ollamaRound++;
      const lines =
        ollamaRound === 1
          ? [
              JSON.stringify({
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      function: {
                        name: 'home_assistant__control',
                        arguments: { entity_id: 'light.salon', action: 'turn_on' },
                      },
                    },
                  ],
                },
                done: true,
              }),
            ]
          : [
              JSON.stringify({ message: { content: 'C’est fait. ' }, done: false }),
              JSON.stringify({ message: { content: 'La lampe est allumée.' }, done: true }),
            ];
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(lines.join('\n') + '\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    },
  });

  const conn = await adapter.connect(
    {
      instructions: 'Tu es Cornelius.',
      tools: [
        {
          name: 'home_assistant__control',
          description: 'Contrôle un appareil.',
          parameters: { type: 'object', properties: {} },
        },
      ],
      webSearch: false,
    },
    (event) => {
      events.push(event);
      if (event.type === 'tool_call') {
        conn.result(event.id, JSON.stringify({ ok: true }));
      }
    },
  );

  assert.equal(rmsPcm16(makePcmFrame(1500, 512)), 1500);
  // Prime adaptive noise floor at RMS 350, speak at RMS 1500, then return to RMS 350 ambient
  for (let i = 0; i < 6; i++) conn.audio(makePcmFrame(350, 512));
  for (let i = 0; i < 11; i++) conn.audio(makePcmFrame(1500, 512));
  for (let i = 0; i < 26; i++) conn.audio(makePcmFrame(350, 512));

  await new Promise((resolve) => setTimeout(resolve, 350));
  await conn.close();

  assert.ok(
    events.some((e) => e.type === 'user_transcript' && e.text === 'Allume la lampe du salon'),
  );
  assert.ok(events.some((e) => e.type === 'tool_call' && e.name === 'home_assistant__control'));
  assert.ok(events.some((e) => e.type === 'assistant_speech' && e.pcm.length > 0));
  assert.ok(events.some((e) => e.type === 'turn_completed'));
  assert.ok(events.some((e) => e.type === 'closed'));
});

test('createApp configures local voice provider without cloud API key', async () => {
  const { app, controller } = await createApp(
    {
      databasePath: ':memory:',
      adminPassword: DEFAULT_ADMIN_PASSWORD,
      origins: ['http://127.0.0.1:3000'],
      secureCookies: false,
      defaultVoiceProvider: 'local',
      localVoice: {
        ollamaUrl: 'http://127.0.0.1:11434',
        ollamaModel: 'qwen3:8b',
        whisperHost: '127.0.0.1',
        whisperPort: 10300,
        piperHost: '127.0.0.1',
        piperPort: 10200,
      },
    },
    { timers: false },
  );

  try {
    const snap = controller.snapshot();
    assert.equal(snap.state.voiceProvider, 'local');
    assert.equal(snap.state.setup?.voiceKey, true);
    const authRes = await app.inject({ method: 'GET', url: '/api/auth' });
    assert.equal(authRes.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('pcmToWav and transcribeOpenAiStt upload valid WAV with vad_filter and model', async () => {
  const pcm = makePcmFrame(500, 1600);
  const wav = pcmToWav(pcm);
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), pcm.length);

  let seenUrl = '';
  let seenModel = '';
  let seenVad = '';
  const text = await transcribeOpenAiStt({
    baseUrl: 'http://192.168.20.159:10301',
    model: 'deepdml/faster-whisper-large-v3-turbo-ct2',
    pcm16k: pcm,
    fetch: async (url, init) => {
      seenUrl = String(url);
      const body = init?.body as FormData;
      seenModel = String(body.get('model'));
      seenVad = String(body.get('vad_filter'));
      return new Response(JSON.stringify({ text: 'Quelle heure est-il ?' }), { status: 200 });
    },
  });
  assert.equal(seenUrl, 'http://192.168.20.159:10301/v1/audio/transcriptions');
  assert.equal(seenModel, 'deepdml/faster-whisper-large-v3-turbo-ct2');
  assert.equal(seenVad, 'true');
  assert.equal(text, 'Quelle heure est-il ?');
});

test('Silero VAD drives segmentation even under noisy RMS and forces think=false on qwen3', async () => {
  const events: VoiceEvent[] = [];
  let capturedBody: Record<string, unknown> | null = null;
  let sttCalls = 0;

  const adapter = createLocalVoiceAdapter({
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:8b',
    whisper: { host: '127.0.0.1', port: 10300 },
    piper: { host: '127.0.0.1', port: 10200 },
    transcribe: async () => {
      sttCalls++;
      return 'Quelle heure est-il ?';
    },
    synthesize: async () => makePcmFrame(500, 400),
    fetch: async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const line = JSON.stringify({
        message: { content: 'Il est vingt-deux heures.' },
        done: true,
      });
      return new Response(line + '\n', { status: 200 });
    },
  });

  const conn = await adapter.connect(
    { instructions: 'Tu es Cornelius.', tools: [], webSearch: false },
    (event) => events.push(event),
  );

  // Loud RMS noise with Silero VAD false must NOT trigger STT
  conn.vad?.(false);
  for (let i = 0; i < 20; i++) conn.audio(makePcmFrame(2200, 512));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(sttCalls, 0);

  // Silero VAD true -> speech frames -> Silero VAD false -> ends turn cleanly
  conn.vad?.(true);
  for (let i = 0; i < 10; i++) conn.audio(makePcmFrame(800, 512));
  conn.vad?.(false);
  for (let i = 0; i < 26; i++) conn.audio(makePcmFrame(800, 512));

  await new Promise((resolve) => setTimeout(resolve, 200));
  await conn.close();

  assert.equal(sttCalls, 1);
  assert.equal(capturedBody?.['think'], false);
  assert.ok(events.some((e) => e.type === 'user_transcript' && e.text === 'Quelle heure est-il ?'));
  assert.ok(events.some((e) => e.type === 'turn_completed'));
});

test('normalizeLocalToolArgs fills strict null fields and local gateway preserves long tool descriptions', async () => {
  assert.deepEqual(
    normalizeLocalToolArgs('home_assistant__control', {
      entityId: 'light.chambre',
      action: 'turn_off',
    }),
    {
      entityId: 'light.chambre',
      action: 'turn_off',
      brightnessPct: null,
      rgbColor: null,
      colorTempKelvin: null,
    },
  );
  assert.deepEqual(normalizeLocalToolArgs('clock__read', {}), { instanceRef: null });
  const multiTransitDesc =
    'Sources autorisées : rer-pour-l-ecole (RER pour l’école), bus-travail (Bus 4120 travail). Utilise l’identifiant exact dans instanceRef, sans l’inventer.';
  assert.deepEqual(
    normalizeLocalToolArgs('transit__read', { instanceRef: 'Bus 4120 travail' }, multiTransitDesc),
    { instanceRef: 'bus-travail' },
  );
  assert.deepEqual(
    normalizeLocalToolArgs('transit__read', { instanceRef: 'rer-pour-l-ecole' }, multiTransitDesc),
    { instanceRef: 'rer-pour-l-ecole' },
  );

  const longDesc = 'Appareils : ' + 'x'.repeat(2500);
  let receivedDesc = '';
  const gw = createVoiceGateway(
    {
      async connect(cfg) {
        receivedDesc = cfg.tools[0]?.description ?? '';
        return {
          audio() {},
          result() {},
          async update() {},
          async close() {},
        };
      },
    },
    { provider: 'local' },
  );
  const conn = gw.connect!(
    {
      delegation: {
        responses: {
          tools: [
            {
              type: 'function',
              name: 'home_assistant__control',
              description: longDesc,
              parameters: {},
            },
          ],
        },
      },
    } as never,
    { open() {}, event() {}, failure() {} },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(receivedDesc, longDesc);
  conn.dispose();
});

test('synthesizeOpenAiTts posts Kokoro payload and resamples 24 kHz PCM to 16 kHz', async () => {
  const oneSec24k = makePcmFrame(900, 24000);
  let seenPayload: Record<string, unknown> | null = null;
  const pcm16k = await synthesizeOpenAiTts({
    baseUrl: 'http://192.168.20.159:10301',
    model: 'speaches-ai/Kokoro-82M-v1.0-ONNX',
    voice: 'ff_siwis',
    text: 'Bonjour Ewan.',
    fetch: async (_url, init) => {
      seenPayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(new Uint8Array(oneSec24k), { status: 200 });
    },
  });
  assert.equal(seenPayload?.['model'], 'speaches-ai/Kokoro-82M-v1.0-ONNX');
  assert.equal(seenPayload?.['voice'], 'ff_siwis');
  assert.equal(seenPayload?.['response_format'], 'pcm');
  assert.equal(pcm16k.length, 16000 * 2);

  // Check clause splitting >= 24 chars and compactToolOutput metadata removal
  const splitClause = popCompleteSentences(
    'Toutes les lumières sont allumées, et il fait vingt degrés dans la pièce',
  );
  assert.deepEqual(splitClause.sentences, ['Toutes les lumières sont allumées,']);
  assert.equal(splitClause.rest, 'et il fait vingt degrés dans la pièce');

  const compacted = JSON.parse(
    compactToolOutput(
      JSON.stringify({
        schemaVersion: 1,
        snapshotId: 'snap-1',
        actionRunId: 'run-1',
        status: 'succeeded',
        summary: 'État confirmé.',
        result: {
          accepted: true,
          entity: {
            id: 'light.salon',
            state: 'on',
            attributes: { big: 'payload' },
            aliases: ['salon'],
            observedAt: 12345,
          },
        },
      }),
    ),
  ) as Record<string, unknown>;
  assert.equal(compacted['schemaVersion'], undefined);
  assert.equal(compacted['snapshotId'], undefined);
  assert.equal(compacted['actionRunId'], undefined);
  const ent = (compacted['result'] as Record<string, unknown>)['entity'] as Record<string, unknown>;
  assert.equal(ent['id'], 'light.salon');
  assert.equal(ent['attributes'], undefined);
  assert.equal(ent['aliases'], undefined);
  assert.equal(ent['observedAt'], undefined);
});

test('barge-in interrupts active assistant speech and captures new utterance', async () => {
  const events: VoiceEvent[] = [];
  let sttTurn = 0;

  const adapter = createLocalVoiceAdapter({
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:8b',
    whisper: { host: '127.0.0.1', port: 10300 },
    piper: { host: '127.0.0.1', port: 10200 },
    transcribe: async () =>
      ++sttTurn === 1 ? 'Raconte une histoire' : 'Stop, quelle heure est-il ?',
    synthesize: async () => makePcmFrame(500, 12800), // ~800 ms audio so speaking stays active
    fetch: async () =>
      new Response(
        JSON.stringify({
          message: {
            content:
              sttTurn === 1 ? 'Il était une fois un grand miroir magique.' : 'Il est neuf heures.',
          },
          done: true,
        }) + '\n',
        { status: 200 },
      ),
  });

  const conn = await adapter.connect(
    { instructions: 'Tu es Cornelius.', tools: [], webSearch: false },
    (event) => events.push(event),
  );

  // Turn 1: prime quiet noise floor (150), then trigger long assistant speech
  conn.vad?.(false);
  for (let i = 0; i < 4; i++) conn.audio(makePcmFrame(150, 512));
  conn.vad?.(true);
  for (let i = 0; i < 10; i++) conn.audio(makePcmFrame(900, 512));
  conn.vad?.(false);
  for (let i = 0; i < 12; i++) conn.audio(makePcmFrame(150, 512));

  // Wait until assistant starts speaking
  for (let w = 0; w < 30; w++) {
    if (events.some((e) => e.type === 'assistant_speech')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(events.some((e) => e.type === 'assistant_speech'));

  // Interrupt (barge-in) while assistant is still speaking
  conn.vad?.(true);
  for (let i = 0; i < 7; i++) conn.audio(makePcmFrame(1800, 512));
  conn.vad?.(false);
  for (let i = 0; i < 12; i++) conn.audio(makePcmFrame(100, 512));

  await new Promise((r) => setTimeout(r, 350));
  await conn.close();

  assert.ok(events.some((e) => e.type === 'interrupted'));
  assert.ok(
    events.some((e) => e.type === 'user_transcript' && e.text === 'Stop, quelle heure est-il ?'),
  );
  assert.equal(sttTurn, 2);
});

test('compactToolsForLocal compresses HA entity catalogs, extractConfidentTranscript drops Whisper silence hallucinations, and synthesizeOpenAiTts streams chunks', async () => {
  const compacted = compactToolsForLocal([
    {
      name: 'http__send',
      description: 'Déclencher une commande HTTP. Aucune commande n’est autorisée pour ce profil.',
      parameters: {},
    },
    {
      name: 'home_assistant__control',
      description:
        'Contrôler un appareil. Appareils : ' +
        JSON.stringify([
          { id: 'light.salon', name: 'Lumière Salon', brightness: true, color: false },
          { id: 'switch.aquarium', name: 'Prise Aquarium', brightness: false },
        ]),
      parameters: {},
    },
    {
      name: 'home_assistant__read',
      description:
        'Lire capteur. Capteurs : ' +
        JSON.stringify([{ id: 'sensor.temp_salon', name: 'Température Salon', unit: '°C' }]),
      parameters: {},
    },
  ]);
  assert.equal(compacted.length, 2);
  assert.match(compacted[0]!.description, /light\.salon=Lumière Salon\[dim\]/);
  assert.match(compacted[1]!.description, /sensor\.temp_salon=Température Salon\(°C\)/);
  assert.ok(!compacted.some((t) => t.name === 'http__send'));

  assert.equal(
    extractConfidentTranscript({
      text: "Merci d'avoir regardé",
      segments: [{ text: "Merci d'avoir regardé", no_speech_prob: 0.85, avg_logprob: -1.1 }],
    }),
    '',
  );
  assert.equal(
    extractConfidentTranscript({
      text: 'Allume le salon',
      segments: [{ text: ' Allume le salon ', no_speech_prob: 0.05, avg_logprob: -0.2 }],
    }),
    'Allume le salon',
  );
  assert.equal(
    hasStreamingRepetitionLoop(
      'Evan. Faut pas traîner. Evan. Faut pas traîner. Evan. Faut pas traîner.',
    ),
    true,
  );

  const chunks24k = [makePcmFrame(600, 1200), makePcmFrame(600, 1200)];
  const emittedChunks: Buffer[] = [];
  let sawStreamFlag = false;
  const full = await synthesizeOpenAiTts({
    baseUrl: 'http://127.0.0.1:10302',
    model: 'kokoro',
    voice: 'ff_siwis',
    text: 'Bonjour.',
    onChunk: (c) => emittedChunks.push(c),
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      sawStreamFlag = body['stream'] === true;
      const stream = new ReadableStream({
        start(controller) {
          for (const ch of chunks24k) controller.enqueue(new Uint8Array(ch));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    },
  });
  assert.equal(sawStreamFlag, true);
  assert.ok(emittedChunks.length >= 2);
  assert.equal(full.length, 1600 * 2);
});

test('looksLikeEmptyLookupStall detects filler promises and retries tool invocation', async () => {
  assert.equal(
    looksLikeEmptyLookupStall('Je vais chercher tes photos de vacances. Un instant.'),
    true,
  );
  assert.equal(looksLikeEmptyLookupStall('Il fait douze degrés à Épisy.'), false);

  const events: VoiceEvent[] = [];
  let ollamaCall = 0;
  const adapter = createLocalVoiceAdapter({
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:8b',
    whisper: { host: '127.0.0.1', port: 10300 },
    piper: { host: '127.0.0.1', port: 10200 },
    transcribe: async () => 'Affiche mes photos de vacances',
    synthesize: async () => makePcmFrame(300, 160),
    fetch: async () => {
      ollamaCall++;
      if (ollamaCall === 1) {
        return new Response(
          JSON.stringify({
            message: { content: 'Je vais chercher tes photos de vacances. Un instant.' },
            done: true,
          }) + '\n',
          { status: 200 },
        );
      }
      if (ollamaCall === 2) {
        return new Response(
          JSON.stringify({
            message: {
              content: '',
              tool_calls: [
                {
                  function: {
                    name: 'immich__search',
                    arguments: { instanceRef: null, query: 'vacances' },
                  },
                },
              ],
            },
            done: true,
          }) + '\n',
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ message: { content: 'Voici tes photos de vacances.' }, done: true }) +
          '\n',
        { status: 200 },
      );
    },
  });

  const conn = await adapter.connect(
    {
      instructions: 'Tu es Cornelius.',
      tools: [{ name: 'immich__search', description: 'Chercher des photos.', parameters: {} }],
      webSearch: false,
    },
    (event) => events.push(event),
  );
  conn.vad?.(true);
  for (let i = 0; i < 10; i++) conn.audio(makePcmFrame(900, 512));
  conn.vad?.(false);
  for (let i = 0; i < 12; i++) conn.audio(makePcmFrame(150, 512));

  for (let w = 0; w < 40; w++) {
    const tc = events.find((e) => e.type === 'tool_call');
    if (tc && tc.type === 'tool_call') {
      conn.result(tc.id, JSON.stringify({ photos: ['a'] }));
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  for (let w = 0; w < 40; w++) {
    if (events.some((e) => e.type === 'turn_completed')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  await conn.close();

  assert.equal(ollamaCall, 3);
  assert.ok(events.some((e) => e.type === 'tool_call' && e.name === 'immich__search'));
  const finalAssistant = events.find((e) => e.type === 'assistant_transcript');
  assert.ok(finalAssistant && finalAssistant.type === 'assistant_transcript');
  assert.equal(finalAssistant.text, 'Voici tes photos de vacances.');
});

test('local optimizations: fixMojibake, isUsableTranscript, KV tool compaction & sorting, normalizeLocalToolArgs, cleanSpeechText', () => {
  const doubleEncoded = Buffer.from(
    Buffer.from('Lumières Salon', 'utf8').toString('latin1'),
    'utf8',
  ).toString('latin1');
  assert.equal(fixMojibake(doubleEncoded), 'Lumières Salon');
  assert.equal(isUsableTranscript('Etc.'), false);
  assert.equal(isUsableTranscript('Allume le salon'), true);

  const rawTools = [
    {
      name: 'immich__search',
      description:
        'Chercher photos. Source autorisée : immich-ewan (Ewan). Laisse instanceRef vide.',
      parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 100 } } },
    },
    {
      name: 'alarms__set',
      description:
        'Régler un réveil. Nous sommes samedi 21 novembre 2026 à 23 h 58. Suit des règles.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['alarm', 'timer', 'reminder'] },
          time: { type: ['string', 'null'], pattern: '^[0-9]{2}:[0-9]{2}$' },
          owner: { type: 'string', enum: ['foyer'] },
        },
      },
    },
    {
      name: 'home_assistant__control',
      description:
        'Contrôler. Appareils : ' +
        JSON.stringify([{ id: 'light.lumieres_salon', name: doubleEncoded, brightness: true }]),
      parameters: {
        type: 'object',
        required: ['entityId', 'action'],
        properties: {
          entityId: { type: 'string', enum: ['light.lumieres_salon', 'switch.prise'] },
          action: { type: 'string', enum: ['turn_on', 'turn_off'] },
        },
      },
    },
    {
      name: 'mail__send',
      description: 'Envoyer un mail sans destinataire configuré.',
      parameters: {},
    },
  ];
  const compacted = compactToolsForLocal(rawTools);
  assert.ok(!compacted.some((t) => t.name === 'mail__send'));
  const alarmTool = compacted.find((t) => t.name === 'alarms__set')!;
  assert.ok(!alarmTool.description.includes('23 h 58'));
  assert.equal((alarmTool.parameters as any).properties.time.pattern, undefined);
  assert.deepEqual((alarmTool.parameters as any).properties.owner.enum, ['moi', 'foyer']);
  const haCtrl = compacted.find((t) => t.name === 'home_assistant__control')!;
  assert.match(haCtrl.description, /light\.lumieres_salon=Lumières Salon\[dim\]/);
  assert.equal((haCtrl.parameters as any).properties.entityId.enum, undefined);

  const ordered = formatToolsForOllama(compacted, true, true);
  assert.deepEqual(
    ordered.map((t) => t.function.name),
    ['alarms__set', 'home_assistant__control', 'web_search', 'immich__search'],
  );

  assert.deepEqual(
    normalizeLocalToolArgs('home_assistant__control', {
      entity_id: 'light.wled',
      action: 'turn_on',
    }),
    {
      entityId: 'light.wled',
      action: 'turn_on',
      brightnessPct: null,
      rgbColor: null,
      colorTempKelvin: null,
    },
  );
  assert.deepEqual(
    normalizeLocalToolArgs(
      'immich__search',
      { instanceRef: 'bad', query: 'vacances' },
      'Source autorisée : immich-ewan.',
    ),
    { instanceRef: null, query: 'vacances' },
  );
  assert.deepEqual(normalizeLocalToolArgs('alarms__set', { kind: 'timer', durationSeconds: 120 }), {
    kind: 'timer',
    durationSeconds: 120,
    time: null,
    date: null,
    inMinutes: null,
    days: [],
    label: null,
  });
  assert.equal(
    cleanSpeechText('Le gazole est à 1,69 € avec home_assistant__control.'),
    'Le gazole est à 1,69 euros avec .',
  );
  assert.ok(
    !cleanSpeechText('Appelle home_assistant__control maintenant.').includes(
      'home_assistant__control',
    ),
  );
});

test('normalizeLocalToolArgs resolves HA domain swaps, sanitizes alarms__set, and expands comma-separated HA entities', async () => {
  const haCtrlDesc =
    'Appareils : ' +
    JSON.stringify([{ id: 'switch.lampe_salle_a_manger', name: 'Lampe salle à manger' }]);
  assert.deepEqual(
    normalizeLocalToolArgs(
      'home_assistant__control',
      { entityId: 'light.lampe_salle_a_manger', action: 'turn_on' },
      haCtrlDesc,
    ),
    {
      entityId: 'switch.lampe_salle_a_manger',
      action: 'turn_on',
      brightnessPct: null,
      rgbColor: null,
      colorTempKelvin: null,
    },
  );
  assert.equal(
    normalizeLocalToolArgs(
      'home_assistant__control',
      { entityId: 'light.piscine', action: 'turn_on' },
      haCtrlDesc,
    ).entityId,
    'light.piscine',
  );
  assert.equal(
    normalizeLocalToolArgs(
      'home_assistant__read',
      { entityId: 'sensor.opnsense_status' },
      'Capteurs: binary_sensor.opnsense_status=OPNsense Status',
    ).entityId,
    'binary_sensor.opnsense_status',
  );

  assert.deepEqual(
    normalizeLocalToolArgs('alarms__set', {
      kind: 'timer',
      time: '20:00',
      date: '2026-11-22',
      durationSeconds: 86400,
      label: 'sortir les poubelles',
      owner: 'moi',
    }),
    {
      kind: 'reminder',
      time: '20:00',
      date: '2026-11-22',
      durationSeconds: null,
      inMinutes: null,
      days: [],
      label: 'sortir les poubelles',
      owner: 'moi',
    },
  );
  assert.deepEqual(
    normalizeLocalToolArgs('alarms__set', {
      kind: 'alarm',
      time: '7:00',
      days: ['mon'],
      date: '2026-11-23',
    }),
    {
      kind: 'alarm',
      time: '07:00',
      days: ['mon'],
      date: null,
      inMinutes: null,
      durationSeconds: null,
      label: null,
    },
  );
  assert.deepEqual(
    normalizeLocalToolArgs('alarms__set', {
      kind: 'timer',
      inMinutes: 8,
      label: 'pâtes',
    }),
    {
      kind: 'timer',
      durationSeconds: 480,
      inMinutes: null,
      time: null,
      date: null,
      days: [],
      label: 'pâtes',
    },
  );
  assert.deepEqual(normalizeLocalToolArgs('alarms__cancel', { kind: 'timer', match: 'pâtes' }), {
    id: null,
    kind: 'timer',
    match: 'pâtes',
    all: false,
  });

  let ollamaTurn = 0;
  let secondTurnBody = '';
  const events: VoiceEvent[] = [];
  const adapter = createLocalVoiceAdapter({
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:8b',
    whisper: { host: '127.0.0.1', port: 10300 },
    piper: { host: '127.0.0.1', port: 10200 },
    transcribe: async () => "Quel est l'état d'OPNsense et CrowdSec ?",
    synthesize: async () => makePcmFrame(300, 1600),
    fetch: async (_url, init) => {
      ollamaTurn++;
      if (ollamaTurn === 1) {
        return new Response(
          JSON.stringify({
            message: {
              content: '',
              tool_calls: [
                {
                  function: {
                    name: 'home_assistant__read',
                    arguments: { entityId: 'binary_sensor.a,sensor.b' },
                  },
                },
              ],
            },
            done: true,
          }) + '\n',
          { status: 200 },
        );
      }
      secondTurnBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({ message: { content: 'OPNsense et CrowdSec sont actifs.' }, done: true }) +
          '\n',
        { status: 200 },
      );
    },
  });

  const conn = await adapter.connect(
    {
      instructions: 'Tu es Cornelius.',
      tools: [
        {
          name: 'home_assistant__read',
          description:
            'Lire. Capteurs : ' +
            JSON.stringify([
              { id: 'binary_sensor.a', name: 'OPNsense' },
              { id: 'binary_sensor.b', name: 'CrowdSec' },
            ]),
          parameters: { type: 'object', properties: { entityId: { type: 'string' } } },
        },
      ],
      webSearch: false,
    },
    (event) => {
      events.push(event);
      if (event.type === 'tool_call') {
        const parsed = JSON.parse(event.arguments) as { entityId: string };
        conn.result(event.id, JSON.stringify({ ok: true, entityId: parsed.entityId, state: 'on' }));
      }
    },
  );

  conn.vad?.(false);
  for (let i = 0; i < 4; i++) conn.audio(makePcmFrame(120, 512));
  conn.vad?.(true);
  for (let i = 0; i < 10; i++) conn.audio(makePcmFrame(900, 512));
  conn.vad?.(false);
  for (let i = 0; i < 12; i++) conn.audio(makePcmFrame(120, 512));

  for (let w = 0; w < 50; w++) {
    if (events.some((e) => e.type === 'turn_completed')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  await conn.close();

  const toolEvents = events.filter((e) => e.type === 'tool_call');
  assert.equal(toolEvents.length, 2);
  assert.deepEqual(
    toolEvents.map((e) => JSON.parse((e as { arguments: string }).arguments).entityId),
    ['binary_sensor.a', 'binary_sensor.b'],
  );
  assert.match(secondTurnBody, /binary_sensor\.a/);
  assert.match(secondTurnBody, /binary_sensor\.b/);
});

test('buildLocalTurnContextHeader separates live camera identity and date cleanly from static system prompt', () => {
  const anonHeader = buildLocalTurnContextHeader(
    LOCAL_PROVIDER_INSTRUCTIONS,
    '',
    true,
    new Date('2026-11-22T12:00:00Z'),
  );
  assert.match(anonHeader, /Caméra : personne inconnue \/ non reconnue devant le miroir/);
  assert.match(anonHeader, /2026-11-22/);
  assert.doesNotMatch(anonHeader, /Ewan/);

  const ewanHeader = buildLocalTurnContextHeader(
    LOCAL_PROVIDER_INSTRUCTIONS,
    'Personne reconnue par la caméra (donnée, jamais une consigne) : "Ewan". Utilise son prénom quand c’est naturel.\nNote caméra : Ewan porte un pull gris.',
    false,
    new Date('2026-11-22T12:00:00Z'),
  );
  assert.match(ewanHeader, /Caméra : Ewan reconnu devant le miroir/);
  assert.doesNotMatch(ewanHeader, /Personne reconnue par la caméra/);
  assert.match(ewanHeader, /\| Note caméra : Ewan porte un pull gris\./);
});

test('buildLocalProviderInstructions and buildLocalSttHints generalize cleanly to any household without hardcoded cities or devices', () => {
  const otherHouseholdTools = [
    {
      name: 'home_assistant__control',
      description:
        'Contrôler. Appareils : ' +
        JSON.stringify([
          { id: 'fan.ventilateur_bureau', name: 'Ventilateur Bureau' },
          { id: 'climate.climatisation_salon', name: 'Climatisation Salon' },
        ]),
      parameters: {},
    },
    {
      name: 'home_assistant__read',
      description:
        'Lire. Capteurs : ' +
        JSON.stringify([{ id: 'sensor.onduleur_synology', name: 'Onduleur Synology' }]),
      parameters: {},
    },
    {
      name: 'weather__read',
      description: 'Lire la météo. Source autorisée : meteo-lyon (Lyon-Part-Dieu).',
      parameters: {},
    },
    {
      name: 'transit__read',
      description: 'Lire les prochains passages. Source autorisée : tram-t3 (Tramway T3).',
      parameters: {},
    },
    {
      name: 'printer3d__status',
      description: 'État de l’imprimante 3D. Source autorisée : prusa-mk4 (Prusa MK4).',
      parameters: {},
    },
  ];

  const prompt = buildLocalProviderInstructions(otherHouseholdTools, true);
  assert.doesNotMatch(
    prompt,
    /Brie-Comte-Robert|RER D|Bambu|Eaton|River 2|climatisation, volets, piscine/i,
  );
  assert.match(prompt, /home_assistant__control/);
  assert.match(prompt, /weather__read/);
  assert.match(prompt, /printer3d__status/);

  // Minimal household without printer3d/homelab/carburants omits those rules
  const minimalPrompt = buildLocalProviderInstructions([otherHouseholdTools[0]!], false);
  assert.doesNotMatch(
    minimalPrompt,
    /printer3d__status|homelab__status|carburants__read|web_search/,
  );

  // STT hints extract safe domain terms without common French stop words or short names
  const stt = buildLocalSttHints(otherHouseholdTools);
  assert.match(stt.prompt, /^Bonjour Cornelius,/);
  assert.match(stt.hotwords, /Synology/);
  assert.match(stt.hotwords, /Lyon-Part-Dieu/);
  assert.match(stt.hotwords, /Prusa/);
  assert.doesNotMatch(stt.hotwords, /\b(?:Ewan|Salon|Bureau|Onduleur|Climatisation)\b/i);

  // Generic domain swap supports fan <-> light when fan exists in authorized devices
  assert.equal(
    normalizeLocalToolArgs(
      'home_assistant__control',
      { entityId: 'light.ventilateur_bureau', action: 'turn_on' },
      otherHouseholdTools[0]!.description,
    ).entityId,
    'fan.ventilateur_bureau',
  );
});
