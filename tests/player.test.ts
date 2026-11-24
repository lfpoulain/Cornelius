import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import type { ConnectServerEvent } from 'openai/resources/live/sideband';
import type { AddonDefinition, AddonHttpClient, AddonPlayback } from '../shared/addons.js';
import { playerOutput } from '../shared/player.js';
import { AddonRuntime, playbackProblem } from '../server/addons/runtime.js';
import { validateAddonDefinition } from '../server/addons/registry.js';
import { SessionController } from '../server/controller.js';
import type { LiveGateway } from '../server/live/gateway.js';
import { LiveTransport } from '../server/live/transport.js';
import { liveConfiguration } from '../server/live/configuration.js';
import { DiagnosticLog } from '../server/logs.js';
import { Player, type PlayRequest } from '../server/player.js';
import { registerPlayer } from '../server/player-api.js';
import {
  audioType,
  blockedAddress,
  guardedLookup,
  openStream,
  PlayerStreamError,
  type Connect,
  type UpstreamResponse,
} from '../server/player-stream.js';
import { AddonRepository, openDatabase, ProfileRepository } from '../server/storage.js';
import demo from './e2e/modules/lecteur_demo/index.js';

const station: PlayRequest = {
  url: 'https://radio.example/direct.mp3?jeton=secret',
  title: 'Radio Démo',
  subtitle: 'En direct',
  imageUrl: null,
  kind: 'live',
  addonId: 'lecteur_demo',
  instanceRef: 'radios',
};

// --- Contrat ---------------------------------------------------------------------------

test('contrat : une demande de lecture https sans identifiants est conforme', () => {
  const playback: AddonPlayback = { ...station };
  delete (playback as Partial<PlayRequest>).addonId;
  delete (playback as Partial<PlayRequest>).instanceRef;
  assert.equal(playbackProblem(playback), null);
  assert.match(playbackProblem({ ...playback, url: 'http://radio.example/a.mp3' })!, /url/u);
  assert.match(
    playbackProblem({ ...playback, url: 'https://moi:secret@radio.example/a.mp3' })!,
    /identifiants/u,
  );
  assert.match(playbackProblem({ ...playback, title: '' })!, /title/u);
  assert.match(playbackProblem({ ...playback, kind: 'video' })!, /kind/u);
  assert.match(playbackProblem({ ...playback, imageUrl: 'data:image/png;base64,AA' })!, /image/u);
  assert.equal(playbackProblem({ ...playback, imageUrl: 'https://radio.example/logo.png' }), null);
});

test('chargeur : play vaut true ou rien', () => {
  const tool = demo.tools[1]!;
  assert.equal(validateAddonDefinition(demo), null);
  const wrong = { ...demo, tools: [{ ...tool, play: 'oui' }] } as unknown as AddonDefinition;
  assert.equal(validateAddonDefinition(wrong), 'définition d’outil invalide.');
});

function runtimeFixture(t: TestContext, definition: AddonDefinition = demo as AddonDefinition) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const logs = new DiagnosticLog();
  const http: AddonHttpClient = {
    async fetch() {
      throw new Error('aucun réseau');
    },
  };
  instances.createInstance({
    addonId: definition.id,
    profileId: null,
    ref: 'radios',
    label: 'Radios',
    config: {
      stations: [
        { nom: 'Radio Démo', adresse: 'https://radio.example/direct.mp3', genre: 'live' },
        { nom: 'Épisode', adresse: 'https://podcast.example/1.mp3', genre: 'file' },
      ],
      logo: 'https://radio.example/logo.png',
    },
    configVersion: 1,
  });
  const runtime = new AddonRuntime({ addons: [definition], instances, http, logs });
  return { runtime, instances, logs };
}

test('outil play : la collecte reçoit play et rend la demande, sans cache ni carte enregistrée', async (t) => {
  const f = runtimeFixture(t);
  const signal = new AbortController().signal;
  const invoked = await f.runtime.invoke('lecteur_demo__ecouter', null, null, signal, {
    instanceRef: null,
    query: 'radio demo',
  });
  assert.ok(invoked?.outcome.ok);
  if (!invoked.outcome.ok) return;
  assert.deepEqual(invoked.outcome.playback, {
    url: 'https://radio.example/direct.mp3',
    title: 'Radio Démo',
    subtitle: 'Station de démonstration',
    imageUrl: 'https://radio.example/logo.png',
    kind: 'live',
  });
  assert.equal(f.runtime.isPlayTool('lecteur_demo__ecouter'), true);
  assert.equal(f.runtime.isPlayTool('lecteur_demo__read'), false);
  // À la demande : le relevé de la source n'est pas touché.
  assert.equal(f.instances.getSnapshot(f.instances.listInstances()[0]!), null);
  const file = await f.runtime.invoke('lecteur_demo__ecouter', null, null, signal, {
    instanceRef: null,
    query: 'épisode',
  });
  assert.ok(file?.outcome.ok && file.outcome.playback?.kind === 'file');
  const missing = await f.runtime.invoke('lecteur_demo__ecouter', null, null, signal, {
    instanceRef: null,
    query: 'Radio Inconnue',
  });
  assert.equal(missing?.tool.status, 'failed');
  assert.match(missing!.tool.summary, /Aucune station « Radio Inconnue »/u);
});

test('outil sans play : une demande de lecture rendue est ignorée', async (t) => {
  const greedy = {
    ...demo,
    async collect() {
      return {
        data: { stations: 1, choisie: 'x' },
        playback: { ...station, addonId: undefined, instanceRef: undefined },
      };
    },
  } as unknown as AddonDefinition;
  const f = runtimeFixture(t, greedy);
  const invoked = await f.runtime.invoke(
    'lecteur_demo__read',
    null,
    null,
    new AbortController().signal,
    { instanceRef: null },
  );
  assert.ok(invoked?.outcome.ok);
  assert.equal(invoked.outcome.ok && invoked.outcome.playback, undefined);
});

test('outil play : une demande non conforme échoue en malformed, détail au journal', async (t) => {
  const broken = {
    ...demo,
    async collect() {
      return {
        data: { stations: 1, choisie: 'x' },
        playback: {
          url: 'http://radio.example/a.mp3',
          title: 'x',
          subtitle: null,
          imageUrl: null,
          kind: 'live',
        },
      };
    },
  } as unknown as AddonDefinition;
  const f = runtimeFixture(t, broken);
  const invoked = await f.runtime.invoke(
    'lecteur_demo__ecouter',
    null,
    null,
    new AbortController().signal,
    { instanceRef: null, query: 'x' },
  );
  assert.equal(invoked?.tool.status, 'failed');
  assert.equal(invoked?.tool.error?.code, 'malformed');
  const logged = f.logs
    .snapshot()
    .entries.find((entry) => entry.event === 'Demande de lecture non conforme');
  assert.ok(logged);
});

// --- Lecteur ---------------------------------------------------------------------------

function playerFixture(connected = true) {
  const logs = new DiagnosticLog();
  let changes = 0;
  const player = new Player({ logs, mirrorConnected: () => connected, ackTimeoutMs: 50 });
  player.onChange(() => changes++);
  return { player, logs, changes: () => changes };
}

test('lecteur : l’accusé du miroir fait réussir l’outil ; le journal ne garde que l’hôte', async () => {
  const f = playerFixture();
  const pending = f.player.play(station);
  const view = f.player.mirrorView()!;
  assert.equal(view.status, 'loading');
  assert.equal(view.volume, 6);
  assert.equal(f.player.playing(view.id)?.url, station.url);
  assert.equal(f.player.playing('autre'), null);
  assert.equal(f.player.report(view.id, 'playing'), true);
  const result = await pending;
  assert.equal(result.status, 'succeeded');
  assert.equal(f.player.mirrorView()!.status, 'playing');
  const text = JSON.stringify(f.logs.snapshot().entries);
  assert.match(text, /radio\.example/u);
  assert.doesNotMatch(text, /jeton=secret/u);
});

test('lecteur : échec du miroir, délai dépassé, miroir absent', async () => {
  const f = playerFixture();
  const failing = f.player.play(station);
  f.player.report(f.player.mirrorView()!.id, 'error', 'Flux refusé https://x.example/a');
  const failed = await failing;
  assert.equal(failed.status, 'failed');
  assert.match(failed.summary, /Flux refusé …/u);
  assert.equal(f.player.mirrorView(), null);
  const silent = await f.player.play(station);
  assert.equal(silent.status, 'unknown');
  assert.ok(f.player.mirrorView(), 'la lecture reste demandée sans accusé');
  const absent = await playerFixture(false).player.play(station);
  assert.equal(absent.status, 'failed');
  assert.match(absent.summary, /pas connecté/u);
});

test('lecteur : une nouvelle lecture remplace l’ancienne ; un accusé périmé est ignoré', async () => {
  const f = playerFixture();
  void f.player.play(station);
  const first = f.player.mirrorView()!.id;
  void f.player.play({ ...station, title: 'Autre radio' });
  const second = f.player.mirrorView()!;
  assert.notEqual(second.id, first);
  assert.equal(f.player.report(first, 'playing'), false);
  assert.equal(second.title, 'Autre radio');
  const stopped = f.logs.snapshot().entries.find((entry) => entry.event === 'Lecture arrêtée');
  assert.equal(stopped?.details?.cause, 'nouvelle lecture');
});

test('lecteur : commandes communes arrêter, reprendre, volume ; fin d’un fichier', async () => {
  const f = playerFixture();
  assert.equal((await f.player.control({ action: 'stop' })).summary, 'Rien ne joue sur le miroir.');
  assert.equal((await f.player.control({ action: 'resume' })).status, 'failed');
  void f.player.play(station);
  f.player.report(f.player.mirrorView()!.id, 'playing');
  const louder = await f.player.control({ action: 'volume', level: null, change: 'louder' });
  assert.equal(louder.summary, 'Volume de la lecture : 8 sur 10.');
  await f.player.control({ action: 'volume', level: null, change: 'louder' });
  assert.equal(f.player.mirrorView()!.volume, 10);
  await f.player.control({ action: 'volume', level: 3, change: null });
  assert.equal(f.player.mirrorView()!.volume, 3);
  assert.equal(
    (await f.player.control({ action: 'volume', level: 12, change: null })).status,
    'failed',
  );
  assert.equal((await f.player.control({ action: 'stop' })).summary, 'Radio Démo est arrêté.');
  assert.equal(f.player.mirrorView(), null);
  const resumed = f.player.control({ action: 'resume' });
  const id = f.player.mirrorView()!.id;
  f.player.report(id, 'playing');
  assert.equal((await resumed).status, 'succeeded');
  assert.equal(f.player.mirrorView()!.volume, 3, 'le volume réglé est gardé');
  f.player.report(id, 'ended');
  assert.equal(f.player.mirrorView(), null);
});

// --- Volume du miroir ------------------------------------------------------------------

test('miroir : le son baisse quand Cornelius écoute, se coupe quand il parle', () => {
  const idle = { conversation: false, speaking: false, alarm: false };
  assert.deepEqual(playerOutput('live', 6, idle), { gain: 0.6, paused: false });
  const listening = playerOutput('live', 6, { ...idle, conversation: true });
  assert.ok(Math.abs(listening.gain - 0.09) < 1e-9 && !listening.paused);
  assert.deepEqual(playerOutput('live', 6, { ...idle, conversation: true, speaking: true }), {
    gain: 0,
    paused: false,
  });
  assert.deepEqual(playerOutput('live', 6, { ...idle, alarm: true }), { gain: 0, paused: false });
  assert.deepEqual(playerOutput('file', 6, { ...idle, conversation: true }), {
    gain: 0.6,
    paused: true,
  });
  assert.deepEqual(playerOutput('file', 6, idle), { gain: 0.6, paused: false });
});

// --- Relais du flux --------------------------------------------------------------------

function upstream(
  status: number,
  headers: Record<string, string> = { 'content-type': 'audio/mpeg' },
  body = 'ID3',
): UpstreamResponse {
  const stream = new PassThrough();
  stream.end(body);
  return { status, headers, body: stream };
}

test('relais : adresses du réseau local et non routables refusées', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.20.0.1', '169.254.1.1'])
    assert.equal(blockedAddress(address), true, address);
  for (const address of ['0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1'])
    assert.equal(blockedAddress(address), true, address);
  assert.equal(blockedAddress('::ffff:192.168.1.2'), true);
  assert.equal(blockedAddress('93.184.216.34'), false);
  assert.equal(blockedAddress('2606:4700::1111'), false);
});

test('relais : un nom qui résout vers le réseau local est refusé', async () => {
  const resolveTo =
    (address: string) =>
    (
      _name: string,
      _options: unknown,
      callback: (error: null, list: { address: string; family: number }[]) => void,
    ) =>
      callback(null, [{ address, family: 4 }]);
  const lookup = (address: string) =>
    new Promise<{ error: unknown; address: unknown }>((resolve) =>
      guardedLookup(
        'radio.example',
        {},
        (error, value) => resolve({ error, address: value }),
        resolveTo(address) as never,
      ),
    );
  const blocked = await lookup('192.168.1.20');
  assert.equal((blocked.error as { code?: string }).code, 'EBLOCKED');
  const open = await lookup('93.184.216.34');
  assert.equal(open.error, null);
  assert.equal(open.address, '93.184.216.34');
});

test('relais : https seul, redirections bornées, listes de lecture refusées, plage transmise', async () => {
  const signal = new AbortController().signal;
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const replies: UpstreamResponse[] = [];
  const connect: Connect = async (url, headers) => {
    seen.push({ url: url.href, headers });
    return replies.shift() ?? upstream(404);
  };
  await assert.rejects(openStream('http://radio.example/a.mp3', { signal, connect }), /https/u);
  await assert.rejects(openStream('https://192.168.1.2/a.mp3', { signal, connect }), /local/u);

  replies.push(upstream(302, { location: 'https://cdn.example/a.mp3' }), upstream(200));
  const followed = await openStream('https://radio.example/a.mp3', {
    signal,
    connect,
    range: 'bytes=10-',
  });
  assert.equal(followed.type, 'audio/mpeg');
  assert.equal(seen.at(-1)!.url, 'https://cdn.example/a.mp3');
  assert.equal(seen.at(-1)!.headers.Range, 'bytes=10-');
  assert.equal(seen.at(-1)!.headers['Icy-MetaData'], '0');

  replies.push(upstream(302, { location: 'http://cdn.example/a.mp3' }));
  await assert.rejects(openStream('https://radio.example/a.mp3', { signal, connect }), /https/u);

  replies.push(...[0, 1, 2, 3].map(() => upstream(302, { location: '/encore' })));
  await assert.rejects(
    openStream('https://radio.example/a.mp3', { signal, connect }),
    /Trop de redirections/u,
  );

  replies.push(upstream(200, { 'content-type': 'audio/x-mpegurl' }));
  await assert.rejects(
    openStream('https://radio.example/a.m3u', { signal, connect }),
    (error: unknown) => error instanceof PlayerStreamError && error.status === 415,
  );
  replies.push(upstream(404));
  await assert.rejects(
    openStream('https://radio.example/a.mp3', { signal, connect }),
    /introuvable/u,
  );

  assert.deepEqual(audioType('audio/aacp'), { ok: true, type: 'audio/aacp' });
  assert.deepEqual(audioType('application/octet-stream'), { ok: true, type: 'audio/mpeg' });
  assert.equal(audioType('text/html; charset=utf-8').ok, false);
});

test('routes : seule la lecture courante est relayée, au miroir courant', async (t) => {
  const player = new Player({ mirrorConnected: () => true, ackTimeoutMs: 20 });
  const app = Fastify();
  t.after(() => app.close());
  let kiosk = true;
  const connect: Connect = async () =>
    upstream(206, {
      'content-type': 'audio/mpeg',
      'content-range': 'bytes 0-2/3',
      'content-length': '3',
    });
  registerPlayer(app, {
    player,
    http: {
      async fetch() {
        return {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
          text: () => '<svg/>',
          json: () => null,
          bytes: () => new Uint8Array([60]),
        };
      },
    },
    connect,
    kiosk: async (_request, reply) => {
      if (!kiosk) await reply.code(409).send({ error: 'autre onglet' });
    },
    requireAdmin: async () => {},
  });
  assert.equal((await app.inject('/api/player/inconnu/stream')).statusCode, 404);
  void player.play({ ...station, imageUrl: 'https://radio.example/logo.svg' });
  const id = player.mirrorView()!.id;
  const streamed = await app.inject(`/api/player/${id}/stream`);
  assert.equal(streamed.statusCode, 206);
  assert.equal(streamed.headers['content-type'], 'audio/mpeg');
  assert.equal(streamed.headers['content-range'], 'bytes 0-2/3');
  assert.equal(streamed.body, 'ID3');
  // Un SVG n'est pas un logo accepté.
  assert.equal((await app.inject(`/api/player/${id}/image`)).statusCode, 404);
  kiosk = false;
  assert.equal((await app.inject(`/api/player/${id}/stream`)).statusCode, 409);
  kiosk = true;
  const status = await app.inject({
    method: 'POST',
    url: '/api/player/status',
    payload: { id, status: 'playing' },
  });
  assert.deepEqual(status.json(), { ok: true });
  const stop = await app.inject({ method: 'POST', url: '/api/player/stop', payload: {} });
  assert.deepEqual(stop.json(), { ok: true });
  assert.equal(player.mirrorView(), null);
  assert.equal((await app.inject(`/api/player/${id}/stream`)).statusCode, 404);
});

// --- Conversation Live -----------------------------------------------------------------

async function settle(times = 6) {
  for (let index = 0; index < times; index++) await setImmediate();
}

function liveFixture(t: TestContext) {
  const db = openDatabase(':memory:');
  let now = Date.parse('2026-11-24T09:05:00Z');
  const profiles = new ProfileRepository(db);
  const { runtime } = runtimeFixture(t);
  const player = new Player({ mirrorConnected: () => true, ackTimeoutMs: 1_000 });
  const sent: { type: string; item?: { output?: string } }[] = [];
  let handlers!: Parameters<LiveGateway['attach']>[1];
  const gateway: LiveGateway = {
    async create() {
      return { session: { id: 'live_player' }, transport: { type: 'webrtc', sdp: 'answer' } };
    },
    attach(_id, value) {
      handlers = value;
      return { send: (event) => sent.push(event as never), dispose() {} };
    },
  };
  const live = new LiveTransport(gateway, () => false, new DiagnosticLog(), {
    addons: runtime,
    player,
  });
  const controller = new SessionController(profiles, live, () => now, undefined);
  live.attach(controller);
  controller.setPlayerProjection(() => player.mirrorView());
  player.onChange(() => controller.publish());
  t.after(() => {
    live.dispose();
    db.close();
  });
  let sequence = 0;
  const observe = () => {
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
  };
  observe();
  now += 900;
  observe();
  const scope = controller.scope();
  const call = (callId: string, name: string, args: unknown) =>
    handlers.event({
      type: 'response.event',
      delegation_id: 'delegation',
      event: {
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) },
      },
    } as unknown as ConnectServerEvent);
  const outputs = () =>
    sent
      .filter((event) => event.type === 'response.item.create')
      .map((event) => JSON.parse(String(event.item!.output)) as Record<string, unknown>);
  return {
    live,
    controller,
    player,
    call,
    outputs,
    async ready() {
      await live.offer(scope, 'offer');
      handlers.open();
      live.started(scope);
    },
  };
}

test('conversation : l’outil play lance le lecteur sans carte, player__control est proposé', async (t) => {
  const f = liveFixture(t);
  await f.ready();
  const names = (f.live as unknown as { toolDescriptors(id: string | null): { name: string }[] })
    .toolDescriptors(null)
    .map((tool) => tool.name);
  assert.ok(names.includes('lecteur_demo__ecouter'));
  assert.ok(names.includes('player__control'));
  const config = liveConfiguration(
    names.map((name) => ({ name, description: '', parameters: { type: 'object' } })),
  );
  assert.match(config.instructions ?? '', /arrête la musique/u);
  f.call('call-play', 'lecteur_demo__ecouter', { instanceRef: null, query: 'Radio Démo' });
  await settle();
  const view = f.player.mirrorView();
  assert.equal(view?.title, 'Radio Démo');
  assert.equal(f.controller.snapshot().state.player?.id, view?.id);
  f.player.report(view!.id, 'playing');
  await settle();
  const output = f.outputs().at(-1)!;
  assert.equal(output.status, 'succeeded');
  assert.equal(output.summary, 'Radio Démo joue sur le miroir.');
  assert.equal(f.controller.snapshot().state.cards.length, 0, 'le bandeau remplace la carte');
  f.call('call-stop', 'player__control', { action: 'stop', level: null, change: null });
  await settle();
  assert.equal(f.outputs().at(-1)!.summary, 'Radio Démo est arrêté.');
  assert.equal(f.controller.snapshot().state.player, null);
});
