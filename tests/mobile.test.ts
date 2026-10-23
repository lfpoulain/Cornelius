import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebSocket } from 'ws';
import { MobileStore } from '../server/mobile-store.js';
import { openDatabase, ProfileRepository, SessionPreferences } from '../server/storage.js';
import { createApp } from '../server/app.js';
import { SessionController, type SessionTransport } from '../server/controller.js';
import { mobilePath } from '../shared/mobile.js';
import { createMobileProxy } from '../server/mobile-ingress.js';
import { LiveTransport } from '../server/live/transport.js';
import type { LiveGateway } from '../server/live/gateway.js';
import type { StateEvent } from '../shared/types.js';
import { validateObservation } from '../shared/commands.js';

test('mobile association: one use, expiry, hashed credentials, restart identity, revocation', () => {
  const db = openDatabase(':memory:');
  try {
    let now = 1000;
    const store = new MobileStore(db, () => now);
    const invitation = store.invite();
    const credential = store.pair(invitation.invitation, 'iPhone')!;
    assert.ok(credential);
    assert.equal(store.pair(invitation.invitation, 'duplicate'), null);
    assert.equal(store.authenticate(credential.token)?.id, credential.deviceId);
    assert.equal(
      JSON.stringify(db.prepare('SELECT * FROM mobile_devices').all()).includes(credential.token),
      false,
    );
    const second = store.invite();
    now += 300_000;
    assert.equal(store.pair(second.invitation, 'expired'), null);
    assert.equal(new MobileStore(db, () => now).serverId, store.serverId);
    assert.equal(new MobileStore(db, () => now).pair(store.invite().invitation, 'restart'), null);
    store.remove(credential.deviceId);
    assert.equal(store.authenticate(credential.token), null);
  } finally {
    db.close();
  }
});

test('discovered pairing requires approval, expires, rejects wrong secrets and cannot be replayed', () => {
  const db = openDatabase(':memory:');
  let now = 1000;
  const store = new MobileStore(db, () => now);
  try {
    const pending = store.requestPairing('iPhone')!;
    assert.equal(store.list().length, 0);
    assert.equal(store.pairingStatus(pending.id, 'wrong'), null);
    assert.deepEqual(store.pairingStatus(pending.id, pending.secret), { status: 'pending' });
    assert.equal(store.pendingRequests()[0]!.code, pending.code);
    assert.equal(JSON.stringify(store.pendingRequests()).includes(pending.secret), false);
    assert.equal(store.decidePairing(pending.id, true), true);
    assert.equal(store.decidePairing(pending.id, true), false);
    const status = store.pairingStatus(pending.id, pending.secret)!;
    assert.equal(status.status, 'approved');
    assert.equal(store.pairingStatus(pending.id, pending.secret), null);
    if (status.status !== 'approved') throw new Error('Expected approval');
    const credential = store.pair(status.invitation, 'iPhone')!;
    assert.ok(store.authenticate(credential.token));
    assert.equal(store.pair(status.invitation, 'Replay'), null);
    store.remove(credential.deviceId);
    assert.equal(store.authenticate(credential.token), null);
    const rejected = store.requestPairing('Other')!;
    store.decidePairing(rejected.id, false);
    assert.deepEqual(store.pairingStatus(rejected.id, rejected.secret), { status: 'rejected' });
    const expired = store.requestPairing('Old')!;
    now += 300_000;
    assert.equal(store.decidePairing(expired.id, true), false);
    assert.equal(store.pairingStatus(expired.id, expired.secret), null);
    assert.equal(store.pendingRequests().length, 0);
  } finally {
    db.close();
  }
});

test('discovered pairing endpoints require matching identity and admin approval', async (t) => {
  const f = await fixture(t);
  const admin = (await f.app.inject({ url: '/api/admin/mobile', headers: f.headers })).json();
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/mobile/requests',
        payload: { name: 'Phone', serverId: 'wrong' },
      })
    ).statusCode,
    400,
  );
  const pending = (
    await f.app.inject({
      method: 'POST',
      url: '/mobile/requests',
      payload: { name: 'Phone', serverId: admin.serverId },
    })
  ).json();
  const poll = () =>
    f.app.inject({
      method: 'POST',
      url: '/mobile/requests/status',
      payload: { id: pending.id, secret: pending.secret },
    });
  assert.equal((await poll()).json().status, 'pending');
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/mobile/requests/' + pending.id,
        payload: { approve: true },
      })
    ).statusCode,
    403,
  );
  assert.equal((await poll()).json().status, 'pending');
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/mobile/requests/' + pending.id,
        headers: f.headers,
        payload: { approve: true },
      })
    ).statusCode,
    200,
  );
  const approved = (await poll()).json();
  assert.equal(approved.serverId, admin.serverId);
  assert.equal(approved.status, 'approved');
  assert.equal((await poll()).statusCode, 404);
  const paired = await f.app.inject({
    method: 'POST',
    url: '/mobile/pair',
    payload: { name: 'Phone', invitation: approved.invitation },
  });
  assert.equal(paired.statusCode, 200);
  assert.equal(
    (
      await f.app.inject({
        url: '/mobile/info',
        headers: { authorization: 'Bearer ' + paired.json().token },
      })
    ).statusCode,
    200,
  );
});

test('proxy allowlist cannot expose admin, workers, web, traversal or prefix lookalikes', () => {
  for (const url of [
    '/admin',
    '/api/login',
    '/perception',
    '/image-generation',
    '/mobile/../admin',
    '/mobile/%2e%2e/admin',
    '/mobile/info/admin',
    '/mobile/events-evil',
    '/mobile//events',
    '/mobile/images/../secret.webp',
  ])
    assert.equal(mobilePath(url), false, url);
  for (const url of [
    '/mobile/pair',
    '/mobile/info',
    '/mobile/events?generation=example',
    '/mobile/audio',
    '/mobile/camera',
    '/mobile/images/abc-123.webp',
  ])
    assert.equal(mobilePath(url), true, url);
});

async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'cornelius-mobile-test-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      adminPassword: 'test-password',
      origins: ['http://localhost'],
      secureCookies: false,
      tlsKeyFingerprint: 'AB:'.repeat(31) + 'AB',
      lan: true,
      httpsPort: 3443,
    },
    { timers: false, imageGenerationRoot: root },
  );
  await services.app.ready();
  const sockets: WebSocket[] = [];
  t.after(async () => {
    sockets.forEach((s) => s.terminate());
    await setImmediate();
    await services.app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin: 'http://localhost' },
    payload: { password: 'test-password' },
  });
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const headers = { cookie, origin: 'http://localhost' };
  async function pair() {
    const response = await services.app.inject({
      method: 'POST',
      url: '/api/admin/mobile/invitations',
      headers,
      payload: { localUrl: 'https://mirror.local:3443' },
    });
    assert.equal(response.statusCode, 200);
    const invitation = response.json();
    assert.match(invitation.svg, /^<svg/u);
    const result = await services.app.inject({
      method: 'POST',
      url: '/mobile/pair',
      payload: { invitation: invitation.invitation.invitation, name: 'iPhone test' },
    });
    assert.equal(result.statusCode, 200);
    return result.json() as { token: string; deviceId: string };
  }
  return { ...services, headers, sockets, pair };
}

test('mobile: token required even on loopback; no browser Origin needed with bearer; revocation immediate', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject('/mobile/info')).statusCode, 401);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/admin/mobile/invitations', payload: {} }))
      .statusCode,
    403,
  );
  const credential = await f.pair();
  const headers = { host: 'localhost', authorization: 'Bearer ' + credential.token };
  assert.equal((await f.app.inject({ url: '/mobile/info', headers })).statusCode, 200);
  assert.equal((await f.app.inject({ url: '/mobile/images/old.webp', headers })).statusCode, 404);
  const events = await f.app.injectWS('/mobile/events', { headers });
  f.sockets.push(events);
  const generation = f.controller.mobileMirror()!.generation;
  const camera = await f.app.injectWS('/mobile/camera?generation=' + generation, { headers });
  f.sockets.push(camera);
  const closed = once(events, 'close');
  await f.app.inject({
    method: 'DELETE',
    url: '/api/admin/mobile/devices/' + credential.deviceId,
    headers: f.headers,
  });
  await closed;
  assert.equal(f.controller.mobileMirror(), null);
  assert.equal((await f.app.inject({ url: '/mobile/info', headers })).statusCode, 401);
});

test('web and mobile share one owner; old native camera cannot send after takeover', async (t) => {
  const f = await fixture(t),
    credential = await f.pair();
  const headers = { host: 'localhost', authorization: 'Bearer ' + credential.token };
  const first = await f.app.injectWS('/mobile/events', { headers });
  f.sockets.push(first);
  assert.ok(f.controller.mobileMirror());
  const closed = once(first, 'close');
  const web = await f.app.injectWS('/events', {
    headers: { origin: 'http://localhost', host: 'localhost' },
  });
  f.sockets.push(web);
  await closed;
  assert.equal(f.controller.mobileMirror(), null);
  assert.equal(f.controller.snapshot().state.browserAudioReady, false);
});

test('background: only admitted session continues, fresh camera cannot change identity, silence ends it', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let now = 10000;
  const profiles = new ProfileRepository(db),
    prefs = new SessionPreferences(db);
  prefs.setSessionMode(4);
  const transport: SessionTransport = { open() {}, close() {} };
  const controller = new SessionController(profiles, transport, () => now, prefs);
  controller.setMobileMirror({ deviceId: 'phone', generation: 'native', background: false });
  controller.heartbeat();
  controller.setBrowserAudioReady(true);
  controller.setWakeWordAvailability(true, null);
  assert.equal(controller.wakeDetected(), true);
  const scope = controller.scope();
  controller.controlAttached(scope);
  controller.sessionStarted(scope);
  assert.equal(controller.sessionState().phase, 'ready');
  controller.setMobileBackground(true);
  assert.equal(controller.memoryProfileId(), null);
  controller.observe({
    schemaVersion: 1,
    producerBootId: 'stale',
    sequence: 1,
    observedAt: now,
    health: 'ok',
    presence: true,
    engaged: true,
    people: [{ trackId: 'old', profileId: null }],
  });
  for (let i = 0; i < 19; i++) {
    now += 1000;
    controller.heartbeat();
    controller.tick();
  }
  assert.equal(controller.sessionState().phase, 'ready');
  now += 1001;
  controller.heartbeat();
  controller.tick();
  assert.notEqual(controller.sessionState().phase, 'ready');
  controller.command({ type: 'start' });
  assert.notEqual(controller.sessionState().phase, 'connecting');
});

test('native relay opens PCM Live with screen tools and never calls WebRTC', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let handlers: Parameters<NonNullable<LiveGateway['connect']>>[1] | null = null;
  let config: Parameters<NonNullable<LiveGateway['connect']>>[0] | null = null;
  const sent: Buffer[] = [];
  const gateway: LiveGateway = {
    create: async () => {
      throw new Error('WebRTC must not run');
    },
    attach: () => {
      throw new Error('sideband must not run');
    },
    connect(value, listener) {
      config = value;
      handlers = listener;
      return {
        send() {},
        dispose() {},
        sendAudio(pcm) {
          sent.push(pcm);
        },
      };
    },
  };
  const live = new LiveTransport(gateway);
  t.after(() => live.dispose());
  const profiles = new ProfileRepository(db),
    prefs = new SessionPreferences(db);
  prefs.setSessionMode(4);
  const controller = new SessionController(profiles, live, Date.now, prefs);
  live.attach(controller);
  controller.setMobileMirror({
    deviceId: 'phone',
    generation: 'native-generation',
    background: false,
  });
  controller.heartbeat();
  controller.setBrowserAudioReady(true);
  controller.setWakeWordAvailability(true, null);
  controller.wakeDetected();
  assert.ok(config);
  assert.ok(handlers);
  assert.deepEqual((config as { audio: { format: unknown } }).audio.format, {
    type: 'audio/pcm',
    rate: 16000,
  });
  (handlers as Parameters<LiveGateway['attach']>[1]).event({
    type: 'session.started',
    session: { id: 'test' },
  } as never);
  live.mobileAudio('wrong-generation', Buffer.alloc(2560));
  assert.equal(sent.length, 0);
  live.mobileAudio('native-generation', Buffer.alloc(2560));
  assert.equal(sent.length, 1);
});

test('Swift fixture preserves card scope and a valid recognition observation', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../ios/Cornelius/Resources/mirror-fixture.json', import.meta.url),
      'utf8',
    ),
  ) as StateEvent;
  assert.equal(fixture.schemaVersion, 1);
  for (const card of fixture.state.cards)
    assert.deepEqual(
      [card.interactionId, card.profileEpoch, card.contextVersion],
      [
        fixture.state.session.interactionId,
        fixture.state.session.profileEpoch,
        fixture.state.session.contextVersion,
      ],
    );
  assert.equal(
    validateObservation({
      schemaVersion: 1,
      producerBootId: fixture.bootId,
      sequence: 1,
      observedAt: fixture.sentAt,
      health: fixture.state.presence.health,
      presence: true,
      engaged: true,
      people: fixture.state.presence.people.map(({ trackId, profileId }) => ({
        trackId,
        profileId,
      })),
    }),
    true,
  );
});

test('actual proxy ingress refuses web/admin and requires bearer even with an administrator cookie', async (t) => {
  const f = await fixture(t);
  const proxy = createMobileProxy(f.app);
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });
  const address = proxy.address() as { port: number };
  const base = 'http://127.0.0.1:' + address.port;
  for (const path of ['/admin', '/api/admin/mobile', '/perception', '/image-generation'])
    assert.equal((await fetch(base + path, { headers: { cookie: f.headers.cookie } })).status, 404);
  assert.equal(
    (
      await fetch(base + '/mobile/info', {
        headers: { cookie: f.headers.cookie, 'x-cornelius-mobile': 'true' },
      })
    ).status,
    401,
  );
  const credential = await f.pair();
  assert.equal(
    (
      await fetch(base + '/mobile/info', {
        headers: { authorization: 'Bearer ' + credential.token },
      })
    ).status,
    200,
  );
});

test('foreground return allows camera warmup without fabricating recognized observations', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let now = 10000;
  const profiles = new ProfileRepository(db),
    prefs = new SessionPreferences(db);
  prefs.setSessionMode(1);
  const controller = new SessionController(profiles, { open() {}, close() {} }, () => now, prefs);
  controller.setMobileMirror({ deviceId: 'phone', generation: 'native', background: false });
  controller.heartbeat();
  controller.setBrowserAudioReady(true);
  const observe = (sequence: number) =>
    controller.observe({
      schemaVersion: 1,
      producerBootId: 'native',
      sequence,
      observedAt: now,
      health: 'ok',
      presence: true,
      engaged: true,
      people: [{ trackId: 'visitor', profileId: null }],
    });
  observe(1);
  now += 1000;
  controller.heartbeat();
  observe(2);
  const scope = controller.scope();
  controller.controlAttached(scope);
  controller.sessionStarted(scope);
  assert.equal(controller.sessionState().phase, 'ready');
  controller.setMobileBackground(true);
  now += 5000;
  controller.heartbeat();
  controller.tick();
  controller.setMobileBackground(false);
  controller.tick();
  assert.equal(controller.sessionState().phase, 'ready');
  assert.equal(controller.memoryProfileId(), null);
  now += 1000;
  controller.heartbeat();
  observe(3);
  controller.tick();
  assert.equal(controller.sessionState().phase, 'ready');
});

test('worker observations from a retired phone generation never reach the controller', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cornelius-mobile-source-test-'));
  const f = await createApp(
    {
      databasePath: ':memory:',
      adminPassword: 'test-source-password',
      origins: ['http://localhost'],
      secureCookies: false,
      perceptionToken: 'p'.repeat(40),
    },
    { timers: false, imageGenerationRoot: root },
  );
  await f.app.ready();
  const sockets: WebSocket[] = [];
  t.after(async () => {
    sockets.forEach((s) => s.terminate());
    await setImmediate();
    await f.app.close();
    rmSync(root, { recursive: true, force: true });
  });
  // A simulator worker uses the protected local worker path, not the native path.
  const worker = await f.app.injectWS('/perception', {
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      authorization: 'Bearer ' + 'p'.repeat(40),
    },
  });
  sockets.push(worker);
  const observedAt = Date.now();
  const observation = {
    schemaVersion: 1,
    producerBootId: 'test-camera',
    sequence: 1,
    observedAt,
    health: 'ok',
    presence: true,
    engaged: true,
    people: [{ trackId: 'visitor', profileId: null }],
  };
  worker.send(JSON.stringify({ type: 'observation', generation: 'retired-phone', observation }));
  await setImmediate();
  assert.equal(f.controller.memoryObservedAt(), null);
  worker.send(JSON.stringify({ type: 'observation', observation }));
  await setImmediate();
  assert.equal(f.controller.memoryObservedAt(), observedAt);
});
