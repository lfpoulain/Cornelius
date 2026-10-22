import { DiagnosticLog } from '../server/logs.js';
import assert from 'node:assert/strict';
import { compile } from '../shared/validation.js';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { ConnectClientEvent, ConnectServerEvent } from 'openai/resources/live/sideband';
import type { MediaSessionConfig } from 'openai/resources/live/live';
import { openDatabase, ProfileRepository, SessionPreferences } from '../server/storage.js';
import { SessionController } from '../server/controller.js';
import { LiveTransport } from '../server/live/transport.js';
import type { LiveGateway } from '../server/live/gateway.js';
import { liveConfiguration } from '../server/live/configuration.js';
import type { DelegationMode } from '../shared/delegation.js';
import type { ImageCard } from '../shared/types.js';

function fixture(
  t: TestContext,
  options: {
    mode?: 1 | 2 | 3 | 4;
    delegationMode?: DelegationMode;
    integrations?: ConstructorParameters<typeof LiveTransport>[3];
    voiceRecognition?: boolean;
  } = {},
) {
  const db = openDatabase(':memory:');
  let now = Date.now();
  const profiles = new ProfileRepository(db);
  const sent: ConnectClientEvent[] = [];
  let handlers!: Parameters<LiveGateway['attach']>[1];
  let creates = 0;
  const configs: MediaSessionConfig[] = [];
  const gateway: LiveGateway = {
    async create(config) {
      configs.push(config);
      creates++;
      return { session: { id: 'live_fixture' }, transport: { type: 'webrtc', sdp: 'answer' } };
    },
    attach(_id, value) {
      handlers = value;
      return { send: (event) => sent.push(event), dispose() {} };
    },
  };
  const preferences = new SessionPreferences(db);
  if (options.mode) preferences.setSessionMode(options.mode);
  if (options.delegationMode) preferences.setDelegationMode(options.delegationMode);
  if (options.voiceRecognition) preferences.setVoiceRecognition(true);
  const logs = new DiagnosticLog();
  const live = new LiveTransport(
    gateway,
    () => preferences.getOpenAIBlocked(),
    logs,
    options.integrations,
    () => now,
  );
  const controller = new SessionController(profiles, live, () => now, preferences);
  live.attach(controller);
  t.after(() => {
    live.dispose();
    db.close();
  });
  let sequence = 0;
  function observe(profileId: string | null = null) {
    controller.heartbeat();
    controller.observe({
      schemaVersion: 1,
      producerBootId: 'camera',
      sequence: ++sequence,
      observedAt: now,
      health: 'ok',
      presence: true,
      engaged: true,
      people: [{ trackId: 'person', profileId }],
    });
  }
  observe();
  now += 900;
  observe();
  if (options.mode === 4) {
    controller.setWakeWordAvailability(true, null);
    assert.equal(controller.wakeDetected(), true);
  }
  const scope = controller.scope();
  async function ready() {
    await live.offer(scope, 'offer');
    handlers.open();
    live.started(scope);
    assert.equal(controller.snapshot().state.session.phase, 'ready');
  }
  const emit = (event: unknown) => handlers.event(event as ConnectServerEvent);
  return {
    db,
    logs,
    profiles,
    live,
    controller,
    sent,
    scope,
    ready,
    emit,
    gateway,
    recognize: (profileId: string) => observe(profileId),
    preferences,
    creates: () => creates,
    configs,
    advance(ms: number) {
      now += ms;
      observe();
      controller.tick();
    },
    openControl: () => handlers.open(),
    fail: () => handlers.failure(),
  };
}
test('Hermes Live : résultat tardif écarté après changement de profil, sans annuler la tâche distante', async (t) => {
  let resolve!: (value: import('../shared/addons.js').ToolResult) => void;
  let input: Parameters<import('../server/agents.js').Agents['run']>[0] | undefined;
  let received = 0;
  const f = fixture(t, {
    mode: 1,
    integrations: {
      agents: {
        tools: () => [],
        handles: (name) => name.startsWith('agents__'),
        run: async (value) => {
          input = value;
          return new Promise((done) => {
            resolve = done;
          });
        },
        received: () => {
          received++;
        },
      },
    },
  });
  const alice = f.profiles.create('Alice Hermes'),
    bob = f.profiles.create('Bob Hermes');
  await f.ready();
  f.recognize(alice.id);
  f.emit({
    type: 'response.event',
    delegation_id: 'hermes-delegation',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'hermes-call',
        name: 'agents__start',
        arguments: JSON.stringify({ message: 'Demande Alice' }),
      },
    },
  });
  assert.equal(input?.profileId, alice.id);
  f.controller.command({ type: 'select_profile', profileId: bob.id });
  assert.equal(input?.signal.aborted, true);
  resolve({
    schemaVersion: 1,
    status: 'succeeded',
    result: { taskId: 'private-task', output: 'Private Alice result' },
    snapshotId: null,
    actionRunId: null,
    summary: 'Private Alice result',
    error: null,
  });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(received, 0);
  assert.ok(!JSON.stringify(f.sent).includes('Private Alice result'));
  assert.equal(f.controller.snapshot().state.cards.length, 0);
});

test('Hermes Live : carte réservée à une personne reconnue et découverte actualisée pour Luna', async (t) => {
  const f = fixture(t, {
    mode: 1,
    integrations: {
      agents: {
        tools: () => [
          {
            name: 'agents__start',
            description: 'Agenda disponible',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
        ],
        handles: () => true,
        run: async () => {
          throw new Error('unused');
        },
        received: () => {},
      },
    },
  });
  const alice = f.profiles.create('Alice Hermes'),
    bob = f.profiles.create('Bob Hermes');
  await f.ready();
  f.recognize(alice.id);
  const task: import('../shared/agents.js').AgentTaskView = {
    id: 'task-alice',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'completed',
    persistent: true,
    output: 'Trois idées de sorties.',
    approval: null,
    error: null,
  };
  assert.equal(f.live.deliverAgentTask(bob.id, task), false);
  assert.equal(f.live.deliverAgentTask(alice.id, task), true);
  assert.equal(
    f.controller.snapshot().state.cards[0]?.content.description,
    'Trois idées de sorties.',
  );
  assert.equal(f.live.deliverAgentTask(alice.id, task), false);
  f.live.refreshAgentTools(alice.id);
  const updates = f.sent.filter((e) => e.type === 'session.update');
  assert.match(JSON.stringify(updates.at(-1)), /Agenda disponible/);
  const before = f.sent.length;
  f.live.refreshAgentTools(bob.id);
  assert.equal(f.sent.length, before);
});

test('Hermes Live : un tiers masque la réponse privée mais reçoit un résultat outil explicite', async (t) => {
  let resolve!: (value: import('../shared/addons.js').ToolResult) => void;
  let calls = 0;
  const f = fixture(t, {
    mode: 1,
    integrations: {
      agents: {
        tools: () => [],
        handles: () => true,
        run: async () => {
          calls++;
          return new Promise((done) => {
            resolve = done;
          });
        },
        received: () => {},
      },
    },
  });
  const alice = f.profiles.create('Alice'),
    bob = f.profiles.create('Bob');
  await f.ready();
  f.recognize(alice.id);
  f.emit({
    type: 'response.event',
    delegation_id: 'hermes',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'with-visitor',
        name: 'agents__start',
        arguments: JSON.stringify({ message: 'Demande privée' }),
      },
    },
  });
  assert.equal(calls, 1);
  const stamp = f.controller.snapshot().state.presence.observedAt!;
  f.controller.observe({
    schemaVersion: 1,
    producerBootId: 'camera',
    sequence: 10000,
    observedAt: stamp,
    health: 'ok',
    presence: true,
    engaged: true,
    people: [
      { trackId: 'person', profileId: alice.id },
      { trackId: 'visitor', profileId: bob.id },
    ],
  });
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
  resolve({
    schemaVersion: 1,
    status: 'succeeded',
    result: { output: 'SECRET ALICE' },
    snapshotId: null,
    actionRunId: null,
    summary: 'SECRET ALICE',
    error: null,
  });
  await new Promise((done) => setTimeout(done, 0));
  const outputs = f.sent.filter((e) => e.type === 'response.item.create');
  assert.equal(outputs.length, 1);
  assert.ok(!JSON.stringify(outputs).includes('SECRET ALICE'));
  assert.match(JSON.stringify(outputs), /seule et reconnue/);
});

const closed = {
  type: 'session.closed',
  session: { id: 'live_fixture' },
  reason: 'close_requested',
};

for (const [mode, model, tier, effort, budget] of [
  ['normal', 'gpt-6-luna', 'default', 'none', 512],
  ['fast', 'gpt-6-luna', 'priority', 'none', 512],
  ['ultrafast', 'gpt-6-astra', 'ultrafast', 'low', 4096],
] as const) {
  test(`délégation ${mode} : modèle, vitesse et outils conservés à la création et à l’actualisation`, async (t) => {
    const f = fixture(t, { mode: 1, delegationMode: mode });
    await f.ready();
    const config = f.configs[0]!;
    assert.equal(config.model, 'gpt-live-1');
    if (config.delegation?.type !== 'responses') throw new Error('Délégation absente');
    const backend = config.delegation.responses;
    assert.equal(backend.model, model);
    assert.equal(backend.service_tier, tier);
    assert.equal(backend.reasoning?.effort, effort);
    assert.equal(backend.max_output_tokens, budget);
    assert.ok(backend.tools?.some((tool) => tool.type === 'web_search'));
    assert.ok(
      backend.tools?.some((tool) => tool.type === 'function' && tool.name === 'ui__show_luna_card'),
    );
    const profile = f.profiles.create('Alice');
    f.recognize(profile.id);
    f.live.refreshAgentTools(profile.id);
    const update = f.sent.filter((event) => event.type === 'session.update').at(-1);
    assert.ok(update && update.type === 'session.update');
    if (update.session.delegation?.type !== 'responses') throw new Error('Délégation absente');
    assert.ok(update.session.delegation.responses);
    assert.equal(update.session.delegation.responses.model, model);
    assert.equal(update.session.delegation.responses.service_tier, tier);
  });
}

test('Live ouvre une seule session, limite les droits du navigateur et se libère à la clôture du fournisseur', async (t) => {
  const f = fixture(t);
  const first = f.live.offer(f.scope, 'offer');
  const second = f.live.offer(f.scope, 'offer');
  assert.equal(first, second);
  await first;
  assert.equal(f.creates(), 1);
  assert.equal(f.controller.snapshot().state.session.phase, 'connecting');
  f.openControl();
  f.live.started(f.scope);
  assert.equal(f.controller.snapshot().state.session.microphoneEnabled, true);
  f.controller.command({ type: 'stop' });
  assert.equal(f.sent.at(-1)?.type, 'session.close');
  f.emit(closed);
  f.emit(closed);
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
  const config = liveConfiguration();
  assert.deepEqual(config.client?.data_channel.allowed_client_events, []);
  assert.equal(config.store, false);
  assert.equal(config.delegation?.type, 'responses');
  assert.equal((config.delegation as MediaSessionConfig.Responses).responses.model, 'gpt-6-luna');
  assert.equal(
    (config.delegation as MediaSessionConfig.Responses).responses.service_tier,
    'priority',
  );
});
test('une clôture sans acquittement du fournisseur libère la session et permet une nouvelle', async (t) => {
  const f = fixture(t);
  await f.ready();
  f.controller.command({ type: 'stop' });
  assert.equal(f.sent.at(-1)?.type, 'session.close');
  assert.equal(f.controller.snapshot().state.session.phase, 'closing');
  // The provider never acknowledges: the transport watchdog finalizes the session.
  await new Promise((resolve) => setTimeout(resolve, 5_100));
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
  f.controller.command({ type: 'start' });
  const scope = f.controller.scope();
  assert.equal(f.controller.snapshot().state.session.phase, 'connecting');
  await f.live.offer(scope, 'offer');
  assert.equal(f.creates(), 2);
});
test('les fonctions sont dédupliquées et les résultats tardifs ne traversent pas un changement de profil', async (t) => {
  const f = fixture(t);
  await f.ready();
  const card = {
    schemaVersion: 1,
    cardType: 'luna',
    title: 'Test',
    primaryValue: null,
    subtitle: null,
    description: null,
    items: [],
    sources: [],
  };
  const call = {
    type: 'response.event',
    delegation_id: 'delegation',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'ui__show_luna_card',
        arguments: JSON.stringify(card),
      },
    },
  };
  f.emit(call);
  f.emit(call);
  assert.equal(f.controller.snapshot().state.cards.length, 1);
  assert.equal(f.sent.filter((e) => e.type === 'response.item.create').length, 1);
  const completed = {
    type: 'response.event',
    delegation_id: 'delegation',
    event: {
      type: 'response.completed',
      response: { id: 'response-1', usage: { input_tokens: 100, output_tokens: 10 } },
    },
  };
  f.emit(completed);
  f.emit(completed);
  assert.equal(f.sent.filter((e) => e.type === 'response.create').length, 1);
  const profile = f.profiles.create('Autre personne');
  f.controller.command({ type: 'select_profile', profileId: profile.id });
  f.emit({ ...call, event: { ...call.event, item: { ...call.event.item, call_id: 'late' } } });
  assert.equal(f.controller.snapshot().state.cards.length, 0);
  f.emit(closed);
  assert.equal(f.controller.snapshot().state.session.phase, 'connecting');
});

test('une carte Luna descriptive reçoit une illustration secondaire sans attendre le résultat image', async (t) => {
  let complete!: () => void;
  let prompt = '';
  const f = fixture(t, {
    integrations: {
      imageGeneration: {
        tools: () => [],
        handles: () => false,
        canIllustrateCards: () => true,
        generate: async (_scope, args) => {
          prompt = (args as { prompt: string }).prompt;
          return new Promise((resolve) => {
            complete = () =>
              resolve({
                tool: {
                  schemaVersion: 1,
                  status: 'succeeded',
                  result: null,
                  snapshotId: null,
                  actionRunId: null,
                  summary: 'Image créée.',
                  error: null,
                },
                card: {
                  schemaVersion: 1,
                  cardType: 'image',
                  title: 'Image générée',
                  prompt,
                  imageUrl: '/api/generated-images/11111111-1111-4111-8111-111111111111.webp',
                  model: 'sana-sprint-0.6b',
                  width: 512,
                  height: 512,
                  primaryValue: null,
                  subtitle: null,
                  description: null,
                  items: [],
                  sources: [],
                },
              });
          });
        },
      },
    },
  });
  await f.ready();
  f.emit({
    type: 'response.event',
    delegation_id: 'illustrated-card',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'card-call',
        name: 'ui__show_luna_card',
        arguments: JSON.stringify({
          schemaVersion: 1,
          cardType: 'luna',
          title: 'Les aurores boréales',
          primaryValue: null,
          subtitle: null,
          description: 'Des lumières colorées apparaissent dans le ciel nocturne près des pôles.',
          items: [],
          sources: [],
        }),
      },
    },
  });
  assert.equal(f.controller.snapshot().state.cards.length, 1);
  assert.equal(f.sent.filter((event) => event.type === 'response.item.create').length, 1);
  assert.match(prompt, /aurores boréales/u);
  complete();
  await setImmediate();
  assert.deepEqual(
    f.controller.snapshot().state.cards.map((card) => card.content.cardType),
    ['luna', 'image'],
  );
  assert.equal(f.controller.snapshot().state.cards[1]?.content.title, 'Illustration');
});

test('image__generate affiche sa carte dédiée et renvoie le résultat avant la continuation', async (t) => {
  const f = fixture(t, {
    integrations: {
      imageGeneration: {
        tools: () => [
          {
            name: 'image__generate',
            description: 'Créer une image locale.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['prompt'],
              properties: { prompt: { type: 'string' } },
            },
          },
        ],
        handles: (name) => name === 'image__generate',
        generate: async () => ({
          tool: {
            schemaVersion: 1,
            status: 'succeeded',
            result: { imageUrl: '/api/generated-images/11111111-1111-4111-8111-111111111111.webp' },
            snapshotId: '11111111-1111-4111-8111-111111111111',
            actionRunId: null,
            summary: 'Image créée.',
            error: null,
          },
          card: {
            schemaVersion: 1,
            cardType: 'image',
            title: 'Image générée',
            prompt: 'Un phare dans la brume',
            imageUrl: '/api/generated-images/11111111-1111-4111-8111-111111111111.webp',
            model: 'flux2-klein-4b',
            width: 512,
            height: 512,
            primaryValue: null,
            subtitle: null,
            description: null,
            items: [],
            sources: [],
          },
        }),
      },
    },
  });
  await f.ready();
  f.emit({
    type: 'response.event',
    delegation_id: 'image-delegation',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'image-call',
        name: 'image__generate',
        arguments: JSON.stringify({ prompt: 'Un phare dans la brume' }),
      },
    },
  });
  f.emit({
    type: 'response.event',
    delegation_id: 'image-delegation',
    event: {
      type: 'response.completed',
      response: { id: 'image-response', output: [] },
    },
  });
  await setImmediate();
  await setImmediate();
  const card = f.controller.snapshot().state.cards[0];
  assert.equal(card?.content.cardType, 'image');
  if (card?.content.cardType !== 'image') return;
  assert.equal(card.content.prompt, 'Un phare dans la brume');
  const output = f.sent.find((event) => event.type === 'response.item.create');
  assert.ok(output);
  const parsed = JSON.parse(String((output as { item: { output: string } }).item.output));
  assert.equal(parsed.status, 'succeeded');
  assert.equal(f.sent.filter((event) => event.type === 'response.create').length, 1);
  // Seule la réponse de Luna annonce l’image : aucun commentaire ni consigne en plus.
  assert.equal(f.sent.filter((event) => event.type === 'session.commentary.append').length, 0);
  assert.equal(f.sent.filter((event) => event.type === 'session.instructions.append').length, 0);
});

test('image__recall réaffiche une image gardée sans relancer de génération', async (t) => {
  let generations = 0;
  const recalled: { args: unknown; profileId: string | null }[] = [];
  const card: ImageCard = {
    schemaVersion: 1,
    cardType: 'image',
    title: 'Image générée',
    prompt: 'Un phare dans la brume',
    imageUrl: '/api/generated-images/22222222-2222-4222-8222-222222222222.webp',
    model: 'sdxl-turbo',
    width: 512,
    height: 512,
    primaryValue: null,
    subtitle: null,
    description: null,
    items: [],
    sources: [],
  };
  const f = fixture(t, {
    integrations: {
      imageGeneration: {
        tools: () => [],
        handles: (name) => name === 'image__generate' || name === 'image__recall',
        generate: async () => {
          generations++;
          throw new Error('aucune génération attendue');
        },
        recall: (args, profileId) => {
          recalled.push({ args, profileId });
          return {
            card,
            tool: {
              schemaVersion: 1,
              status: 'succeeded',
              result: { position: 1, prompt: card.prompt },
              snapshotId: '22222222-2222-4222-8222-222222222222',
              actionRunId: null,
              summary: 'L’image a été réaffichée sur le miroir.',
              error: null,
            },
          };
        },
      },
    },
  });
  await f.ready();
  f.emit({
    type: 'response.event',
    delegation_id: 'recall-delegation',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'recall-call',
        name: 'image__recall',
        arguments: JSON.stringify({ position: null, search: 'phare' }),
      },
    },
  });
  await setImmediate();
  assert.equal(generations, 0);
  assert.deepEqual(recalled, [{ args: { position: null, search: 'phare' }, profileId: null }]);
  assert.equal(f.controller.snapshot().state.cards[0]?.content.cardType, 'image');
  assert.ok(f.sent.some((event) => event.type === 'response.item.create'));
  assert.equal(f.sent.filter((event) => event.type === 'session.commentary.append').length, 0);
});
test('un arrêt avant toute création distante clôture sans appel fournisseur', async (t) => {
  const f = fixture(t);
  f.controller.command({ type: 'stop' });
  await Promise.resolve();
  assert.equal(f.creates(), 0);
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
  assert.throws(() => f.live.offer(f.scope, 'late'), /périmée/);
});

test('le prompt d’ouverture ne précharge pas les modules et accepte la vision datée', (t) => {
  fixture(t);
  const config = liveConfiguration();
  const instructions = String((config as { instructions?: string }).instructions);
  assert.match(
    instructions,
    /d’un appel d’outil ou, pour la scène seulement, d’une description caméra datée/u,
  );
  assert.match(instructions, /description des outils/u);
  assert.doesNotMatch(instructions, /contexte contient/u);
  assert.doesNotMatch(instructions, /sans attendre/u);
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /profileName/u);
  assert.doesNotMatch(serialized, /ContextSnapshot/u);
  const delegation = (config.delegation as MediaSessionConfig.Responses).responses;
  assert.match(
    String(delegation.instructions),
    /d’un appel d’outil ou, pour la scène seulement, d’une description caméra datée/u,
  );
  assert.doesNotMatch(String(delegation.instructions), /contexte de référence/iu);
});

test('les schémas d’outils conservent leurs propriétés obligatoires', (t) => {
  fixture(t);
  const config = liveConfiguration();
  const tools = (config.delegation as MediaSessionConfig.Responses).responses.tools!;
  for (const tool of tools) {
    if (tool.type !== 'function') continue;
    assert.equal(tool.name, 'ui__show_luna_card');
    const validate = compile(tool.parameters!);
    const input = {
      schemaVersion: 1,
      cardType: 'luna',
      title: 'Bonjour',
      primaryValue: null,
      subtitle: null,
      description: null,
      items: [],
      sources: [],
    };
    assert.equal(validate(input), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...input, schemaVersion: 2 }), false);
  }
});

test('une création distante terminée après l’arrêt est fermée sans devenir prête', async (t) => {
  const f = fixture(t);
  let resolve!: (value: Awaited<ReturnType<LiveGateway['create']>>) => void;
  f.gateway.create = () =>
    new Promise((done) => {
      resolve = done;
    });
  const offer = f.live.offer(f.scope, 'offer');
  f.controller.command({ type: 'stop' });
  resolve({ session: { id: 'late_remote' }, transport: { type: 'webrtc', sdp: 'answer' } });
  await offer;
  f.openControl();
  assert.equal(f.controller.snapshot().state.session.phase, 'closing');
  assert.equal(f.sent.at(-1)?.type, 'session.close');
  const stopped = f.live.shutdown();
  await Promise.resolve();
  f.emit(closed);
  await stopped;
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
});

test('un refus HTTP explicite ferme la session sans laisser de contrôle ouvert', async (t) => {
  const f = fixture(t);
  f.gateway.create = async () => {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  };
  await assert.rejects(f.live.offer(f.scope, 'offer'), /401/);
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
});

test('le blocage persiste et refuse toute nouvelle offre OpenAI', (t) => {
  const f = fixture(t);
  f.preferences.setOpenAIBlocked(true);
  f.live.block();
  assert.equal(new SessionPreferences(f.db).getOpenAIBlocked(), true);
  assert.match(f.live.unavailableReason()!, /bloquées/);
  assert.throws(() => f.live.offer(f.scope, 'offer'), /bloquées/);
  assert.equal(f.creates(), 0);
  f.preferences.setOpenAIBlocked(false);
  assert.equal(f.live.unavailableReason(), null);
});

test('unavailableReason distingue le blocage administrateur de la clé OpenAI absente', () => {
  const logs = new DiagnosticLog();
  const blocked = new LiveTransport(null, () => true, logs);
  assert.equal(blocked.unavailableReason(), 'Connexions IA bloquées dans l’administration.');
  const missing = new LiveTransport(null, () => false, logs);
  assert.equal(
    missing.unavailableReason(),
    'Ajoutez la clé du fournisseur vocal choisi dans Mise en route → Clés et jetons.',
  );
});

test('le blocage coupe le contrôle actif et le microphone', async (t) => {
  const f = fixture(t);
  let disposed = false;
  const attach = f.gateway.attach;
  f.gateway.attach = (id, handlers) => {
    const connection = attach(id, handlers);
    return {
      ...connection,
      dispose() {
        disposed = true;
      },
    };
  };
  await f.ready();
  f.preferences.setOpenAIBlocked(true);
  f.live.block();
  assert.equal(disposed, true);
  assert.equal(f.controller.snapshot().state.session.microphoneEnabled, false);
  assert.equal(f.controller.snapshot().state.session.phase, 'closing');
});

test('une création en vol est annulée et ne peut ouvrir un contrôle après déblocage', async (t) => {
  const f = fixture(t);
  let resolve!: (value: Awaited<ReturnType<LiveGateway['create']>>) => void;
  let signal: AbortSignal | undefined;
  let attached = false;
  f.gateway.create = (_config, _sdp, incomingSignal) => {
    signal = incomingSignal;
    return new Promise((done) => {
      resolve = done;
    });
  };
  f.gateway.attach = () => {
    attached = true;
    throw new Error('Unexpected attachment');
  };
  const offer = f.live.offer(f.scope, 'offer');
  f.preferences.setOpenAIBlocked(true);
  f.live.block();
  assert.equal(signal?.aborted, true);
  f.preferences.setOpenAIBlocked(false);
  resolve({ session: { id: 'late' }, transport: { type: 'webrtc', sdp: 'answer' } });
  await assert.rejects(offer);
  assert.equal(attached, false);
});

test('Live journalise les erreurs fournisseur sans enregistrer les transcriptions', async (t) => {
  const f = fixture(t);
  await f.ready();
  f.emit({ type: 'session.input_transcript.delta', delta: 'paroles privées' });
  f.emit({
    type: 'error',
    error: {
      code: 'invalid_request',
      message: 'Configuration refusée',
      type: 'invalid_request_error',
    },
  });
  const entries = f.logs.snapshot().entries;
  assert.ok(
    entries.some((entry) => entry.level === 'error' && entry.details.code === 'invalid_request'),
  );
  assert.ok(entries.some((entry) => entry.details.interactionId === f.scope.interactionId));
  assert.ok(!JSON.stringify(entries).includes('paroles privées'));
});

test('deux réponses factuelles successives empilent la carte récente en principale, les doublons ne la restaurent pas', async (t) => {
  const f = fixture(t);
  await f.ready();
  const emitCard = (id: string, value: string) =>
    f.emit({
      type: 'response.event',
      delegation_id: id,
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: id,
          name: 'ui__show_luna_card',
          arguments: JSON.stringify({
            schemaVersion: 1,
            cardType: 'luna',
            title: 'Date',
            primaryValue: value,
            subtitle: null,
            description: null,
            items: [],
            sources: [],
          }),
        },
      },
    });
  emitCard('first', '2026');
  emitCard('second', '2027');
  emitCard('first', '2026');
  const cards = f.controller.snapshot().state.cards;
  assert.equal(cards.length, 2);
  assert.equal(cards[0]!.content.primaryValue, '2027');
  assert.equal(cards[1]!.content.primaryValue, '2026');
  assert.equal(f.sent.filter((event) => event.type === 'response.item.create').length, 2);
});

test('une connexion qui dépasse cinq secondes est arrêtée avec une indication de réessayer', async (t) => {
  const f = fixture(t);
  f.gateway.create = () => new Promise(() => {});
  void f.live.offer(f.scope, 'offer').catch(() => {});
  f.advance(5100);
  assert.equal(f.controller.snapshot().state.session.reason, 'Connexion trop longue. Réessayez.');
});

test('une carte affichée laisse la délégation livrer son résumé, une seule consigne par session', async (t) => {
  const f = fixture(t);
  await f.ready();
  const emitCard = (id: string, value: string) =>
    f.emit({
      type: 'response.event',
      delegation_id: id,
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: id,
          name: 'ui__show_luna_card',
          arguments: JSON.stringify({
            schemaVersion: 1,
            cardType: 'luna',
            title: 'Date',
            primaryValue: value,
            subtitle: null,
            description: null,
            items: [],
            sources: [],
          }),
        },
      },
    });
  emitCard('first', '2026');
  emitCard('second', '2027');
  const appends = f.sent.filter(
    (event): event is Extract<ConnectClientEvent, { type: 'session.instructions.append' }> =>
      event.type === 'session.instructions.append',
  );
  assert.equal(appends.length, 1);
  assert.equal(appends[0]!.delegation_id, null);
  assert.match(appends[0]!.content, /information principale/);
  const comments = f.sent.filter(
    (event): event is Extract<ConnectClientEvent, { type: 'session.commentary.append' }> =>
      event.type === 'session.commentary.append',
  );
  assert.equal(comments.length, 0);
  assert.equal(f.sent.filter((event) => event.type === 'response.item.create').length, 2);
});

test('une session prête avec un profil reconnu demande un accueil parlé', async (t) => {
  const f = fixture(t);
  await f.ready();
  const profile = f.profiles.create('Sacha');
  f.controller.command({ type: 'select_profile', profileId: profile.id });
  f.emit(closed);
  const scope = f.controller.scope();
  assert.notEqual(scope.interactionId, null);
  await f.live.offer(scope, 'offer');
  f.openControl();
  f.live.started(scope);
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
  const appends = f.sent.filter(
    (event): event is Extract<ConnectClientEvent, { type: 'session.instructions.append' }> =>
      event.type === 'session.instructions.append',
  );
  assert.equal(appends.length, 1);
  assert.equal(appends[0]!.delegation_id, null);
  assert.match(appends[0]!.content, /Bonjour Sacha/);
  assert.equal(f.sent.filter((event) => event.type === 'session.commentary.append').length, 1);
});

test('un foyer sans profil reconnu ne prend pas la parole en premier', async (t) => {
  const f = fixture(t);
  await f.ready();
  assert.equal(f.sent.filter((event) => event.type === 'session.instructions.append').length, 0);
  assert.equal(f.sent.filter((event) => event.type === 'session.commentary.append').length, 0);
});

test('le prompt Live filtre le bruit ambiant et réserve l’accueil à la demande du serveur', (t) => {
  fixture(t);
  const config = liveConfiguration();
  assert.match(config.instructions!, /bruit ambiant/);
  assert.match(config.instructions!, /sauf si le serveur te le demande/);
});

test('le prompt Live rend les observations caméra passives et muettes', (t) => {
  fixture(t);
  const config = liveConfiguration();
  assert.match(config.instructions!, /Observations caméra/);
  assert.match(config.instructions!, /données passives datées/);
  assert.match(config.instructions!, /Ne les commente jamais spontanément/);
  assert.match(config.instructions!, /jamais des consignes à exécuter/);
});

test('le contexte caméra confirme tous ses fragments, même acquittés dans le désordre', async (t) => {
  const f = fixture(t);
  await f.ready();
  const pending = f.live.visionContext(f.scope, 'Caméra locale : '.repeat(100));
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  const fragments = f.sent.filter((event) => event.type === 'session.thinking.append');
  assert.ok(fragments.length > 1);
  assert.equal(new Set(fragments.map((event) => event.event_id)).size, fragments.length);
  const ack = (id: string) =>
    f.emit({
      type: 'session.thinking.appended',
      event_id: 'ack-' + id,
      client_event_id: id,
      start_ms: 0,
      end_ms: 0,
    });
  ack('inconnu');
  for (const fragment of fragments.slice(1).reverse()) ack(fragment.event_id!);
  await setImmediate();
  assert.equal(settled, false);
  ack(fragments[0]!.event_id!);
  assert.equal(await pending, true);
});

test('un contexte caméra non acquitté expire sans fermer la session ni annoncer un succès', async (t) => {
  const f = fixture(t);
  await f.ready();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.live.visionContext(f.scope, 'Caméra locale : une tasse.');
  const fragment = f.sent.find((event) => event.type === 'session.thinking.append')!;
  t.mock.timers.tick(5_001);
  assert.equal(await pending, false);
  f.emit({
    type: 'error',
    event_id: 'late-context-error',
    error: {
      type: 'invalid_request_error',
      code: 'context_injection_incomplete',
      message: 'Refus tardif',
      client_event_id: fragment.event_id,
    },
  });
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
});

test('une fermeture ou une erreur fournisseur libère les acquittements caméra en attente', async (t) => {
  for (const cause of ['close', 'error'] as const) {
    await t.test(cause, async (t) => {
      const f = fixture(t);
      await f.ready();
      const pending = f.live.visionContext(f.scope, 'Caméra locale : une tasse.');
      const fragment = f.sent.find((event) => event.type === 'session.thinking.append')!;
      if (cause === 'close') f.emit(closed);
      else
        f.emit({
          type: 'error',
          event_id: 'error',
          error: {
            type: 'invalid_request_error',
            code: 'context_injection_incomplete',
            message: 'Refus',
            client_event_id: fragment.event_id,
          },
        });
      assert.equal(await pending, false);
      if (cause === 'error') assert.equal(f.controller.snapshot().state.session.phase, 'ready');
    });
  }
});

test('un acquittement caméra tardif ne confirme pas le contexte d’un autre profil', async (t) => {
  const f = fixture(t);
  await f.ready();
  const pending = f.live.visionContext(f.scope, 'Caméra locale : une tasse.');
  const fragment = f.sent.find((event) => event.type === 'session.thinking.append')!;
  const scope = f.controller.scope();
  t.mock.method(f.controller, 'scope', () => ({ ...scope, profileEpoch: scope.profileEpoch + 1 }));
  f.emit({
    type: 'session.thinking.appended',
    event_id: 'ack',
    client_event_id: fragment.event_id,
    start_ms: 0,
    end_ms: 0,
  });
  assert.equal(await pending, false);
});

test('la limite de 32 outils porte sur une délégation et permet une longue conversation', async (t) => {
  const f = fixture(t);
  await f.ready();
  const tool = (delegationId: string, index: number) =>
    f.emit({
      type: 'response.event',
      delegation_id: delegationId,
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: delegationId + '-' + index,
          name: 'unknown',
          arguments: '{}',
        },
      },
    });
  for (let index = 0; index < 40; index++) tool('question-' + index, index);
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
  for (let index = 0; index < 33; index++) tool('boucle', index);
  assert.equal(f.controller.snapshot().state.session.phase, 'closing');
});

test('les préférences longues sont fragmentées sans dépasser la limite d’append Live', async (t) => {
  const preference = 'Réponds avec calme. 東京. '.repeat(40);
  const f = fixture(t, {
    mode: 1,
    integrations: { personality: (id) => ({ household: '', personal: id ? preference : '' }) },
  });
  await f.ready();
  const profile = f.profiles.create('Alice');
  f.recognize(profile.id);
  f.live.identify(f.scope);
  const fragments = f.sent.filter((event) => event.type === 'session.instructions.append');
  assert.ok(fragments.length > 1);
  assert.ok(fragments.every((event) => Buffer.byteLength(event.content, 'utf8') <= 400));
  const restored = fragments
    .map((event) => event.content.replace(/^Suite des mêmes instructions : /, ''))
    .join('');
  assert.ok(restored.includes(preference));
});

test('chaque réponse déléguée attend ses propres outils et sa propre fin avant continuation', async (t) => {
  const f = fixture(t);
  await f.ready();
  const emit = (event: unknown) => f.emit({ type: 'response.event', delegation_id: 'same', event });
  const begin = (id: string) => emit({ type: 'response.created', response: { id } });
  const done = (id: string) => emit({ type: 'response.completed', response: { id } });
  const tool = (id: string) =>
    emit({
      type: 'response.output_item.done',
      response_id: id,
      item: { type: 'function_call', call_id: id, name: 'unknown', arguments: '{}' },
    });
  const continuations = () => f.sent.filter((event) => event.type === 'response.create').length;
  begin('first');
  tool('first');
  done('first');
  assert.equal(continuations(), 1);
  done('first');
  begin('second');
  tool('second');
  assert.equal(continuations(), 1);
  done('second');
  assert.equal(continuations(), 2);
  begin('answer-without-tool');
  done('answer-without-tool');
  begin('next-question');
  tool('next-question');
  done('answer-without-tool');
  assert.equal(continuations(), 2);
  done('next-question');
  assert.equal(continuations(), 3);
});

for (const when of ['connecting', 'ready'] as const) {
  test(
    'la reconnaissance en phase ' + when + ' actualise les outils sans injecter de catalogue',
    async (t) => {
      const f = fixture(t, {
        mode: 1,
        integrations: {
          actions: {
            tools: (profileId) => [
              {
                name: 'http__send',
                description: profileId
                  ? 'Commande autorisée : portail-prive'
                  : 'Aucune commande autorisée.',
                parameters: {
                  type: 'object',
                  properties: {},
                  required: [],
                  additionalProperties: false,
                },
              },
            ],
            handles: () => false,
            run: async () => {
              throw new Error('Unexpected action');
            },
          },
        },
      });
      const profile = f.profiles.create('Sacha');
      await f.live.offer(f.scope, 'offer');
      if (when === 'ready') {
        f.openControl();
        f.live.started(f.scope);
      }
      f.recognize(profile.id);
      if (when === 'connecting') {
        assert.equal(f.sent.length, 0);
        f.openControl();
        f.live.started(f.scope);
      }
      assert.equal(f.controller.scope().interactionId, f.scope.interactionId);
      f.live.identify(f.scope);
      const updates = f.sent.filter((event) => event.type === 'session.update');
      assert.equal(updates.length, 1);
      assert.match(JSON.stringify(updates[0]), /portail-prive/);
      assert.match(JSON.stringify(updates[0]), /web_search/);
      const instructions = f.sent.filter((event) => event.type === 'session.instructions.append');
      assert.equal(instructions.length, 1);
      assert.match(JSON.stringify(instructions), /Bonjour Sacha/);
      assert.doesNotMatch(
        JSON.stringify(instructions),
        /portail-prive|Sources autorisées|Commandes autorisées/,
      );
    },
  );
}

for (const result of ['resolve', 'reject'] as const) {
  test(
    'une ancienne création qui se termine par ' + result + ' ne ferme pas la nouvelle session',
    async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const f = fixture(t);
      const create = f.gateway.create;
      const hungUp: string[] = [];
      f.gateway.hangup = async (id) => {
        hungUp.push(id);
      };
      let finish!: () => void;
      f.gateway.create = () =>
        new Promise((resolve, reject) => {
          finish = () =>
            result === 'resolve'
              ? resolve({
                  session: { id: 'obsolete' },
                  transport: { type: 'webrtc', sdp: 'obsolete' },
                })
              : reject(new Error('Ancienne panne réseau'));
        });
      const obsolete = f.live.offer(f.scope, 'obsolete');
      f.controller.command({ type: 'stop' });
      t.mock.timers.tick(5000);
      assert.equal(f.controller.snapshot().state.session.phase, 'idle');
      f.controller.command({ type: 'start' });
      f.gateway.create = create;
      const next = f.controller.scope();
      await f.live.offer(next, 'next');
      f.openControl();
      f.live.started(next);
      finish();
      await assert.rejects(obsolete, /périmée/);
      assert.deepEqual(hungUp, result === 'resolve' ? ['obsolete'] : []);
      assert.equal(f.controller.snapshot().state.session.phase, 'ready');
      assert.deepEqual(f.controller.scope(), next);
    },
  );
}

test('le watchdog du contrôleur peut libérer une clôture avant celui du transport', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  const connections: Parameters<LiveGateway['attach']>[1][] = [];
  const attach = f.gateway.attach;
  f.gateway.attach = (id, handlers) => {
    connections.push(handlers);
    return attach(id, handlers);
  };
  await f.ready();
  f.controller.command({ type: 'stop' });
  f.advance(5100);
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
  f.controller.command({ type: 'start' });
  const next = f.controller.scope();
  assert.equal(f.controller.snapshot().state.session.phase, 'connecting');
  await f.live.offer(next, 'next');
  f.openControl();
  f.live.started(next);
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
  connections[0]!.failure();
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
  f.controller.command({ type: 'stop' });
  connections[0]!.event(closed as ConnectServerEvent);
  assert.equal(f.controller.snapshot().state.session.phase, 'closing');
  t.mock.timers.tick(5000);
  assert.equal(f.controller.snapshot().state.session.phase, 'idle');
});

test('la session reçoit le foyer puis les préférences personnelles à la reconnaissance', async (t) => {
  const f = fixture(t, {
    mode: 1,
    integrations: {
      personality: (id) => ({ household: 'Humour léger', personal: id ? 'Vouvoie-moi' : '' }),
    },
  });
  const alice = f.profiles.create('Alice');
  let initial: MediaSessionConfig | undefined;
  f.gateway.create = async (config) => {
    initial = config;
    return { session: { id: 'live_fixture' }, transport: { type: 'webrtc', sdp: 'answer' } };
  };
  await f.ready();
  assert.match(initial!.instructions!, /Humour léger/);
  assert.doesNotMatch(initial!.instructions!, /Vouvoie-moi/);
  f.recognize(alice.id);
  f.live.identify(f.scope);
  const instructions = f.sent.filter((event) => event.type === 'session.instructions.append');
  assert.equal(instructions.filter((event) => event.content.includes('Vouvoie-moi')).length, 1);
  const update = f.sent.find((event) => event.type === 'session.update');
  assert.ok(update);
  assert.match(JSON.stringify(update), /Vouvoie-moi/);
});

test('un contexte personnel seul arrive après reconnaissance et reste absent en session anonyme', async (t) => {
  let activeId = '';
  const f = fixture(t, {
    mode: 1,
    integrations: {
      personality: (id) => ({
        household: '',
        personal: '',
        personalContext: id === activeId ? 'Mon bureau est Pivoine.' : '',
      }),
    },
  });
  activeId = f.profiles.create('Sacha').id;
  let initial: MediaSessionConfig | undefined;
  f.gateway.create = async (config) => {
    initial = config;
    return { session: { id: 'live_fixture' }, transport: { type: 'webrtc', sdp: 'answer' } };
  };
  await f.ready();
  assert.doesNotMatch(JSON.stringify(initial), /Pivoine/);
  f.recognize(activeId);
  f.live.identify(f.scope);
  const updates = f.sent.filter((event) => event.type === 'session.update');
  assert.match(JSON.stringify(updates), /Pivoine/);
  const appends = f.sent.filter((event) => event.type === 'session.instructions.append');
  assert.equal(appends.filter((event) => event.content.includes('Pivoine')).length, 1);
  f.live.identify(f.scope);
  assert.equal(
    f.sent.filter(
      (event) => event.type === 'session.instructions.append' && event.content.includes('Pivoine'),
    ).length,
    1,
  );
});

for (const timing of ['before-card', 'after-card'] as const) {
  test('les citations web natives restent liées à leur délégation : ' + timing, async (t) => {
    const f = fixture(t);
    await f.ready();
    const config = liveConfiguration();
    assert.equal(config.delegation?.type, 'responses');
    if (config.delegation?.type !== 'responses') throw new Error('Missing delegation');
    assert.deepEqual(
      config.delegation.responses.tools?.find((tool) => tool.type === 'web_search'),
      {
        type: 'web_search',
      },
    );
    const emit = (id: string, event: unknown) =>
      f.emit({ type: 'response.event', delegation_id: id, event });
    const citation = (url: string, title = 'Source officielle') => ({
      type: 'url_citation',
      url,
      title,
    });
    const message = {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: 'Résultat vérifié.',
          annotations: [
            citation('https://example.org/article'),
            citation('https://example.org/article'),
            citation('javascript:alert(1)'),
            citation('https://user:password@example.org/private'),
            citation('not-a-url'),
          ],
        },
      ],
    };
    const card = (id: string) =>
      emit(id, {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: id,
          name: 'ui__show_luna_card',
          arguments: JSON.stringify({
            schemaVersion: 1,
            cardType: 'luna',
            title: id,
            primaryValue: null,
            subtitle: null,
            description: 'Résultat vérifié.',
            items: [],
            sources: [],
          }),
        },
      });
    emit('web', { type: 'response.created', response: { id: 'search-response' } });
    emit('web', {
      type: 'response.output_item.done',
      item: { type: 'web_search_call', id: 'ws-1', status: 'completed' },
    });
    // Hosted search is executed by OpenAI; no local function result or continuation is sent.
    assert.equal(f.sent.filter((event) => event.type === 'response.item.create').length, 0);
    if (timing === 'before-card') emit('web', { type: 'response.output_item.done', item: message });
    card('web');
    emit('web', { type: 'response.completed', response: { id: 'search-response' } });
    assert.equal(f.sent.filter((event) => event.type === 'response.create').length, 1);
    card('other-question');
    emit('web', { type: 'response.created', response: { id: 'summary-response' } });
    // Citations can arrive with the final summary, after the card and a new Responses ID.
    emit('web', {
      type: 'response.completed',
      response: { id: 'summary-response', output: [message] },
    });
    const cards = f.controller.snapshot().state.cards;
    assert.deepEqual(cards.find((entry) => entry.content.title === 'other-question')!.sources, []);
    assert.deepEqual(cards.find((entry) => entry.content.title === 'web')!.sources, [
      {
        id: 'https://example.org/article',
        url: 'https://example.org/article',
        title: 'Source officielle',
      },
    ]);
    // A subsequent profile must never receive a late source from the old conversation.
    const profile = f.profiles.create('Autre personne');
    f.controller.command({ type: 'select_profile', profileId: profile.id });
    emit('web', { type: 'response.output_item.done', item: message });
    assert.equal(f.controller.snapshot().state.cards.length, 0);
  });
}

test('la recherche web active le halo jusqu’à sa fin', async (t) => {
  const f = fixture(t);
  await f.ready();
  const emit = (event: unknown) => f.emit({ type: 'response.event', delegation_id: 'web', event });

  emit({
    type: 'response.web_search_call.in_progress',
    item_id: 'ws-1',
    output_index: 0,
    sequence_number: 1,
  });
  assert.equal(f.controller.snapshot().state.webSearchActive, true);

  emit({
    type: 'response.web_search_call.completed',
    item_id: 'ws-1',
    output_index: 0,
    sequence_number: 2,
  });
  assert.equal(f.controller.snapshot().state.webSearchActive, false);
});

test('mode voix : le silence des trames Live ne prolonge pas la session après la réponse', async (t) => {
  const f = fixture(t, { mode: 4 });
  await f.ready();
  f.controller.setSilenceClose({ enabled: false, delayMs: 3000 });
  f.controller.setUserSpeech(f.scope, true);
  f.advance(200);
  f.controller.setUserSpeech(f.scope, false);

  const audible = Buffer.alloc(9600);
  for (let offset = 0; offset < audible.length; offset += 2) audible.writeInt16LE(1200, offset);
  f.emit({ type: 'session.output_audio.delta', delta: audible.toString('base64') });
  f.emit({
    type: 'session.output_transcript.delta',
    delta: 'Réponse.',
    event_id: 'assistant-output',
    start_ms: 0,
    end_ms: 200,
  });
  const silence = Buffer.alloc(9600).toString('base64');
  for (let i = 0; i < 5; i++) {
    f.emit({ type: 'session.output_audio.delta', delta: silence });
    f.advance(500);
  }
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
  f.emit({ type: 'session.output_audio.delta', delta: silence });
  f.advance(500);
  assert.equal(f.controller.snapshot().state.session.phase, 'closing');
  assert.ok(f.sent.some((event) => event.type === 'session.close'));
});

test('la session est prête dès le média connecté et le démarrage confirmé sur le contrôle', async (t) => {
  const f = fixture(t);
  await f.live.offer(f.scope, 'offer');
  f.openControl();
  f.emit({ type: 'session.started' });
  assert.equal(f.controller.snapshot().state.session.phase, 'connecting');
  f.live.mediaConnected(f.scope);
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
  // Le `session.started` tardif du canal de données reste accepté, sans effet.
  f.live.started(f.scope);
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');

  const other = fixture(t);
  await other.live.offer(other.scope, 'offer');
  other.openControl();
  other.live.mediaConnected(other.scope);
  assert.equal(other.controller.snapshot().state.session.phase, 'connecting');
  other.live.started(other.scope);
  assert.equal(other.controller.snapshot().state.session.phase, 'ready');
});

test('les trames audio du canal de contrôle ne sont jamais journalisées', async (t) => {
  const f = fixture(t);
  await f.ready();
  const before = f.logs.snapshot().entries.length;
  for (let i = 0; i < 20; i++) {
    f.emit({ type: 'session.output_audio.delta', delta: Buffer.alloc(64).toString('base64') });
    f.emit({ type: 'session.input_audio.append', audio: Buffer.alloc(64).toString('base64') });
  }
  assert.equal(f.logs.snapshot().entries.length, before);
});

test('le préchauffage OpenAI est limité et jamais lancé pendant une session ou un blocage', async (t) => {
  let warmed = 0;
  const f = fixture(t);
  const gateway = f.gateway as LiveGateway;
  gateway.prewarm = async () => {
    warmed++;
  };
  f.live.prewarm();
  assert.equal(warmed, 0, 'session déjà ouverte par la fixture');
  await f.ready();
  f.controller.close('Test.');
  f.emit({ type: 'session.closed' });
  f.live.prewarm();
  f.live.prewarm();
  assert.equal(warmed, 1);
  f.advance(3000);
  f.live.prewarm();
  assert.equal(warmed, 2);
  f.preferences.setOpenAIBlocked(true);
  f.advance(3000);
  f.live.prewarm();
  assert.equal(warmed, 2);
});

test('accueil réglable : phrase imposée, accueil libre selon la personnalité, ou silence', async (t) => {
  for (const [mode, expected] of [
    ['name', /dis exactement « Bonjour Sacha\. »/],
    ['free', /salue Sacha en une courte phrase, à ta manière/],
    ['off', null],
  ] as const) {
    const f = fixture(t);
    f.controller.setGreetingMode(mode);
    await f.ready();
    const profile = f.profiles.create('Sacha');
    f.controller.command({ type: 'select_profile', profileId: profile.id });
    f.emit(closed);
    const scope = f.controller.scope();
    assert.notEqual(scope.interactionId, null, mode);
    await f.live.offer(scope, 'offer');
    f.openControl();
    f.live.started(scope);
    const greetings = f.sent.filter(
      (event): event is Extract<ConnectClientEvent, { type: 'session.instructions.append' }> =>
        event.type === 'session.instructions.append' && event.content.startsWith('Accueil'),
    );
    const comments = f.sent.filter((event) => event.type === 'session.commentary.append');
    if (expected === null) {
      assert.equal(greetings.length, 0, mode);
      assert.equal(comments.length, 0, mode);
    } else {
      assert.equal(greetings.length, 1, mode);
      assert.match(greetings[0]!.content, expected);
      assert.equal(comments.length, 1, mode);
    }
  }
});

test('module Web désactivé : ni outil web_search ni consigne de recherche web', () => {
  const enabled = liveConfiguration();
  const disabled = liveConfiguration([], undefined, undefined, { webSearch: false });
  if (enabled.delegation?.type !== 'responses' || disabled.delegation?.type !== 'responses')
    throw new Error('Délégation attendue.');
  assert.ok(enabled.delegation.responses.tools?.some((tool) => tool.type === 'web_search'));
  assert.ok(!disabled.delegation.responses.tools?.some((tool) => tool.type === 'web_search'));
  assert.doesNotMatch(disabled.instructions!, /web_search/);
  assert.doesNotMatch(disabled.delegation.responses.instructions!, /utilise web_search/);
  assert.match(disabled.instructions!, /Recherche web désactivée/);
  assert.match(disabled.delegation.responses.instructions!, /recherche web est désactivée/);
  // Le texte habituel reste identique quand la recherche est active.
  assert.match(enabled.instructions!, /rechercher des informations publiques sur le web/);
});

test('une carte Luna qui redit la carte d’un module est écartée, quel que soit l’ordre', async (t) => {
  const moduleCard = {
    schemaVersion: 1 as const,
    cardType: 'module' as const,
    addonId: 'transit',
    instanceRef: 'travail',
    title: 'Mes bus',
    primaryValue: '3 min',
    subtitle: 'Ligne 72 → Gare de Lyon (Paris)',
    description: null,
    items: [
      { label: 'Prochain', value: '3 min · 16:02' },
      { label: 'Suivant', value: '49 min · 16:49' },
    ],
    sources: ['transit'],
    snapshotId: 'transit:travail:r1',
    stale: false,
  };
  const addons: NonNullable<ConstructorParameters<typeof LiveTransport>[3]>['addons'] = {
    tools: () => [],
    parseTool: (name) =>
      name === 'transit__read' ? { addonId: 'transit', toolName: 'read' } : null,
    invoke: async () => ({
      outcome: { ok: true, card: moduleCard } as never,
      tool: {
        schemaVersion: 1,
        status: 'succeeded',
        result: null,
        snapshotId: moduleCard.snapshotId,
        actionRunId: null,
        summary: 'Prochain bus 72 dans 3 minutes.',
        error: null,
      },
    }),
    sourceLabel: () => 'Île-de-France Mobilités',
    sourcesFor: () => [],
  };
  const lunaBus = {
    schemaVersion: 1,
    cardType: 'luna',
    title: 'Prochains bus 72',
    primaryValue: '3 min',
    subtitle: 'Direction Gare de Lyon',
    description: null,
    items: [
      { label: 'Prochain', value: '16:02' },
      { label: 'Suivant', value: '16:49' },
    ],
    sources: [],
  };
  const call = (
    f: ReturnType<typeof fixture>,
    delegation: string,
    id: string,
    name: string,
    args: unknown,
  ) =>
    f.emit({
      type: 'response.event',
      delegation_id: delegation,
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) },
      },
    });
  const outputs = (f: ReturnType<typeof fixture>) =>
    f.sent
      .filter((event) => event.type === 'response.item.create')
      .map((event) => JSON.parse((event as { item: { output: string } }).item.output));

  // Le module d’abord : la carte Luna identique n’est pas empilée.
  const first = fixture(t, { integrations: { addons } });
  await first.ready();
  call(first, 'bus', 'module', 'transit__read', { instanceRef: 'travail' });
  await setImmediate();
  call(first, 'bus', 'luna', 'ui__show_luna_card', lunaBus);
  let cards = first.controller.snapshot().state.cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.content.cardType, 'module');
  assert.deepEqual(outputs(first).at(-1), {
    accepted: true,
    duplicate: true,
    note: 'La carte du module affiche déjà ce résultat ; aucune seconde carte.',
  });
  // Une information différente dans la même demande reste affichée.
  call(first, 'bus', 'other', 'ui__show_luna_card', {
    ...lunaBus,
    title: 'Capitale du Pérou',
    primaryValue: 'Lima',
    subtitle: null,
    items: [],
  });
  assert.equal(first.controller.snapshot().state.cards.length, 2);

  // La carte Luna d’abord : la carte du module la remplace.
  const second = fixture(t, { integrations: { addons } });
  await second.ready();
  call(second, 'bus-2', 'luna-2', 'ui__show_luna_card', lunaBus);
  assert.equal(second.controller.snapshot().state.cards.length, 1);
  call(second, 'bus-2', 'module-2', 'transit__read', { instanceRef: 'travail' });
  await setImmediate();
  cards = second.controller.snapshot().state.cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.content.cardType, 'module');
});

test('Home Assistant réservé : absent de la session anonyme, ajouté à la reconnaissance', async (t) => {
  const recognizedCalls: boolean[] = [];
  const homeAssistant = {
    tools: (recognized = true) =>
      recognized
        ? [
            {
              name: 'home_assistant__control',
              description: 'Lumières autorisées',
              parameters: { type: 'object', additionalProperties: false, properties: {} },
            },
          ]
        : [],
    handles: (name: string) => name === 'home_assistant__control',
    run: async (_args: unknown, _signal: AbortSignal, _name?: string, recognized = true) => {
      recognizedCalls.push(recognized);
      return {
        schemaVersion: 1 as const,
        status: 'failed' as const,
        result: null,
        snapshotId: null,
        actionRunId: null,
        summary: 'Réservé.',
        error: { code: 'forbidden', message: 'Réservé.', retryable: false },
      };
    },
  };
  const f = fixture(t, { mode: 1, integrations: { homeAssistant } });
  await f.ready();
  const created = f.configs[0]!;
  const delegation = created.delegation as MediaSessionConfig.Responses;
  assert.ok(!JSON.stringify(delegation.responses.tools).includes('home_assistant__control'));
  assert.ok(!(delegation.responses.instructions ?? '').includes('home_assistant__control'));
  assert.ok(!(created.instructions ?? '').includes('allume le salon'));

  f.emit({
    type: 'response.event',
    delegation_id: 'maison',
    event: {
      type: 'response.output_item.done',
      response_id: 'r1',
      item: {
        type: 'function_call',
        call_id: 'c1',
        name: 'home_assistant__control',
        arguments: '{}',
      },
    },
  });
  await setImmediate();
  assert.deepEqual(recognizedCalls, [false]);

  const profile = f.profiles.create('Alice');
  f.recognize(profile.id);
  const update = f.sent.find((event) => event.type === 'session.update');
  assert.ok(update && JSON.stringify(update).includes('"name":"home_assistant__control"'));
  assert.ok(
    f.sent.some(
      (event) =>
        event.type === 'session.instructions.append' && event.content.includes('allume le salon'),
    ),
  );
});

test('mode voix : le prénom reconnu au mot d’appel devient un contexte, sans salutation', async (t) => {
  const f = fixture(t, {
    mode: 4,
    voiceRecognition: true,
    integrations: { personality: () => ({ household: '', personal: '', personalContext: '' }) },
  });
  await f.ready();
  const profile = f.profiles.create('Alice');
  f.recognize(profile.id);
  assert.equal(f.controller.snapshot().state.activeProfile?.id, profile.id);
  assert.ok(f.sent.some((event) => event.type === 'session.update'));
  const appends = f.sent.filter((event) => event.type === 'session.instructions.append');
  assert.ok(appends.some((event) => event.content.includes('"Alice"')));
  assert.ok(!appends.some((event) => event.content.includes('Bonjour')));
  assert.ok(!f.sent.some((event) => event.type === 'session.commentary.append'));
  assert.equal(f.controller.snapshot().state.session.phase, 'ready');
});
