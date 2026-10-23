import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceGateway, mistralToolDescription } from '../server/voice/live-bridge.js';
import {
  upsamplePcm16,
  pcmDownsampler,
  MISTRAL_STT_MODEL,
  MISTRAL_LLM_MODEL,
  MISTRAL_MAX_SESSION_MS,
  createMistralVoiceAdapter,
  MISTRAL_TTS_MODEL,
  shouldForwardVoiceAudio,
} from '../server/voice/mistral.js';
import type { VoiceConfiguration, VoiceConnection, VoiceEvent } from '../server/voice/provider.js';
import { liveConfiguration } from '../server/live/configuration.js';
import { openDatabase, SessionPreferences } from '../server/storage.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
test('Voxtral 3 models are pinned instead of relying on incompatible API defaults', () => {
  assert.equal(MISTRAL_STT_MODEL, 'voxtral-mini-transcribe-realtime-3');
  assert.equal(MISTRAL_TTS_MODEL, 'voxtral-mini-tts-3');
  assert.equal(MISTRAL_MAX_SESSION_MS, 15 * 60_000);
});

test('provider preference migrates to OpenAI and persists Mistral', () => {
  const db = openDatabase(':memory:');
  const preferences = new SessionPreferences(db);
  assert.equal(preferences.getVoiceProvider(), 'openai');
  preferences.setVoiceProvider('mistral');
  assert.equal(new SessionPreferences(db).getVoiceProvider(), 'mistral');
  assert.throws(() => preferences.setVoiceProvider('other' as never));
  db.close();
});
test('continuous Mistral background audio is ignored outside assistant speech', () => {
  assert.equal(shouldForwardVoiceAudio('listening'), false);
  assert.equal(shouldForwardVoiceAudio('thinking'), false);
  assert.equal(shouldForwardVoiceAudio('speaking'), true);
});

test('PCM resampling preserves duration and handles split output samples', () => {
  const input = Buffer.alloc(1024);
  for (let i = 0; i < input.length / 2; i++) input.writeInt16LE(12345, i * 2);
  const upsampled = upsamplePcm16(input);
  assert.equal(upsampled.length, input.length * 3);
  const downsample = pcmDownsampler();
  assert.deepEqual(
    Buffer.concat([downsample(upsampled.subarray(0, 101)), downsample(upsampled.subarray(101))]),
    input,
  );
  assert.throws(() => upsamplePcm16(Buffer.alloc(3)));
});
test('dynamic Hermes descriptions are bounded without removing their intent', () => {
  const description = 'Confier une demande à Hermes. ' + 'catalogue '.repeat(300);
  const bounded = mistralToolDescription(description);
  assert.equal(bounded.length, 1024);
  assert.match(bounded, /^Confier une demande à Hermes/u);
  assert.match(bounded, /agents__capabilities/u);
  assert.equal(mistralToolDescription('Court'), 'Court');
});

test('adapter reuses local tool dispatch, returns RPC results and confirms context only after update', async () => {
  let emit!: (event: VoiceEvent) => void;
  let config!: VoiceConfiguration;
  const events: unknown[] = [];
  const results: unknown[] = [];
  const updates: VoiceConfiguration[] = [];
  let closes = 0;
  const connection: VoiceConnection = {
    audio: () => {},
    result: (...args) => results.push(args),
    update: async (value) => {
      updates.push(value);
    },
    close: async () => {
      closes++;
    },
  };
  const gateway = createVoiceGateway({
    connect: async (value, handler) => {
      config = value;
      emit = handler;
      return connection;
    },
  });
  const live = gateway.connect!(
    liveConfiguration([
      { name: 'home__read', description: 'Read', parameters: { type: 'object' } },
    ]),
    {
      open() {},
      event: (event) => events.push(event),
      failure() {
        assert.fail('unexpected failure');
      },
    },
  );
  await tick();
  assert.equal(
    config.tools.some((tool) => tool.name === 'home__read'),
    true,
  );
  assert.equal(config.webSearch, true);
  emit({ type: 'tool_call', id: 'call1', name: 'home__read', arguments: '{}' });
  assert.equal(
    events.some((e) => (e as any).event?.item?.call_id === 'call1'),
    true,
  );
  live.send({
    type: 'response.item.create',
    item: { type: 'function_call_output', call_id: 'call1', output: '{"ok":true}' },
  });
  assert.deepEqual(results, [['call1', '{"ok":true}']]);
  live.send({
    type: 'session.thinking.append',
    event_id: 'camera1',
    content: 'Caméra locale : test',
    delegation_id: null,
  });
  await tick();
  assert.match(updates[0]!.instructions, /Caméra locale : test/);
  assert.equal(
    events.some((e) => (e as any).client_event_id === 'camera1'),
    true,
  );
  live.dispose();
  await tick();
  assert.equal(closes, 1);
  const count = events.length;
  emit({ type: 'user_transcript', id: 'late', text: 'private', startMs: 0, endMs: 20 });
  assert.equal(events.length, count);
});
test('late creation is closed when the local session has already ended', async () => {
  let resolve!: (value: VoiceConnection) => void;
  let closes = 0;
  const gateway = createVoiceGateway({
    connect: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const live = gateway.connect!(liveConfiguration(), { open() {}, event() {}, failure() {} });
  live.dispose();
  resolve({
    audio() {},
    result() {},
    async update() {},
    async close() {
      closes++;
    },
  });
  await tick();
  assert.equal(closes, 1);
});

test('server PCM lifecycle retains scope checks, audio, interruptions and session closure', async () => {
  const { ProfileRepository } = await import('../server/storage.js');
  const { SessionController } = await import('../server/controller.js');
  const { LiveTransport } = await import('../server/live/transport.js');
  const db = openDatabase(':memory:');
  const preferences = new SessionPreferences(db);
  preferences.setSessionMode(4);
  let now = Date.now();
  let emit!: (event: VoiceEvent) => void;
  let closes = 0;
  const microphone: Buffer[] = [];
  const output: Array<Buffer | null | 'ready'> = [];
  const gateway = createVoiceGateway({
    connect: async (_config, handler) => {
      emit = handler;
      return {
        audio: (pcm) => microphone.push(pcm),
        result() {},
        async update() {},
        async close() {
          closes++;
        },
      };
    },
  });
  const live = new LiveTransport(gateway);
  const controller = new SessionController(new ProfileRepository(db), live, () => now, preferences);
  live.attach(controller);
  controller.heartbeat();
  controller.setWakeWordAvailability(true, null);
  assert.equal(controller.wakeDetected(), true);
  const scope = controller.scope();
  assert.throws(() =>
    live.browserAudio({ ...scope, profileEpoch: scope.profileEpoch + 1 }, () => {}),
  );
  const browser = live.browserAudio(scope, (pcm) => output.push(pcm));
  await tick();
  emit({ type: 'connected', id: 'remote-mistral' });
  assert.equal(controller.sessionState().phase, 'ready');
  assert.deepEqual(output, ['ready']);
  const pcm = Buffer.alloc(1024, 2);
  browser.send(pcm);
  assert.deepEqual(microphone, [pcm]);
  emit({ type: 'assistant_speech', pcm });
  emit({ type: 'interrupted' });
  assert.deepEqual(output, ['ready', pcm, null]);
  live.setGateway(null); // key rotation changes only future conversations
  browser.send(pcm);
  assert.equal(microphone.length, 2);
  controller.close('test');
  await tick();
  assert.equal(closes, 1);
  assert.equal(controller.sessionState().phase, 'idle');
  browser.send(pcm);
  assert.equal(microphone.length, 2);
  now += 100;
  live.dispose();
  db.close();
});

test('search citations accept only explicit source URLs returned by the search tool', async () => {
  const { searchSources } = await import('../server/voice/mistral.js');
  assert.deepEqual(
    searchSources(
      JSON.stringify({
        results: [
          { url: 'https://example.com/source', title: 'Source' },
          { url: 'javascript:alert(1)' },
          { url: 'https://user:password@example.com/private' },
        ],
      }),
    ),
    [{ url: 'https://example.com/source', title: 'Source' }],
  );
  assert.deepEqual(searchSources('A model might guess https://example.com'), []);
});

test('a rejected optional session update does not close the active voice connection', async () => {
  let emit!: (event: VoiceEvent) => void;
  let failures = 0;
  const gateway = createVoiceGateway({
    connect: async (_config, handler) => {
      emit = handler;
      return {
        audio() {},
        result() {},
        async update() {
          throw new Error('update rejected');
        },
        async close() {},
      };
    },
  });
  const live = gateway.connect!(liveConfiguration(), {
    open() {},
    event() {},
    failure() {
      failures++;
    },
  });
  await tick();
  emit({ type: 'connected', id: 'active' });
  live.send({
    type: 'session.instructions.append',
    content: 'Accueil dynamique',
    delegation_id: null,
  });
  await tick();
  assert.equal(failures, 0);
  live.dispose();
});

test('context and provider safeguards survive profile updates while append history stays bounded', async () => {
  const updates: { config: VoiceConfiguration; toolsChanged: boolean | undefined }[] = [];
  const gateway = createVoiceGateway({
    connect: async () => ({
      audio() {},
      result() {},
      close: async () => {},
      update: async (config, toolsChanged) => {
        updates.push({ config, toolsChanged });
      },
    }),
  });
  const live = gateway.connect!(liveConfiguration(), { open() {}, event() {}, failure() {} });
  live.send({
    type: 'session.thinking.append',
    content: 'CAMERA_CONTEXT',
    event_id: 'camera',
    delegation_id: null,
  });
  live.send({
    type: 'session.update',
    session: { delegation: { responses: { instructions: 'PROFILE_CONTEXT', tools: [] } } },
  } as never);
  await tick();
  assert.match(updates[1]!.config.instructions, /CAMERA_CONTEXT/);
  assert.match(updates[1]!.config.instructions, /PROFILE_CONTEXT/);
  assert.match(updates[1]!.config.instructions, /Les outils sont appelés directement par toi/);
  assert.equal(updates[0]!.toolsChanged, false);
  assert.equal(updates[1]!.toolsChanged, true);
  live.send({
    type: 'session.instructions.append',
    content: 'PERSONALITY_RULE',
    delegation_id: null,
  });
  live.send({
    type: 'session.instructions.append',
    content: 'HOME_AUTHORIZATION',
    delegation_id: null,
  });
  await tick();
  const baseLength = updates.at(-1)!.config.instructions.length;
  for (let i = 0; i < 40; i++)
    live.send({
      type: 'session.thinking.append',
      content: String(i) + 'x'.repeat(1000),
      delegation_id: null,
    });
  await tick();
  assert.ok(updates.at(-1)!.config.instructions.length <= baseLength + 16_000);
  assert.match(updates.at(-1)!.config.instructions, /39x/);
  assert.match(updates.at(-1)!.config.instructions, /PERSONALITY_RULE/);
  assert.match(updates.at(-1)!.config.instructions, /HOME_AUTHORIZATION/);
  assert.doesNotMatch(updates.at(-1)!.config.instructions, /CAMERA_CONTEXT/);
  assert.doesNotMatch(updates.at(-1)!.config.instructions, /\nx+/);
  const beforeOversized = updates.at(-1)!.config.instructions;
  live.send({ type: 'session.thinking.append', content: 'z'.repeat(16_001), delegation_id: null });
  await tick();
  assert.equal(updates.at(-1)!.config.instructions, beforeOversized);
  assert.match(updates.at(-1)!.config.instructions, /PROFILE_CONTEXT/);
  live.dispose();
});

for (const cause of ['timeout', 'disconnect', 'explicit', 'close-error'] as const) {
  test('Mistral closes once and releases tools on ' + cause, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const listeners = new Map<string, (event?: any) => void>();
    const events: VoiceEvent[] = [];
    let remoteCloses = 0;
    let init: any;
    const remote = {
      id: 'mock-session',
      on(name: string, callback: (event?: any) => void) {
        listeners.set(name, callback);
      },
      async connect() {},
      async close() {
        remoteCloses++;
        listeners.get('disconnected')?.();
        if (cause === 'close-error') throw new Error('cleanup failed');
      },
      async sendAudio() {},
      async update() {},
    };
    const client = {
      audio: {
        sessions: {
          async init(config: unknown) {
            init = config;
            return remote;
          },
        },
      },
    };
    const adapter = createMistralVoiceAdapter('unused', client as never);
    const connection = await adapter.connect(
      { instructions: 'base', tools: [], webSearch: false },
      (event) => events.push(event),
    );
    assert.equal(init.llm.model, MISTRAL_LLM_MODEL);
    if (cause === 'timeout') t.mock.timers.tick(MISTRAL_MAX_SESSION_MS);
    else if (cause === 'disconnect') listeners.get('disconnected')?.();
    else await connection.close().catch(() => {});
    await tick();
    assert.equal(events.filter((event) => event.type === 'closed').length, 1);
    await connection.close().catch(() => {});
    assert.equal(remoteCloses, 1);
    const count = events.length;
    listeners.get('transcript')?.({ role: 'user', content: 'late', final: true, id: 'late' });
    assert.equal(events.length, count);
  });
}

for (const mode of ['name', 'free', 'off'] as const) {
  test(
    'Mistral welcome respects ' + mode + ' and context updates omit unchanged tools',
    async () => {
      let init: any;
      const updates: any[] = [];
      let greetings = 0;
      const client = {
        chat: {
          async complete(request: any) {
            greetings++;
            assert.match(request.messages[0].content, /personality/);
            return { choices: [{ message: { content: 'Ravi de te voir, Alice !' } }] };
          },
        },
        audio: {
          sessions: {
            async init(config: any) {
              init = config;
              return {
                id: 'welcome',
                on() {},
                async connect() {},
                async close() {},
                async update(value: any) {
                  updates.push(value);
                },
              };
            },
          },
        },
      };
      const adapter = createMistralVoiceAdapter('unused', client as never);
      const configuration: VoiceConfiguration = {
        instructions: 'personality',
        tools: [],
        webSearch: false,
        ...(mode === 'name' ? { welcomeMessage: 'Bonjour Alice.' } : {}),
        ...(mode === 'free' ? { welcomeInstructions: 'Salue Alice librement' } : {}),
      };
      const connection = await adapter.connect(configuration, () => {});
      assert.equal(greetings, mode === 'free' ? 1 : 0);
      assert.equal(
        init.welcomeMessage,
        mode === 'name'
          ? 'Bonjour Alice.'
          : mode === 'free'
            ? 'Ravi de te voir, Alice !'
            : undefined,
      );
      await connection.update(configuration, false);
      assert.equal(Object.hasOwn(updates[0], 'tools'), false);
      await connection.update(configuration, true);
      assert.deepEqual(updates[1].tools, []);
      await connection.close();
    },
  );
}

for (const failure of ['rejection', 'timeout', 'empty'] as const) {
  test('Mistral starts with fallback when optional greeting returns ' + failure, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let init: any;
    const adapter = createMistralVoiceAdapter('unused', {
      chat: {
        complete: async () => {
          if (failure === 'rejection') throw new Error('Quota exhausted');
          if (failure === 'timeout') return new Promise(() => {});
          return { choices: [{ message: { content: ' ' } }] };
        },
      },
      audio: {
        sessions: {
          init: async (config: any) => {
            init = config;
            return { id: 'fallback', on() {}, async connect() {}, async close() {} };
          },
        },
      },
    } as never);
    const connecting = adapter.connect(
      {
        instructions: 'base',
        tools: [],
        webSearch: false,
        welcomeMessage: 'Bonjour Alice.',
        welcomeInstructions: 'Salue Alice librement',
      },
      () => {},
    );
    if (failure === 'timeout') {
      t.mock.timers.tick(2_000);
    }
    const connection = await connecting;
    assert.equal(init.welcomeMessage, 'Bonjour Alice.');
    await connection.close();
  });
}
