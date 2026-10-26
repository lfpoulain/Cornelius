import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import type { WebSocket } from 'ws';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';
import type { PerceptionObservation, StateEvent } from '../shared/types.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-test-1234';

async function fixture(t: TestContext, overrides: Partial<AppConfig> = {}) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-api-images-'));
  let now = Date.parse('2026-09-16T12:00:00Z');
  const config: AppConfig = {
    databasePath: ':memory:',
    openaiKey: 'test-key',
    perceptionToken: 'p'.repeat(40),
    imageGenerationToken: 'i'.repeat(40),
    adminPassword: password,
    origins: [origin],
    secureCookies: false,
    ...overrides,
  };
  const services = await createApp(config, {
    timers: false,
    imageGenerationRoot: imageRoot,
    now: () => now,
    modelLauncher: () =>
      spawn(
        process.execPath,
        ['-e', 'process.stdout.write(JSON.stringify({state:"ready"})+"\\n")'],
        { windowsHide: true },
      ),
  });
  await services.app.ready();
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await setImmediate();
    await services.app.close();
    rmdirSync(imageRoot);
  });
  async function login() {
    const response = await services.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin },
      payload: { password: config.adminPassword },
    });
    assert.equal(response.statusCode, 200, response.body);
    const entry = response.cookies.find((cookie) => cookie.name === 'cornelius_admin');
    assert.ok(entry);
    assert.match(String(response.headers['set-cookie']), /HttpOnly/u);
    assert.match(String(response.headers['set-cookie']), /SameSite=Strict/u);
    return `${entry.name}=${entry.value}`;
  }
  async function kiosk() {
    const response = await services.app.inject({ url: '/api/auth?role=kiosk' });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { role: 'kiosk' });
    const entry = response.cookies.find((cookie) => cookie.name === 'cornelius_kiosk');
    assert.ok(entry);
    return `${entry.name}=${entry.value}`;
  }
  async function connect(role: 'admin' | 'kiosk', cookie?: string) {
    let initial!: Promise<StateEvent>;
    const socket = await services.app.injectWS(
      `/events?role=${role}`,
      {
        headers: { host: 'localhost', origin, ...(cookie ? { cookie } : {}) },
      },
      {
        onInit: (ws) => {
          initial = once(ws, 'message', { signal: AbortSignal.timeout(2000) }).then(
            ([data]) => JSON.parse(String(data)) as StateEvent,
          );
        },
      },
    );
    sockets.push(socket);
    const snapshot = await initial;
    return { socket, snapshot };
  }
  return {
    ...services,
    sockets,
    login,
    kiosk,
    connect,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function closed(socket: WebSocket): Promise<unknown[]> {
  return once(socket, 'close', { signal: AbortSignal.timeout(2000) });
}

test('le miroir est public et les droits administrateur restent protégés', async (t) => {
  const f = await fixture(t);
  const anonymous = await f.app.inject({ url: '/api/state' });
  assert.equal(anonymous.statusCode, 200);
  assert.equal((await f.app.inject('/api/admin/profiles')).statusCode, 401);
  const cookie = await f.kiosk();
  const snapshot = await f.app.inject({ url: '/api/state', headers: { cookie } });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.body.includes(password), false);
  assert.equal(
    (await f.app.inject({ url: '/api/admin/profiles', headers: { cookie } })).statusCode,
    401,
  );
  for (const [method, url, payload] of [
    ['POST', '/api/admin/profiles', { name: 'Alice' }],
    ['PATCH', '/api/admin/profiles/unknown', { name: 'Alice' }],
    ['DELETE', '/api/admin/profiles/unknown', undefined],
    ['POST', '/api/commands', { type: 'stop' }],
  ] as const) {
    const response = await f.app.inject({ method, url, headers: { origin, cookie }, payload });
    assert.equal(response.statusCode, 401, `${method} ${url}`);
  }
  assert.equal(f.profiles.list().length, 0);
});

test('l’état diffusé dit ce qui manque au premier lancement sans exposer aucun secret', async (t) => {
  const first = await fixture(t, { openaiKey: undefined, adminPassword: 'cornelius' });
  const firstState = await first.app.inject({ url: '/api/state' });
  assert.deepEqual(firstState.json().state.setup, {
    openaiKey: false,
    perception: false,
    mistralKey: false,
    voiceKey: false,
  });
  const firstAdmin = await first.login();
  const firstDevices = (
    await first.app.inject({ url: '/api/admin/devices', headers: { cookie: firstAdmin } })
  ).json();
  assert.equal(firstDevices.apiConfigured, false);
  assert.equal(firstDevices.defaultPassword, true);
  assert.equal(firstDevices.enrolledFaces, 0);

  const f = await fixture(t);
  const secrets = ['test-key', 'p'.repeat(40), 'i'.repeat(40), password];
  const anonymous = await f.app.inject({ url: '/api/state' });
  assert.deepEqual(anonymous.json().state.setup, {
    openaiKey: true,
    perception: false,
    mistralKey: false,
    voiceKey: true,
  });
  const admin = await f.login();
  const { snapshot } = await f.connect('admin', admin);
  assert.deepEqual(snapshot.state.setup, {
    openaiKey: true,
    perception: false,
    mistralKey: false,
    voiceKey: true,
  });
  const devices = await f.app.inject({ url: '/api/admin/devices', headers: { cookie: admin } });
  assert.equal(devices.json().defaultPassword, false);
  for (const body of [anonymous.body, JSON.stringify(snapshot), devices.body])
    for (const secret of secrets) assert.equal(body.includes(secret), false, secret);

  // Le miroir apprend la connexion du service de perception par l’état qu’il reçoit déjà.
  const { socket: mirror } = await f.connect('kiosk', await f.kiosk());
  const messages: string[] = [];
  mirror.on('message', (data) => messages.push(String(data)));
  const worker = await f.app.injectWS('/perception', {
    headers: { host: 'localhost', origin, authorization: 'Bearer ' + 'p'.repeat(40) },
  });
  f.sockets.push(worker);
  await setImmediate();
  const states = messages
    .map((message) => JSON.parse(message) as StateEvent)
    .filter((event) => event.type === 'state');
  // Dès la première publication après la connexion : jamais un état intermédiaire incohérent.
  assert.deepEqual(states[0]?.state.setup, {
    openaiKey: true,
    perception: true,
    mistralKey: false,
    voiceKey: true,
  });
  for (const message of messages)
    for (const secret of secrets) assert.equal(message.includes(secret), false, secret);
  worker.terminate();
  await once(worker, 'close', { signal: AbortSignal.timeout(2000) });
  await setImmediate();
  assert.equal((await f.app.inject({ url: '/api/state' })).json().state.setup.perception, false);
});

test('mutations require an allowed origin and all requests reject a foreign Host', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  for (const headers of [
    { cookie },
    { cookie, origin: 'https://attacker.example' },
    { cookie, origin: 'null' },
  ]) {
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/admin/profiles',
          headers,
          payload: { name: 'Alice' },
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/login',
        payload: { password },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/state',
        headers: { cookie, origin: 'https://attacker.example' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/health', headers: { host: 'attacker.example' } })).statusCode,
    403,
  );
  assert.equal(f.profiles.list().length, 0);
  const response = await f.app.inject({ url: '/api/state', headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
});

test('la session administrateur expire et la déconnexion la révoque ; le miroir reste disponible', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/login',
        headers: { origin },
        payload: { password: 'incorrect' },
      })
    ).statusCode,
    401,
  );
  const admin = await f.login();
  const kiosk = await f.kiosk();
  assert.deepEqual(
    (await f.app.inject({ url: '/api/auth?role=admin', headers: { cookie: admin } })).json(),
    { role: 'admin' },
  );
  assert.deepEqual(
    (await f.app.inject({ url: '/api/auth?role=kiosk', headers: { cookie: kiosk } })).json(),
    { role: 'kiosk' },
  );
  assert.deepEqual((await f.app.inject({ url: '/api/auth?role=kiosk' })).json(), {
    role: 'kiosk',
  });
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/logout',
        headers: { cookie: admin, origin },
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(
    (await f.app.inject({ url: '/api/auth?role=admin', headers: { cookie: admin } })).json(),
    { role: null },
  );
  assert.equal(
    (await f.app.inject({ url: '/api/admin/profiles', headers: { cookie: admin } })).statusCode,
    401,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/state', headers: { cookie: admin } })).statusCode,
    200,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/state', headers: { cookie: kiosk } })).statusCode,
    200,
  );
  const expiring = await f.login();
  f.advance(3600 * 1000);
  assert.equal(
    (await f.app.inject({ url: '/api/admin/profiles', headers: { cookie: expiring } })).statusCode,
    401,
  );
  f.advance(30 * 24 * 3600 * 1000);
  assert.equal(
    (await f.app.inject({ url: '/api/state', headers: { cookie: kiosk } })).statusCode,
    200,
  );
});

test('administrators manage profiles and invalid names cannot become internal errors', async (t) => {
  const f = await fixture(t);
  const headers = { origin, cookie: await f.login() };
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/admin/profiles',
    headers,
    payload: { name: ' Alice ' },
  });
  assert.equal(created.statusCode, 201);
  const profile = created.json<{ id: string; name: string }>();
  assert.equal(profile.name, 'Alice');
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `/api/admin/profiles/${profile.id}`,
        headers,
        payload: { name: 'Alicia' },
      })
    ).json<{ name: string }>().name,
    'Alicia',
  );
  for (const payload of [
    { name: '' },
    { name: '   ' },
    { name: 'A\nB' },
    { name: 'A\u0000B' },
    { name: 'Bob', role: 'admin' },
  ]) {
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/admin/profiles',
      headers,
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `/api/admin/profiles/${profile.id}`,
        headers,
        payload: { name: 'A\nB' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: '/api/admin/profiles/missing',
        headers,
        payload: { name: 'Bob' },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await f.app.inject({ method: 'DELETE', url: `/api/admin/profiles/${profile.id}`, headers }))
      .statusCode,
    200,
  );
  assert.equal(f.profiles.get(profile.id), null);
  assert.equal(
    (await f.app.inject({ method: 'DELETE', url: `/api/admin/profiles/${profile.id}`, headers }))
      .statusCode,
    404,
  );
});

test('strict payloads protect commands', async (t) => {
  const f = await fixture(t);
  const headers = { origin, cookie: await f.login() };
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/commands',
        headers,
        payload: { type: 'start', profileId: 'forged' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/commands',
        headers,
        payload: { type: 'select_profile', profileId: 'missing' },
      })
    ).statusCode,
    400,
  );
});

test('login payloads are strict and repeated attempts are rate limited', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/login',
        headers: { origin },
        payload: { password, extra: true },
      })
    ).statusCode,
    400,
  );
  for (let index = 0; index < 9; index++) {
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/login',
          headers: { origin },
          payload: { password: 'invalid' },
        })
      ).statusCode,
      401,
    );
  }
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/login',
        headers: { origin },
        payload: { password: 'invalid' },
      })
    ).statusCode,
    429,
  );
});

test('WebSocket upgrades enforce origin, administrator role and the public kiosk', async (t) => {
  const f = await fixture(t);
  const kiosk = await f.kiosk();
  await assert.rejects(
    f.app.injectWS('/events?role=admin', { headers: { host: 'localhost', origin } }),
    /401/u,
  );
  await assert.rejects(
    f.app.injectWS('/events?role=admin', {
      headers: { host: 'localhost', origin, cookie: kiosk },
    }),
    /401/u,
  );
  await assert.rejects(
    f.app.injectWS('/events', { headers: { host: 'localhost', cookie: kiosk } }),
    /403/u,
  );
  await assert.rejects(
    f.app.injectWS('/events', {
      headers: { host: 'localhost', origin: 'https://attacker.example', cookie: kiosk },
    }),
    /403/u,
  );
  const kioskConnection = await f.connect('kiosk', kiosk);
  assert.equal(kioskConnection.snapshot.type, 'state');
  const admin = await f.login();
  const { socket, snapshot } = await f.connect('admin', admin);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.type, 'state');
  const didClose = closed(socket);
  await f.app.inject({
    method: 'POST',
    url: '/api/logout',
    headers: { cookie: admin, origin },
    payload: {},
  });
  const [code] = await didClose;
  assert.equal(code, 1008);
});

test('administrator heartbeats cannot authorize a session without a connected kiosk', async (t) => {
  const f = await fixture(t);
  const admin = await f.login();
  const { socket } = await f.connect('admin', admin);
  socket.send(JSON.stringify({ type: 'heartbeat' }));
  await setImmediate();
  const headers = { origin, cookie: admin };
  const observation: PerceptionObservation = {
    schemaVersion: 1,
    producerBootId: 'camera-test',
    sequence: 0,
    observedAt: f.now(),
    health: 'ok',
    presence: true,
    engaged: true,
    people: [{ trackId: 'visitor', profileId: null }],
  };
  f.controller.observe(observation);
  f.advance(800);
  f.controller.observe({ ...observation, sequence: 1, observedAt: f.now() });
  f.controller.tick();
  const refused = await f.app.inject({
    method: 'POST',
    url: '/api/commands',
    headers,
    payload: { type: 'start' },
  });
  assert.notEqual(refused.json<StateEvent>().state.session.phase, 'connecting');
  const kiosk = await f.kiosk();
  const mirror = await f.connect('kiosk', kiosk);
  socket.send(JSON.stringify({ type: 'media_ready', ready: true }));
  await setImmediate();
  assert.equal(f.controller.snapshot().state.browserAudioReady, false);
  assert.notEqual(f.controller.snapshot().state.session.phase, 'connecting');
  // Even a long permission dialog consumes no connection deadline.
  f.advance(20_000);
  f.controller.heartbeat();
  f.controller.observe({ ...observation, sequence: 2, observedAt: f.now() });
  mirror.socket.send(JSON.stringify({ type: 'media_ready', ready: true }));
  await setImmediate();
  const accepted = await f.app.inject({
    method: 'POST',
    url: '/api/commands',
    headers,
    payload: { type: 'start' },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json<StateEvent>().state.session.phase, 'connecting');
});

test('an expired WebSocket session is revoked before processing its next message', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const { socket } = await f.connect('admin', cookie);
  const didClose = closed(socket);
  f.advance(3600 * 1000);
  socket.send(JSON.stringify({ type: 'heartbeat' }));
  const [code] = await didClose;
  assert.equal(code, 1008);
  assert.equal(
    (await f.app.inject({ url: '/api/admin/profiles', headers: { cookie } })).statusCode,
    401,
  );
});

test('native keepalive accepts only the current kiosk, which no longer expires', async (t) => {
  const f = await fixture(t);
  const admin = await f.connect('admin', await f.login());
  admin.socket.pong();
  await setImmediate();
  assert.equal(f.controller.snapshot().state.browserConnected, false);
  const kiosk = await f.connect('kiosk', await f.kiosk());
  f.advance(6000);
  assert.equal(f.controller.snapshot().state.browserConnected, false);
  kiosk.socket.pong();
  await setImmediate();
  assert.equal(f.controller.snapshot().state.browserConnected, true);
  f.advance(7 * 24 * 3600 * 1000);
  kiosk.socket.pong();
  await setImmediate();
  assert.equal(f.controller.snapshot().state.browserConnected, true);
});

test('les accès caméra, audio et enrôlement restent séparés des droits kiosque et admin', async (t) => {
  const f = await fixture(t);
  const admin = await f.login();
  const kiosk = await f.kiosk();
  const profile = f.profiles.create('Test matériel');
  const headers = { origin, cookie: admin };
  for (const [method, url] of [
    ['GET', '/api/admin/devices'],
    ['GET', '/api/admin/camera/frame'],
    ['POST', '/api/admin/camera/select'],
    ['POST', '/api/admin/camera/refresh'],
    ['PATCH', '/api/admin/recognition'],
    ['PATCH', '/api/admin/engagement'],
    ['PATCH', '/api/admin/vision'],
    ['PATCH', '/api/admin/vision/model'],
    ['POST', '/api/admin/profiles/' + profile.id + '/enroll'],
    ['DELETE', '/api/admin/profiles/' + profile.id + '/face'],
  ] as const) {
    assert.equal(
      (await f.app.inject({ method, url, headers: { origin, cookie: kiosk } })).statusCode,
      401,
    );
  }
  for (const cookie of [admin, kiosk]) {
    await assert.rejects(
      f.app.injectWS('/perception', { headers: { host: 'localhost', origin, cookie } }),
      /403/,
    );
  }
  const worker = await f.app.injectWS('/perception', {
    headers: { host: 'localhost', origin, authorization: 'Bearer ' + 'p'.repeat(40) },
  });
  f.sockets.push(worker);
  assert.equal(
    (await f.app.inject({ url: '/api/admin/devices', headers })).json().perception.connected,
    true,
  );

  worker.send(
    JSON.stringify({
      type: 'camera_status',
      selectedId: 'camera-one',
      devices: [{ id: 'camera-one', label: 'Webcam' }],
      error: null,
    }),
  );
  await setImmediate();
  const frameRequest = once(worker, 'message', { signal: AbortSignal.timeout(2000) });
  const responsePromise = f.app
    .inject({ url: '/api/admin/camera/frame', headers })
    .then((value) => value);
  const [previewMessage] = await frameRequest;
  const preview = JSON.parse(String(previewMessage));
  assert.equal(preview.type, 'camera_preview');
  const jpeg = Buffer.from([255, 216, 1, 2, 255, 217]);
  worker.send(Buffer.concat([Buffer.from(preview.requestId), jpeg]));
  const image = await responsePromise;
  assert.equal(image.statusCode, 200);
  assert.equal(image.headers['content-type'], 'image/jpeg');
  assert.equal(image.headers['cache-control'], 'no-store');
  assert.deepEqual(image.rawPayload, jpeg);

  const enrolled = once(worker, 'message', { signal: AbortSignal.timeout(2000) });
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/profiles/' + profile.id + '/enroll',
        headers,
      })
    ).statusCode,
    200,
  );
  const [data] = await enrolled;
  const request = JSON.parse(String(data));
  assert.equal(request.type, 'enroll');
  worker.send(
    JSON.stringify({
      type: 'enrolled',
      id: request.enrollment.id,
      templates: Array.from({ length: 3 }, () => Array(128).fill(1)),
    }),
  );
  await setImmediate();
  const withFace = (await f.app.inject({ url: '/api/admin/devices', headers })).json();
  assert.deepEqual(withFace.perception.enrolledProfileIds, [profile.id]);
  assert.equal(withFace.enrolledFaces, 1);
  await f.app.inject({ method: 'DELETE', url: '/api/admin/profiles/' + profile.id, headers });
  const withoutFace = (await f.app.inject({ url: '/api/admin/devices', headers })).json();
  assert.deepEqual(withoutFace.perception.enrolledProfileIds, []);
  assert.equal(withoutFace.enrolledFaces, 0);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/media/offer', headers, payload: {} }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/media/offer',
        headers: { origin, cookie: kiosk },
        payload: {},
      })
    ).statusCode,
    409,
  );
});

test('la génération d’image se configure par l’admin et son worker possède un jeton distinct', async (t) => {
  const f = await fixture(t);
  const admin = await f.login();
  const headers = { origin, cookie: admin };
  const initial = await f.app.inject({ url: '/api/admin/devices', headers });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().imageGeneration.enabled, false);
  assert.equal(initial.json().imageGeneration.illustrateCards, false);
  assert.equal(initial.json().imageGeneration.configured, true);
  assert.equal(initial.json().imageGeneration.connected, false);
  assert.equal(initial.json().imageGeneration.model, 'flux2-klein-4b');
  assert.equal(initial.json().imageGeneration.installations['flux2-klein-4b'].state, 'missing');
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: '/api/admin/image-generation',
        headers: { origin },
        payload: { enabled: true },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: '/api/admin/image-generation',
        headers,
        payload: { model: 'inconnu' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: '/api/admin/image-generation',
        headers,
        payload: { sanaSteps: 3 },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: '/api/admin/image-generation',
        headers,
        payload: { illustrateCards: 'oui' },
      })
    ).statusCode,
    400,
  );
  const automatic = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/image-generation',
    headers,
    payload: { illustrateCards: true },
  });
  assert.equal(automatic.statusCode, 200, automatic.body);
  assert.equal(automatic.json().illustrateCards, true);
  const sanaQuality = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/image-generation',
    headers,
    payload: { sanaSteps: 4 },
  });
  assert.equal(sanaQuality.statusCode, 200, sanaQuality.body);
  assert.equal(sanaQuality.json().sanaSteps, 4);
  const updated = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/image-generation',
    headers,
    payload: { enabled: true, model: 'sdxl-turbo' },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().enabled, true);
  assert.equal(updated.json().model, 'sdxl-turbo');

  await assert.rejects(
    f.app.injectWS('/image-generation', {
      headers: { host: 'localhost', origin, authorization: 'Bearer ' + 'p'.repeat(40) },
    }),
    /403/u,
  );
  const worker = await f.app.injectWS('/image-generation', {
    headers: { host: 'localhost', origin, authorization: 'Bearer ' + 'i'.repeat(40) },
  });
  f.sockets.push(worker);
  const devices = await f.app.inject({ url: '/api/admin/devices', headers });
  assert.equal(devices.json().imageGeneration.connected, true);
});

test('le mode et le modèle de vision locale se règlent par l’admin et se publient', async (t) => {
  const f = await fixture(t);
  const admin = await f.login();
  const kiosk = await f.kiosk();
  const headers = { origin, cookie: admin };
  assert.equal(
    (await f.app.inject({ url: '/api/admin/devices', headers })).json().perception.vision.mode,
    'scene',
  );
  assert.equal(
    (await f.app.inject({ url: '/api/admin/devices', headers })).json().perception.vision.modelId,
    '450m',
  );
  for (const [method, url, payload] of [
    ['PATCH', '/api/admin/vision', { mode: 'tool' }],
    ['PATCH', '/api/admin/vision', { mode: 'arrival' }],
    ['PATCH', '/api/admin/vision/model', { model: '3b' }],
    ['PATCH', '/api/admin/vision/model', { model: 'parfois' }],
    ['PATCH', '/api/admin/vision/device', { device: 'gpu' }],
  ] as const) {
    const denied = await f.app.inject({
      method,
      url,
      headers: { origin, cookie: kiosk },
      payload,
    });
    assert.equal(denied.statusCode, 401);
  }
  const invalid = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/vision',
    headers,
    payload: { mode: 'parfois' },
  });
  assert.equal(invalid.statusCode, 400);
  const invalidModel = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/vision/model',
    headers,
    payload: { model: 'parfois' },
  });
  assert.equal(invalidModel.statusCode, 400);
  const invalidDevice = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/vision/device',
    headers,
    payload: { device: 'parfois' },
  });
  assert.equal(invalidDevice.statusCode, 400);
  const accepted = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/vision',
    headers,
    payload: { mode: 'tool' },
  });
  assert.equal(accepted.statusCode, 200);
  const acceptedModel = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/vision/model',
    headers,
    payload: { model: '1.6b' },
  });
  assert.equal(acceptedModel.statusCode, 200);
  for (let attempt = 0; attempt < 100; attempt++) {
    const download = (await f.app.inject({ url: '/api/admin/devices', headers })).json().perception
      .vision.downloads['1.6b'];
    if (!['checking', 'downloading'].includes(download.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const acceptedDevice = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/vision/device',
    headers,
    payload: { device: 'cpu' },
  });
  assert.equal(acceptedDevice.statusCode, 200);
  const status = (await f.app.inject({ url: '/api/admin/devices', headers })).json().perception
    .vision;
  assert.equal(status.mode, 'tool');
  assert.equal(status.modelId, '1.6b');
  assert.equal(status.device, 'cpu');
});

test('le blocage OpenAI est réservé à l’administrateur et publié dans l’état', async (t) => {
  const f = await fixture(t);
  const url = '/api/admin/openai';
  const kiosk = await f.kiosk();
  const admin = await f.login();
  for (const [cookie, status] of [
    [undefined, 401],
    [kiosk, 401],
  ] as const) {
    const result = await f.app.inject({
      method: 'POST',
      url,
      headers: { origin, ...(cookie ? { cookie } : {}) },
      payload: { blocked: true },
    });
    assert.equal(result.statusCode, status);
  }
  const invalid = await f.app.inject({
    method: 'POST',
    url,
    headers: { origin, cookie: admin },
    payload: { blocked: 'true' },
  });
  assert.equal(invalid.statusCode, 400);
  for (const blocked of [true, false]) {
    const result = await f.app.inject({
      method: 'POST',
      url,
      headers: { origin, cookie: admin },
      payload: { blocked },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().state.openaiBlocked, blocked);
    assert.equal(f.controller.snapshot().state.openaiBlocked, blocked);
  }
});

test('les modules et les actions HTTP s’administrent sans accepter d’URL arbitraire', async (t) => {
  const f = await fixture(t);
  const kiosk = await f.kiosk();
  for (const url of ['/api/admin/addons', '/api/admin/actions']) {
    assert.equal((await f.app.inject({ url, headers: { cookie: kiosk } })).statusCode, 401);
  }
  const headers = { origin, cookie: await f.login() };
  const catalog = await f.app.inject({ url: '/api/admin/addons', headers });
  assert.equal(catalog.statusCode, 200);
  const definitions = catalog.json<{ definitions: { id: string; configSchema: unknown }[] }>()
    .definitions;
  assert.deepEqual(definitions.map((definition) => definition.id).sort(), [
    'clock',
    'ragator',
    'transit',
    'weather',
  ]);
  assert.ok(definitions.every((definition) => definition.configSchema));

  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/actions/confirmations/inconnue/approve',
        headers: { origin, cookie: kiosk },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/actions/confirmations/inconnue/approve',
        headers,
      })
    ).statusCode,
    404,
  );

  const invalid = await f.app.inject({
    method: 'POST',
    url: '/api/admin/addons/instances',
    headers,
    payload: {
      addonId: 'weather',
      profileId: null,
      ref: 'foyer',
      label: 'Météo',
      config: { insee: '75', lat: null, lon: null, days: 3 },
    },
  });
  assert.equal(invalid.statusCode, 400);
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/admin/addons/instances',
    headers,
    payload: {
      addonId: 'weather',
      profileId: null,
      ref: 'foyer',
      label: 'Météo',
      config: { insee: '75056', lat: null, lon: null, days: 3 },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const instance = created.json<{ id: string }>();
  const duplicate = await f.app.inject({
    method: 'POST',
    url: '/api/admin/addons/instances',
    headers,
    payload: {
      addonId: 'weather',
      profileId: null,
      ref: 'foyer',
      label: 'Météo bis',
      config: { insee: '75056', lat: null, lon: null, days: 3 },
    },
  });
  assert.equal(duplicate.statusCode, 400);
  const unknownAddon = await f.app.inject({
    method: 'POST',
    url: '/api/admin/addons/instances',
    headers,
    payload: {
      addonId: 'inconnu',
      profileId: null,
      ref: 'x',
      label: 'X',
      config: {},
    },
  });
  assert.equal(unknownAddon.statusCode, 404);
  assert.equal(
    (
      await f.app.inject({
        method: 'DELETE',
        url: `/api/admin/addons/instances/${instance.id}`,
        headers,
      })
    ).statusCode,
    200,
  );

  const badUrl = await f.app.inject({
    method: 'POST',
    url: '/api/admin/actions',
    headers,
    payload: {
      ref: 'portail',
      label: 'Portail',
      method: 'POST',
      url: 'javascript:alert(1)',
      profileId: null,
      headers: {},
      body: null,
      confirmation: 'required',
    },
  });
  assert.equal(badUrl.statusCode, 400);
  const action = await f.app.inject({
    method: 'POST',
    url: '/api/admin/actions',
    headers,
    payload: {
      ref: 'portail',
      label: 'Portail',
      method: 'POST',
      url: 'https://maison.example/portail',
      profileId: null,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      confirmation: 'required',
    },
  });
  assert.equal(action.statusCode, 201, action.body);
  const storedAction = action.json<{ id: string }>();
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `/api/admin/actions/${storedAction.id}`,
        headers,
        payload: { confirmation: 'none' },
      })
    ).json<{ confirmation: string }>().confirmation,
    'none',
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'DELETE',
        url: `/api/admin/actions/${storedAction.id}`,
        headers,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/admin/actions', headers })).json<unknown[]>().length,
    0,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/admin/actions/runs', headers: { cookie: kiosk } })).statusCode,
    401,
  );
  assert.deepEqual(
    (await f.app.inject({ url: '/api/admin/actions/runs', headers })).json<unknown[]>(),
    [],
  );
});

test('diagnostic logs are admin-only, validate reports and redact credentials', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject('/api/admin/logs')).statusCode, 401);
  const kiosk = await f.kiosk();
  assert.equal(
    (await f.app.inject({ url: '/api/admin/logs', headers: { cookie: kiosk } })).statusCode,
    401,
  );
  const report = await f.app.inject({
    method: 'POST',
    url: '/api/client-logs',
    headers: { origin, cookie: kiosk },
    payload: { event: 'error', stage: 'microphone', message: password },
  });
  assert.equal(report.statusCode, 200);
  const invalid = await f.app.inject({
    method: 'POST',
    url: '/api/client-logs',
    headers: { origin, cookie: kiosk },
    payload: { event: 'error', stage: 'microphone', sdp: 'private' },
  });
  assert.equal(invalid.statusCode, 400);
  const admin = await f.login();
  const result = await f.app.inject({ url: '/api/admin/logs', headers: { cookie: admin } });
  assert.equal(result.statusCode, 200);
  assert.ok(
    result.json().entries.some((entry: { source: string }) => entry.source === 'navigateur'),
  );
  assert.ok(!result.body.includes(password));
});

test('les sources et actions peuvent être créées désactivées ; les libellés blancs sont refusés', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  for (const [url, payload] of [
    [
      '/api/admin/addons/instances',
      {
        addonId: 'weather',
        profileId: null,
        ref: 'audit-weather',
        label: 'Météo audit',
        enabled: false,
        config: { insee: '75056', lat: null, lon: null, days: 3 },
      },
    ],
    [
      '/api/admin/actions',
      {
        ref: 'audit-action',
        label: 'Action audit',
        method: 'GET',
        url: 'http://127.0.0.1:3000/api/health',
        profileId: null,
        headers: {},
        body: null,
        confirmation: 'required',
        enabled: false,
      },
    ],
  ] as const) {
    const response = await f.app.inject({
      method: 'POST',
      url,
      headers: { origin, cookie },
      payload,
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().enabled, false);
    const invalid = await f.app.inject({
      method: 'POST',
      url,
      headers: { origin, cookie },
      payload: { ...payload, ref: 'blank-label', label: '   ' },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
  }
});

test('personnalisation : accès administrateur, validation, héritage et isolation', async (t) => {
  const f = await fixture(t);
  const route = '/api/admin/personality/';
  assert.equal((await f.app.inject({ url: route + 'household' })).statusCode, 401);
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: route + 'household',
        headers: { origin },
        payload: { instructions: 'Test' },
      })
    ).statusCode,
    401,
  );
  const cookie = await f.login();
  const headers = { origin, cookie };
  const alice = f.profiles.create('Alice');
  const bob = f.profiles.create('Bob');
  const save = (id: string, payload: unknown) =>
    f.app.inject({ method: 'PUT', url: route + id, headers, payload: payload as object });
  assert.equal((await save('household', { instructions: '  Humour léger  ' })).statusCode, 200);
  const personal = await save(alice.id, { instructions: 'Vouvoie-moi' });
  assert.equal(personal.statusCode, 200);
  assert.equal(personal.json().household, 'Humour léger');
  assert.equal(personal.json().personal, 'Vouvoie-moi');
  assert.match(personal.json().prompts[2].content, /Vouvoie-moi/);
  const other = (await f.app.inject({ url: route + bob.id, headers })).json();
  assert.equal(other.household, 'Humour léger');
  assert.equal(other.personal, '');
  assert.doesNotMatch(other.prompts[2].content, /Vouvoie-moi/);
  for (const payload of [
    { instructions: 'x'.repeat(4001) },
    { instructions: 1 },
    { instructions: '', extra: true },
    {},
  ]) {
    assert.equal((await save('household', payload)).statusCode, 400);
  }
  assert.equal((await save('missing', { instructions: 'Test' })).statusCode, 404);
  assert.equal((await f.app.inject({ url: route + 'missing', headers })).statusCode, 404);
  assert.equal((await save(alice.id, { instructions: '' })).json().personal, '');
  const publicState = (await f.app.inject({ url: '/api/state' })).body;
  assert.doesNotMatch(publicState, /Humour léger|Vouvoie-moi/);
});

test('contexte personnel : accès admin, validation, isolation et effacement indépendant du style', async (t) => {
  const f = await fixture(t);
  const sacha = f.profiles.create('Sacha');
  const other = f.profiles.create('Camille');
  const route = '/api/admin/personality/' + sacha.id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: route + '/context',
        headers: { origin },
        payload: { context: 'Pivoine' },
      })
    ).statusCode,
    401,
  );
  const headers = { origin, cookie: await f.login() };
  const save = (payload: object) =>
    f.app.inject({ method: 'PUT', url: route + '/context', headers, payload });
  for (const payload of [
    {},
    { context: 1 },
    { context: 'x'.repeat(4001) },
    { context: '', profileId: other.id },
  ]) {
    assert.equal((await save(payload)).statusCode, 400);
  }
  await f.app.inject({
    method: 'PUT',
    url: route,
    headers,
    payload: { instructions: 'Sois bref.' },
  });
  const changed = t.mock.method(f.controller, 'personalContextChanged');
  const result = await save({ context: '  Mon bureau est Pivoine.  ' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().personalContext, 'Mon bureau est Pivoine.');
  assert.equal(result.json().personal, 'Sois bref.');
  assert.match(result.json().prompts[2].content, /Pivoine/);
  assert.match(result.json().prompts[3].content, /Pivoine/);
  assert.equal(changed.mock.callCount(), 1);
  await save({ context: 'Mon bureau est Pivoine.' });
  assert.equal(changed.mock.callCount(), 1);
  for (const id of ['household', other.id]) {
    const view = (await f.app.inject({ url: '/api/admin/personality/' + id, headers })).json();
    assert.equal(view.personalContext, '');
    assert.doesNotMatch(JSON.stringify(view.prompts), /Pivoine/);
  }
  assert.doesNotMatch((await f.app.inject({ url: '/api/state' })).body, /Pivoine/);
  assert.doesNotMatch((await f.app.inject({ url: '/api/admin/logs', headers })).body, /Pivoine/);
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: route + '/context',
        headers: { ...headers, origin: 'http://evil.invalid' },
        payload: { context: '' },
      })
    ).statusCode,
    403,
  );
  const cleared = (await save({ context: '' })).json();
  assert.equal(cleared.personalContext, '');
  assert.equal(cleared.personal, 'Sois bref.');
  assert.doesNotMatch(cleared.prompts[2].content, /Pivoine/);
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: '/api/admin/personality/household/context',
        headers,
        payload: { context: 'Non' },
      })
    ).statusCode,
    404,
  );
});

test('les délais sont validés, réservés à l’administration et diffusés aux autres administrateurs', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login();
  const headers = { origin, cookie };
  const url = '/api/admin/presence-timings';
  const defaults = {
    presenceMs: 400,
    absenceMs: 1500,
    engagementMs: 350,
    disengagementMs: 8000,
    identityHoldMs: 8000,
  };
  const settings = {
    presenceMs: 600,
    absenceMs: 4500,
    engagementMs: 750,
    disengagementMs: 12000,
    identityHoldMs: 6000,
  };
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url, headers: { origin }, payload: settings }))
      .statusCode,
    401,
  );
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url, headers: { cookie }, payload: settings }))
      .statusCode,
    403,
  );
  for (const payload of [
    {},
    { ...settings, absenceMs: -1 },
    { ...settings, absenceMs: 30001 },
    { ...settings, presenceMs: 5001 },
    { ...settings, engagementMs: 5001 },
    { ...settings, disengagementMs: 60001 },
    { ...settings, identityHoldMs: 60001 },
    { ...settings, identityHoldMs: undefined },
    { ...settings, absenceMs: 0.5 },
    { ...settings, absenceMs: '4500' },
    { ...settings, sensorMs: 99999 },
  ]) {
    assert.equal((await f.app.inject({ method: 'PATCH', url, headers, payload })).statusCode, 400);
    assert.deepEqual(f.controller.getPresenceTimings(), defaults);
  }
  const { socket } = await f.connect('admin', cookie);
  const updated = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Réglages non diffusés.')), 2000);
    socket.on('message', (raw) => {
      const event = JSON.parse(String(raw));
      if (event.type === 'devices' && event.status.presenceTimings?.absenceMs === 4500) {
        clearTimeout(timer);
        resolve(event.status.presenceTimings);
      }
    });
  });
  const response = await f.app.inject({ method: 'PATCH', url, headers, payload: settings });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), settings);
  assert.deepEqual(await updated, settings);
  assert.deepEqual(
    (await f.app.inject({ url: '/api/admin/devices', headers })).json().presenceTimings,
    settings,
  );
});

test('son d’ouverture : accès administrateur, validation et diffusion', async (t) => {
  const f = await fixture(t);
  const url = '/api/admin/admission-sound';
  const payload = { enabled: true, sound: 'cristal' };
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url, headers: { origin }, payload })).statusCode,
    401,
  );
  const cookie = await f.login();
  const headers = { origin, cookie };
  for (const invalid of [
    {},
    { enabled: true },
    { enabled: 'oui', sound: 'cristal' },
    { enabled: true, sound: 'sirène' },
    { ...payload, volume: 1 },
  ])
    assert.equal(
      (await f.app.inject({ method: 'PATCH', url, headers, payload: invalid })).statusCode,
      400,
    );
  const response = await f.app.inject({ method: 'PATCH', url, headers, payload });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json<StateEvent>().state.admissionSound, payload);
  assert.deepEqual(f.controller.snapshot().state.admissionSound, payload);
});

test('ouverture : accès administrateur, validation et état persistant', async (t) => {
  const f = await fixture(t);
  const url = '/api/admin/opening';
  const payload = { trigger: 'voice', audience: 'everyone', recognizeVoice: false };
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url, headers: { origin }, payload })).statusCode,
    401,
  );
  const headers = { origin, cookie: await f.login() };
  for (const invalid of [
    { ...payload, trigger: 'wake' },
    { ...payload, audience: 'all' },
    { ...payload, recognizeVoice: 'oui' },
    { ...payload, mode: 4 },
  ])
    assert.equal(
      (await f.app.inject({ method: 'PATCH', url, headers, payload: invalid })).statusCode,
      400,
    );
  // Les anciennes routes, qui permettaient des combinaisons en double, n’existent plus.
  for (const legacy of ['session-mode', 'wake-word', 'known-people-only', 'voice-recognition'])
    assert.equal(
      (
        await f.app.inject({
          method: 'PATCH',
          url: '/api/admin/' + legacy,
          headers,
          payload: { enabled: true },
        })
      ).statusCode,
      404,
    );
  const response = await f.app.inject({ method: 'PATCH', url, headers, payload });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json<StateEvent>().state.wakeWord.enabled, true);
  const state = (await f.app.inject('/api/state')).json<StateEvent>().state;
  assert.deepEqual(state.opening, payload);
  assert.equal(state.session.mode, 4);
});

test('délégation : accès admin, validation stricte et publication des trois modes', async (t) => {
  const f = await fixture(t);
  const url = '/api/admin/delegation-mode';
  assert.equal((await f.app.inject('/api/state')).json().state.delegationMode, 'fast');
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url,
        headers: { origin },
        payload: { mode: 'ultrafast' },
      })
    ).statusCode,
    401,
  );
  const headers = { origin, cookie: await f.login() };
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url,
        headers: { cookie: headers.cookie },
        payload: { mode: 'ultrafast' },
      })
    ).statusCode,
    403,
  );
  for (const payload of [
    {},
    { mode: 'priority' },
    { mode: null },
    { mode: 'normal', model: 'arbitrary' },
  ]) {
    assert.equal((await f.app.inject({ method: 'PATCH', url, headers, payload })).statusCode, 400);
  }
  for (const mode of ['normal', 'ultrafast', 'fast']) {
    const response = await f.app.inject({ method: 'PATCH', url, headers, payload: { mode } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().state.delegationMode, mode);
    assert.equal((await f.app.inject('/api/state')).json().state.delegationMode, mode);
  }
});

test('tampon audio avancé : accès admin, validation et état publié', async (t) => {
  const f = await fixture(t);
  const url = '/api/admin/advanced-audio-buffer';
  assert.equal((await f.app.inject('/api/state')).json().state.advancedAudioBuffer, false);
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url, headers: { origin }, payload: { enabled: true } }))
      .statusCode,
    401,
  );
  const headers = { origin, cookie: await f.login() };
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url, headers, payload: { enabled: 'oui' } })).statusCode,
    400,
  );
  const enabled = await f.app.inject({ method: 'PATCH', url, headers, payload: { enabled: true } });
  assert.equal(enabled.statusCode, 200, enabled.body);
  assert.equal(enabled.json().state.advancedAudioBuffer, true);
  assert.equal((await f.app.inject('/api/state')).json().state.advancedAudioBuffer, true);
  const disabled = await f.app.inject({
    method: 'PATCH',
    url,
    headers,
    payload: { enabled: false },
  });
  assert.equal(disabled.json().state.advancedAudioBuffer, false);
});

test('mode voix : caméra éteinte sans reconnaissance, allumée en permanence avec elle', async (t) => {
  const f = await fixture(t);
  const admin = await f.login();
  const headers = { origin, cookie: admin };
  const worker = await f.app.injectWS('/perception', {
    headers: { host: 'localhost', origin, authorization: 'Bearer ' + 'p'.repeat(40) },
  });
  f.sockets.push(worker);
  const toggles: boolean[] = [];
  worker.on('message', (data: Buffer, binary: boolean) => {
    if (binary) return;
    const event = JSON.parse(String(data)) as { type: string; enabled?: boolean };
    if (event.type === 'camera_enabled') toggles.push(event.enabled!);
  });
  const patch = (url: string, payload: Record<string, unknown>) =>
    f.app.inject({ method: 'PATCH', url, headers, payload });
  const voice = { trigger: 'voice', audience: 'everyone', recognizeVoice: false };
  assert.equal((await patch('/api/admin/opening', voice)).statusCode, 200);
  assert.equal((await patch('/api/admin/vision', { mode: 'off' })).statusCode, 200);
  await setImmediate();
  assert.deepEqual(toggles, [false], 'veille du mode voix : caméra éteinte');

  // Une conversation sans reconnaissance ni vision n’allume pas la caméra.
  const kiosk = await f.kiosk();
  const mirror = await f.connect('kiosk', kiosk);
  mirror.socket.send(JSON.stringify({ type: 'media_ready', ready: true }));
  await setImmediate();
  const start = () =>
    f.app.inject({ method: 'POST', url: '/api/commands', headers, payload: { type: 'start' } });
  assert.equal((await start()).json<StateEvent>().state.session.phase, 'connecting');
  await setImmediate();
  assert.deepEqual(toggles, [false]);
  f.controller.close('Fin du premier essai.');
  f.controller.sessionClosed(f.controller.scope().interactionId!);

  const enabled = await patch('/api/admin/opening', { ...voice, recognizeVoice: true });
  assert.equal(enabled.json<StateEvent>().state.voiceRecognition, true);
  await setImmediate();
  assert.deepEqual(
    toggles,
    [false, true],
    'avec la reconnaissance, la caméra guette dès la veille',
  );
  f.controller.heartbeat();
  assert.equal((await start()).json<StateEvent>().state.session.phase, 'connecting');
  await setImmediate();
  assert.deepEqual(toggles, [false, true], 'déjà allumée : aucun redémarrage à l’ouverture');
  f.controller.close('Fin du second essai.');
  f.controller.sessionClosed(f.controller.scope().interactionId!);
  await setImmediate();
  assert.deepEqual(toggles, [false, true], 'retour à la veille : la caméra reste allumée');

  // Les réglages de la fin de parole sont validés et diffusés.
  assert.equal(
    (await patch('/api/admin/silence-close', { enabled: true, delayMs: 2000 })).statusCode,
    400,
  );
  const silence = await patch('/api/admin/silence-close', { enabled: true, delayMs: 30_000 });
  assert.deepEqual(silence.json<StateEvent>().state.silenceClose, {
    enabled: true,
    delayMs: 30_000,
  });

  // « Cornelius » réservé aux membres : la caméra veille pour savoir qui parle.
  assert.equal(
    (await patch('/api/admin/opening', { trigger: 'voice', audience: 'members' })).statusCode,
    400,
  );
  const members = (
    await patch('/api/admin/opening', {
      trigger: 'voice',
      audience: 'members',
      recognizeVoice: false,
    })
  ).json<StateEvent>().state;
  assert.equal(members.session.mode, 2);
  assert.equal(members.wakeWord.enabled, true);
  assert.equal(members.knownPeopleOnly, false);
  assert.deepEqual(members.opening, {
    trigger: 'voice',
    audience: 'members',
    recognizeVoice: false,
  });
  await setImmediate();
  assert.equal(toggles.at(-1), true, 'caméra allumée en veille');
  const everyone = (
    await patch('/api/admin/opening', {
      trigger: 'voice',
      audience: 'everyone',
      recognizeVoice: true,
    })
  ).json<StateEvent>().state;
  assert.equal(everyone.session.mode, 4);
  assert.equal(everyone.voiceRecognition, true);
  await setImmediate();
  assert.equal(toggles.at(-1), true, 'avec la reconnaissance, caméra allumée en veille');
  await patch('/api/admin/opening', {
    trigger: 'voice',
    audience: 'everyone',
    recognizeVoice: false,
  });
  await setImmediate();
  assert.equal(toggles.at(-1), false, 'sans reconnaissance, caméra éteinte en veille');
});

test('browser camera is opt-in, admin configured, same-origin and reserved to the active mirror', async (t) => {
  const f = await fixture(t);
  const admin = await f.login();
  const cookie = await f.kiosk();
  const headers = { origin, cookie: admin };
  const url = '/api/admin/camera/source';
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url,
        headers: { host: 'localhost', origin, cookie },
        payload: { source: 'browser' },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await f.app.inject({ method: 'PUT', url, headers, payload: { source: 'other' } })).statusCode,
    400,
  );
  await assert.rejects(
    f.app.injectWS('/camera-stream', { headers: { host: 'localhost', origin, cookie } }),
    /403/,
  );
  const kiosk = await f.connect('kiosk', cookie);
  const worker = await f.app.injectWS('/perception', {
    headers: { host: 'localhost', origin, authorization: 'Bearer ' + 'p'.repeat(40) },
  });
  f.sockets.push(worker);
  const messages: { type: string; source?: string }[] = [];
  worker.on('message', (data, binary) => {
    if (!binary) messages.push(JSON.parse(String(data)));
  });
  assert.equal(
    (await f.app.inject({ method: 'PUT', url, headers, payload: { source: 'browser' } }))
      .statusCode,
    200,
  );
  await setImmediate();
  assert.ok(messages.some((event) => event.type === 'camera_source' && event.source === 'browser'));
  assert.equal(
    (await f.app.inject({ url: '/api/admin/devices', headers })).json().perception.camera.source,
    'browser',
  );
  await assert.rejects(f.app.injectWS('/camera-stream', { headers: { cookie } }), /403/);
  await assert.rejects(
    f.app.injectWS('/camera-stream', { headers: { origin: 'http://evil.invalid', cookie } }),
    /403/,
  );
  // An older worker must not silently fall back to a server camera.
  await assert.rejects(
    f.app.injectWS('/camera-stream', { headers: { host: 'localhost', origin, cookie } }),
    /403/,
  );
  worker.send(JSON.stringify({ type: 'camera_source_status', source: 'browser' }));
  await setImmediate();
  await f.app.inject({ method: 'POST', url: '/api/admin/camera/hold', headers });
  const stream = await f.app.injectWS('/camera-stream', {
    headers: { host: 'localhost', origin, cookie },
  });
  f.sockets.push(stream);
  const frame = Buffer.from([0x43, 0, 0, 0, 7, 255, 216, 1, 2, 255, 217]);
  const received = once(worker, 'message', { signal: AbortSignal.timeout(2000) });
  stream.send(frame);
  const [data, binary] = await received;
  assert.equal(binary, true);
  assert.deepEqual(data, frame);
  const ack = once(stream, 'message', { signal: AbortSignal.timeout(2000) });
  worker.send(JSON.stringify({ type: 'camera_frame_ack', sequence: 7, accepted: true }));
  const [ackData] = await ack;
  assert.deepEqual(JSON.parse(String(ackData)), { type: 'camera_ack', sequence: 7 });
  const closed = once(stream, 'close', { signal: AbortSignal.timeout(2000) });
  await f.connect('kiosk', cookie);
  await closed;
  assert.equal(kiosk.socket.readyState >= 2, true);
  assert.equal(
    (await f.app.inject({ method: 'PUT', url, headers, payload: { source: 'server' } })).statusCode,
    200,
  );
});
