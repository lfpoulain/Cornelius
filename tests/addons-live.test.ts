import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import type { ConnectClientEvent, ConnectServerEvent } from 'openai/resources/live/sideband';
import type { AddonHttpClient } from '../shared/addons.js';
import { DiagnosticLog } from '../server/logs.js';
import {
  ActionRepository,
  AddonRepository,
  openDatabase,
  ProfileRepository,
  SessionPreferences,
} from '../server/storage.js';
import { SessionController } from '../server/controller.js';
import { LiveTransport } from '../server/live/transport.js';
import type { LiveGateway } from '../server/live/gateway.js';
import { AddonRuntime } from '../server/addons/runtime.js';
import { loadAddons } from '../server/addons/registry.js';
import { ActionExecutor } from '../server/actions.js';
import departuresFixture from '../addons/transit/fixtures/departures.json' with { type: 'json' };

const transitBody = JSON.stringify(departuresFixture);

/** Les modules sont découverts comme en production : aucun registre écrit à la main. */
// Modules livrés seulement : un dépôt cornelius-modules cloné à côté ne change pas ces tests.
const addonRegistry = (await loadAddons({ externalRoot: null })).addons;

function stubHttp() {
  let handler: () => Promise<{ status: number; body: string }> = async () => ({
    status: 200,
    body: transitBody,
  });
  const calls: string[] = [];
  const client: AddonHttpClient = {
    async fetch(request) {
      calls.push(request.url);
      const response = await handler();
      return {
        status: response.status,
        headers: {},
        text: () => response.body,
        json: () => JSON.parse(response.body) as unknown,
        bytes: () => new Uint8Array(0),
      };
    },
  };
  return {
    calls,
    client,
    respond: (next: { status: number; body: string }) => {
      handler = async () => next;
    },
    defer: () => {
      let release!: () => void;
      handler = () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 200, body: transitBody });
        });
      return () => release();
    },
  };
}

async function settle(times = 4) {
  for (let index = 0; index < times; index++) await setImmediate();
}

function fixture(
  t: TestContext,
  homeAssistant?: Pick<
    import('../server/home-assistant.js').HomeAssistant,
    'tools' | 'handles' | 'run'
  >,
) {
  const db = openDatabase(':memory:');
  let now = Date.parse('2026-09-18T09:05:00Z');
  const profiles = new ProfileRepository(db);
  const instances = new AddonRepository(db);
  const actionRepository = new ActionRepository(db);
  const http = stubHttp();
  const runtime = new AddonRuntime({
    addons: addonRegistry,
    instances,
    http: http.client,
    now: () => now,
    secrets: { primApiKey: 'cle-test', meteoConceptToken: 'jeton-test' },
  });
  const executor = new ActionExecutor(actionRepository, http.client, undefined, () => now);
  const sent: ConnectClientEvent[] = [];
  let handlers!: Parameters<LiveGateway['attach']>[1];
  const gateway: LiveGateway = {
    async create() {
      return { session: { id: 'live_addons' }, transport: { type: 'webrtc', sdp: 'answer' } };
    },
    attach(_id, value) {
      handlers = value;
      return { send: (event) => sent.push(event), dispose() {} };
    },
  };
  const preferences = new SessionPreferences(db);
  const live = new LiveTransport(
    gateway,
    () => preferences.getOpenAIBlocked(),
    new DiagnosticLog(),
    {
      addons: runtime,
      actions: executor,
      homeAssistant,
    },
  );
  const controller = new SessionController(profiles, live, () => now, undefined);
  live.attach(controller);
  t.after(() => {
    live.dispose();
    db.close();
  });
  let sequence = 0;
  function observe() {
    controller.heartbeat();
    controller.observe({
      schemaVersion: 1,
      producerBootId: 'camera',
      sequence: ++sequence,
      observedAt: now,
      health: 'ok',
      presence: true,
      engaged: true,
      people: [{ trackId: 'person', profileId: null }],
    });
  }
  observe();
  now += 900;
  observe();
  const scope = controller.scope();
  async function ready() {
    await live.offer(scope, 'offer');
    handlers.open();
    live.started(scope);
    assert.equal(controller.snapshot().state.session.phase, 'ready');
  }
  const emit = (event: unknown) => handlers.event(event as ConnectServerEvent);
  const call = (callId: string, name: string, args: unknown) => ({
    type: 'response.event',
    delegation_id: 'delegation',
    event: {
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) },
    },
  });
  const completed = {
    type: 'response.event',
    delegation_id: 'delegation',
    event: {
      type: 'response.completed',
      response: { id: 'response-1', usage: { input_tokens: 10, output_tokens: 2 } },
    },
  };
  const outputs = () =>
    sent
      .filter((event) => event.type === 'response.item.create')
      .map(
        (event) =>
          JSON.parse(String((event as { item: { output: string } }).item.output)) as Record<
            string,
            unknown
          >,
      );
  return {
    db,
    instances,
    actionRepository,
    runtime,
    executor,
    http,
    live,
    controller,
    sent,
    scope,
    ready,
    emit,
    call,
    completed,
    outputs,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

test('un outil de module affiche la carte spécialisée, renvoie le résultat et n’avance qu’après la réponse', async (t) => {
  const f = fixture(t);
  await f.ready();
  f.instances.createInstance({
    addonId: 'transit',
    profileId: null,
    ref: 'maison',
    label: 'Bus maison',
    config: {
      stopAreaId: 'stop_area:IDFM:71264',
      stopAreaLabel: 'Hôtel de Ville (Paris)',
      routeId: null,
      routeLabel: null,
    },
    configVersion: 1,
  });
  const release = f.http.defer();
  f.emit(f.call('call-transit', 'transit__read', { instanceRef: 'maison' }));
  f.emit(f.completed);
  await settle();
  // La réponse déléguée s'est terminée avant l'outil : aucune relance prématurée.
  assert.equal(f.sent.filter((event) => event.type === 'response.create').length, 0);
  release();
  await settle();
  const cards = f.controller.snapshot().state.cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.content.cardType, 'module');
  if (cards[0]!.content.cardType !== 'module') return;
  assert.equal(cards[0]!.content.addonId, 'transit');
  assert.equal(cards[0]!.content.title, 'Mes bus');
  assert.equal(cards[0]!.content.primaryValue, '2 min');
  assert.equal(cards[0]!.sources[0]?.title, 'Île-de-France Mobilités');
  const outputs = f.outputs();
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]!.status, 'succeeded');
  assert.equal(outputs[0]!.snapshotId, cards[0]!.content.snapshotId);
  assert.equal(f.sent.filter((event) => event.type === 'response.create').length, 1);
});

test('une action en attente de confirmation ne dessine aucune carte et n’envoie rien avant accord', async (t) => {
  const f = fixture(t);
  await f.ready();
  f.actionRepository.createAction({
    ref: 'portail',
    label: 'Portail',
    method: 'POST',
    url: 'https://maison.example/portail',
    profileId: null,
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    confirmation: 'required',
  });
  f.emit(f.call('call-http-1', 'http__send', { actionRef: 'portail', confirmationId: null }));
  await settle();
  assert.equal(f.controller.snapshot().state.cards.length, 0);
  assert.equal(f.http.calls.length, 0);
  const pending = f.outputs()[0]!;
  assert.equal(pending.status, 'pending_confirmation');
  const confirmationId = (pending.result as { confirmationId: string }).confirmationId;
  assert.ok(confirmationId);
  // Validation par le canal authentifié (administration), jamais par le modèle.
  assert.equal(f.actionRepository.approveConfirmation(confirmationId, f.at()), true);
  f.emit(f.call('call-http-2', 'http__send', { actionRef: 'portail', confirmationId }));
  await settle();
  assert.equal(f.http.calls.length, 1);
  const executed = f.outputs()[1]!;
  assert.equal(executed.status, 'succeeded');
  const item = f.sent.find((event) => event.type === 'response.item.create');
  assert.ok(item);
});

test('Home Assistant passe par le pont natif, attend le résultat et ignore le rejeu du même appel Live', async (t) => {
  let calls = 0;
  let release!: () => void;
  let observedArgs: unknown;
  let observedSignal: AbortSignal | undefined;
  const f = fixture(t, {
    tools: () => [
      {
        name: 'home_assistant__control',
        description: 'Appareils autorisés',
        parameters: { type: 'object', properties: {} },
      },
    ],
    handles: (name) => name === 'home_assistant__control',
    run: async (args, signal) => {
      calls++;
      observedArgs = args;
      observedSignal = signal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        schemaVersion: 1,
        status: 'succeeded',
        summary: 'Commande acceptée ; état non confirmé.',
        result: { accepted: true, confirmed: false },
        snapshotId: null,
        actionRunId: null,
        error: null,
      };
    },
  });
  await f.ready();
  const args = { entityId: 'light.salon', action: 'turn_on', brightnessPct: 40 };
  f.emit(f.call('ha-call', 'home_assistant__control', args));
  f.emit(f.call('ha-call', 'home_assistant__control', args));
  f.emit(f.completed);
  await settle();
  assert.equal(calls, 1);
  assert.deepEqual(observedArgs, args);
  assert.equal(observedSignal?.aborted, false);
  assert.equal(f.sent.filter((event) => event.type === 'response.create').length, 0);
  release();
  await settle();
  assert.equal(f.outputs().length, 1);
  assert.deepEqual(f.outputs()[0]!.result, { accepted: true, confirmed: false });
  assert.equal(f.sent.filter((event) => event.type === 'response.create').length, 1);
});

test('la clôture de session annule le signal transmis au contrôle Home Assistant', async (t) => {
  let observedSignal: AbortSignal | undefined;
  const f = fixture(t, {
    tools: () => [],
    handles: (name) => name === 'home_assistant__control',
    run: async (_args, signal) => {
      observedSignal = signal;
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return {
        schemaVersion: 1,
        status: 'cancelled',
        summary: 'Annulé.',
        result: null,
        snapshotId: null,
        actionRunId: null,
        error: null,
      };
    },
  });
  await f.ready();
  f.emit(
    f.call('ha-cancel', 'home_assistant__control', {
      entityId: 'light.salon',
      action: 'turn_on',
      brightnessPct: null,
    }),
  );
  await settle();
  f.controller.close('Fin de présence.');
  await settle();
  assert.equal(observedSignal?.aborted, true);
});
