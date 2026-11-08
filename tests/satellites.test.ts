import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import type { WebSocket } from 'ws';
import { createApp } from '../server/app.js';
import { openDatabase, ProfileRepository } from '../server/storage.js';
import { SatelliteStore } from '../server/satellites-store.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-test-1234';
const perceptionToken = 'p'.repeat(40);

async function fixture(t: TestContext, options: { now?: () => number } = {}) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-satellites-images-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      openaiKey: 'test-key',
      perceptionToken,
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: password,
      origins: [origin],
      secureCookies: false,
    },
    { timers: false, imageGenerationRoot: imageRoot, now: options.now },
  );
  await services.app.ready();
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await setImmediate();
    await services.app.close();
    rmdirSync(imageRoot);
  });
  async function admin() {
    const response = await services.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin },
      payload: { password },
    });
    const entry = response.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
    return `${entry.name}=${entry.value}`;
  }
  /** Messages reçus par une connexion, texte décodé ou trame binaire. */
  function inbox(socket: WebSocket) {
    const received: unknown[] = [];
    const waiters: (() => void)[] = [];
    socket.on('message', (data, binary) => {
      received.push(binary ? Buffer.from(data as Buffer) : JSON.parse(String(data)));
      for (const wake of waiters.splice(0)) wake();
    });
    return {
      received,
      async next(predicate: (message: any) => boolean): Promise<any> {
        const deadline = Date.now() + 2000;
        for (;;) {
          const found = received.find(predicate);
          if (found !== undefined) return found;
          if (Date.now() > deadline) throw new Error('Message attendu non reçu.');
          await new Promise<void>((resolve) => {
            waiters.push(resolve);
            setTimeout(resolve, 50);
          });
        }
      },
    };
  }
  async function satellite(token: string) {
    const socket = await services.app.injectWS('/satellite', {
      headers: { host: 'localhost', authorization: 'Bearer ' + token },
    });
    sockets.push(socket);
    return { socket, ...inbox(socket) };
  }
  async function perception() {
    const socket = await services.app.injectWS('/perception', {
      headers: { host: 'localhost', origin, authorization: 'Bearer ' + perceptionToken },
    });
    sockets.push(socket);
    return { socket, ...inbox(socket) };
  }
  return { ...services, admin, satellite, perception };
}

test('registre : jeton montré une fois, empreinte seule gardée, révocation', () => {
  const db = openDatabase(':memory:');
  const profiles = new ProfileRepository(db);
  const store = new SatelliteStore(db, () => 1000);
  const { satellite, token } = store.create('Chambre');
  assert.deepEqual(satellite, {
    id: satellite.id,
    name: 'Chambre',
    profileId: null,
    volume: 70,
    ledColor: '#00ffb4',
    ledBrightness: 6,
    nightLight: false,
    attentive: false,
    silenceCloseMs: null,
    createdAt: 1000,
    lastSeenAt: null,
  });
  // Fin de parole propre : gardée à part, retirée par null, effacée avec le satellite.
  assert.equal(store.update(satellite.id, { silenceCloseMs: 5000 })?.silenceCloseMs, 5000);
  assert.equal(store.authenticate(token)?.silenceCloseMs, 5000);
  assert.equal(store.list()[0]?.silenceCloseMs, 5000);
  assert.equal(store.update(satellite.id, { nightLight: false })?.silenceCloseMs, 5000);
  assert.equal(store.update(satellite.id, { silenceCloseMs: null })?.silenceCloseMs, null);
  // Réglages de l’administration : enregistrés, et les autres champs restent intacts.
  const tuned = store.update(satellite.id, {
    ledColor: '#2f7bff',
    ledBrightness: 0,
    nightLight: true,
    attentive: true,
  })!;
  assert.deepEqual(
    [tuned.ledColor, tuned.ledBrightness, tuned.nightLight, tuned.attentive, tuned.volume],
    ['#2f7bff', 0, true, true, 70],
  );
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM satellites').all()).includes(token), false);
  assert.equal(store.authenticate(token)?.id, satellite.id);
  assert.equal(store.authenticate(token + 'x'), null);
  assert.equal(store.authenticate(''), null);
  const renewed = store.renewToken(satellite.id)!;
  assert.equal(store.authenticate(token), null);
  assert.equal(store.authenticate(renewed)?.id, satellite.id);
  // Un profil supprimé détache le satellite sans le supprimer.
  const profile = profiles.create('Léa');
  store.update(satellite.id, { profileId: profile.id, volume: 40 });
  assert.equal(store.get(satellite.id)?.profileId, profile.id);
  profiles.delete(profile.id);
  assert.deepEqual(
    [store.get(satellite.id)?.profileId, store.get(satellite.id)?.volume],
    [null, 40],
  );
  assert.equal(store.remove(satellite.id), true);
  assert.equal(store.authenticate(renewed), null);
  db.close();
});

test('administration des satellites : réservée, validée, jeton renouvelable', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject('/api/admin/satellites')).statusCode, 401);
  const cookie = await f.admin();
  const headers = { cookie, origin };
  const invalid = await f.app.inject({
    method: 'POST',
    url: '/api/admin/satellites',
    headers,
    payload: { name: '   ' },
  });
  assert.equal(invalid.statusCode, 400);
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/admin/satellites',
    headers,
    payload: { name: ' Cuisine ' },
  });
  assert.equal(created.statusCode, 200, created.body);
  const { satellite, token } = created.json();
  assert.equal(satellite.name, 'Cuisine');
  assert.equal(satellite.online, false);
  assert.equal(typeof token, 'string');
  const listed = await f.app.inject({ url: '/api/admin/satellites', headers });
  assert.equal(listed.body.includes(token), false);
  const unknownProfile = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/satellites/' + satellite.id,
    headers,
    payload: { profileId: 'absent' },
  });
  assert.equal(unknownProfile.statusCode, 400);
  const changed = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/satellites/' + satellite.id,
    headers,
    payload: { volume: 35 },
  });
  assert.equal(changed.json().satellite.volume, 35);
  const renewed = await f.app.inject({
    method: 'POST',
    url: `/api/admin/satellites/${satellite.id}/token`,
    headers,
  });
  assert.notEqual(renewed.json().token, token);
  await assert.rejects(f.satellite(token), /403/u);
  const removed = await f.app.inject({
    method: 'DELETE',
    url: '/api/admin/satellites/' + satellite.id,
    headers,
  });
  assert.equal(removed.statusCode, 200);
  await assert.rejects(f.satellite(renewed.json().token), /403/u);
});

test('connexion : hello obligatoire et protocole vérifié', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.satellite('inconnu'), /403/u);
  const cookie = await f.admin();
  const { token } = (
    await f.app.inject({
      method: 'POST',
      url: '/api/admin/satellites',
      headers: { cookie, origin },
      payload: { name: 'Salon' },
    })
  ).json();
  const early = await f.satellite(token);
  early.socket.send(Buffer.alloc(2560));
  const [code] = await once(early.socket, 'close');
  assert.equal(code, 1008);
  const future = await f.satellite(token);
  future.socket.send(JSON.stringify({ type: 'hello', protocol: 99, firmware: '9.0.0' }));
  const [, reason] = await once(future.socket, 'close');
  assert.match(String(reason), /Protocole/u);
});

test('veille : le son suit « listen », la détection revient au satellite', async (t) => {
  const f = await fixture(t);
  const cookie = await f.admin();
  const { token, satellite } = (
    await f.app.inject({
      method: 'POST',
      url: '/api/admin/satellites',
      headers: { cookie, origin },
      payload: { name: 'Bureau' },
    })
  ).json();
  const worker = await f.perception();
  worker.socket.send(JSON.stringify({ type: 'wake_status', ready: true, detail: null }));
  await setImmediate();
  const device = await f.satellite(token);
  device.socket.send(JSON.stringify({ type: 'hello', protocol: 1, firmware: '0.1.0' }));
  const welcome = await device.next((message) => message.type === 'welcome');
  assert.deepEqual(welcome, {
    type: 'welcome',
    protocol: 1,
    id: satellite.id,
    name: 'Bureau',
    volume: 70,
  });
  assert.deepEqual(await device.next((message) => message.type === 'settings'), {
    type: 'settings',
    volume: 70,
    led: { color: '#00ffb4', brightness: 6, nightLight: false },
    attentive: false,
  });
  // Mot d’appel désactivé : le satellite n’envoie rien.
  assert.deepEqual(await device.next((message) => message.type === 'listen'), {
    type: 'listen',
    enabled: false,
  });
  f.controller.setWakeWordEnabled(true);
  await device.next((message) => message.type === 'listen' && message.enabled);
  const start = await worker.next((message) => message.type === 'wake_start');
  device.socket.send(Buffer.alloc(2560, 1));
  const frame: Buffer = await worker.next((message) => Buffer.isBuffer(message));
  assert.deepEqual([frame.length, frame[0], frame[1]], [2562, 0x57, start.slot]);
  worker.socket.send(
    JSON.stringify({ type: 'wake_detected', streamId: start.streamId, score: 0.873 }),
  );
  assert.deepEqual(await device.next((message) => message.type === 'wake'), {
    type: 'wake',
    score: 0.87,
  });
  const listed = await f.app.inject({
    url: '/api/admin/satellites',
    headers: { cookie, origin },
  });
  assert.deepEqual(
    [listed.json().satellites[0].online, listed.json().satellites[0].firmware],
    [true, '0.1.0'],
  );
  // Micro coupé : plus aucune trame n’atteint la perception.
  device.socket.send(JSON.stringify({ type: 'mic', muted: true }));
  await setImmediate();
  const before = worker.received.filter(Buffer.isBuffer).length;
  device.socket.send(Buffer.alloc(2560, 1));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(worker.received.filter(Buffer.isBuffer).length, before);
  device.socket.terminate();
  await worker.next((message) => message.type === 'wake_end');
});

test('réglages depuis l’administration : validés, envoyés au satellite connecté', async (t) => {
  const f = await fixture(t);
  const cookie = await f.admin();
  const headers = { cookie, origin };
  const { token, satellite } = (
    await f.app.inject({
      method: 'POST',
      url: '/api/admin/satellites',
      headers,
      payload: { name: 'Chambre' },
    })
  ).json();
  const url = '/api/admin/satellites/' + satellite.id;
  for (const payload of [
    { ledColor: 'bleu' },
    { ledColor: '#FFFFFF' },
    { ledBrightness: 11 },
    { nightLight: 'oui' },
    { attentive: 1 },
    { silenceCloseMs: 1000 },
    { silenceCloseMs: 400_000 },
    { silenceCloseMs: '5000' },
  ])
    assert.equal(
      (await f.app.inject({ method: 'PATCH', url, headers, payload })).statusCode,
      400,
      JSON.stringify(payload),
    );
  const device = await f.satellite(token);
  device.socket.send(JSON.stringify({ type: 'hello', protocol: 1, firmware: '0.2.0', aec: true }));
  await device.next((message) => message.type === 'settings');
  const listed = await f.app.inject({ url: '/api/admin/satellites', headers });
  assert.equal(listed.json().satellites[0].aec, true);
  const changed = await f.app.inject({
    method: 'PATCH',
    url,
    headers,
    payload: { volume: 30, ledColor: '#9b5cff', ledBrightness: 2, nightLight: true },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.deepEqual(
    await device.next((message) => message.type === 'settings' && message.led.color === '#9b5cff'),
    {
      type: 'settings',
      volume: 30,
      led: { color: '#9b5cff', brightness: 2, nightLight: true },
      attentive: false,
    },
  );
});

test('association : un satellite neuf attend, clignote, puis reçoit son jeton', async (t) => {
  const f = await fixture(t);
  const cookie = await f.admin();
  const headers = { cookie, origin };
  const pair = async () => {
    const socket = await f.app.injectWS('/satellite/pair', { headers: { host: 'localhost' } });
    t.after(() => socket.terminate());
    const received: any[] = [];
    socket.on('message', (data) => received.push(JSON.parse(String(data))));
    return { socket, received };
  };
  const invalid = await pair();
  invalid.socket.send(JSON.stringify({ type: 'pair', protocol: 1, device: 'Mauvais Nom!' }));
  assert.equal((await once(invalid.socket, 'close'))[0], 1008);
  const fresh = await pair();
  fresh.socket.send(
    JSON.stringify({
      type: 'pair',
      protocol: 1,
      device: 'cornelius-satellite-b0c6b4',
      firmware: '0.2.0',
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual([...fresh.received], [{ type: 'waiting' }]);
  const listed = (await f.app.inject({ url: '/api/admin/satellites', headers })).json();
  assert.deepEqual(
    listed.pending.map((entry: { device: string }) => entry.device),
    ['cornelius-satellite-b0c6b4'],
  );
  const base = '/api/admin/satellites/pending/cornelius-satellite-b0c6b4';
  assert.equal(
    (await f.app.inject({ method: 'POST', url: base + '/identify', headers })).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: base + '/accept',
        headers: { origin },
        payload: { name: 'Chambre' },
      })
    ).statusCode,
    401,
  );
  const accepted = await f.app.inject({
    method: 'POST',
    url: base + '/accept',
    headers,
    payload: { name: ' Chambre ' },
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fresh.received[1]?.type, 'identify');
  const paired = fresh.received[2]!;
  assert.deepEqual([paired.type, paired.name], ['paired', 'Chambre']);
  // Le jeton reçu ouvre bien la connexion des satellites ; plus rien n’attend.
  const device = await f.satellite(paired.token);
  device.socket.send(JSON.stringify({ type: 'hello', protocol: 1, firmware: '0.2.0' }));
  await device.next((message) => message.type === 'welcome');
  assert.deepEqual(
    (await f.app.inject({ url: '/api/admin/satellites', headers })).json().pending,
    [],
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: base + '/accept',
        headers,
        payload: { name: 'Bis' },
      })
    ).statusCode,
    404,
  );
});

test('alarmes : un satellite qui sait sonner sonne chez lui, son bouton l’arrête', async (t) => {
  let clock = Date.parse('2026-11-02T08:00:00Z');
  const f = await fixture(t, { now: () => clock });
  const cookie = await f.admin();
  const create = async (name: string) =>
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/satellites',
        headers: { cookie, origin },
        payload: { name },
      })
    ).json();
  const kitchen = await create('Cuisine');
  const old = await create('Garage');
  const timer = (target: string) =>
    f.alarms.create({
      kind: 'timer',
      profileId: null,
      label: 'minuteur',
      time: null,
      date: null,
      days: 0,
      durationMs: 5_000,
      inMinutes: null,
      target,
    });
  const ring = () => {
    clock += 5_000;
    f.alarms.tick();
  };
  const device = await f.satellite(kitchen.token);
  device.socket.send(
    JSON.stringify({ type: 'hello', protocol: 1, firmware: '0.4.0', features: ['ring'] }),
  );
  await device.next((message) => message.type === 'welcome');
  // Ancien firmware, sans « ring » : son minuteur sonne sur le miroir.
  const garage = await f.satellite(old.token);
  garage.socket.send(JSON.stringify({ type: 'hello', protocol: 1, firmware: '0.3.0' }));
  await garage.next((message) => message.type === 'welcome');
  const here = timer(kitchen.satellite.id);
  const there = timer(old.satellite.id);
  ring();
  const first = await device.next((message) => message.type === 'ring');
  assert.deepEqual(first, { type: 'ring', state: 'start', sound: 'bips', soft: false });
  assert.deepEqual(
    f.controller.snapshot().state.alarms!.ringing.map((alarm) => alarm.id),
    [there.id],
  );
  assert.equal(
    garage.received.some((message: any) => message?.type === 'ring'),
    false,
  );

  // Le bouton du satellite arrête ce qui sonne chez lui, pas ailleurs.
  device.socket.send(JSON.stringify({ type: 'ring', action: 'stop' }));
  await device.next((message) => message.type === 'ring' && message.state === 'stop');
  assert.equal(f.alarms.get(here.id)!.state, 'done');
  assert.equal(f.alarms.get(there.id)!.state, 'ringing');

  // Le satellite part pendant qu’un minuteur y sonne : le miroir prend le relais.
  const again = timer(kitchen.satellite.id);
  ring();
  await device.next(
    (message) => message.type === 'ring' && message.state === 'start' && message !== first,
  );
  assert.equal(
    f.controller.snapshot().state.alarms!.ringing.some((alarm) => alarm.id === again.id),
    false,
  );
  device.socket.terminate();
  for (let attempt = 0; attempt < 50; attempt++) {
    if (f.controller.snapshot().state.alarms!.ringing.some((alarm) => alarm.id === again.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(f.controller.snapshot().state.alarms!.ringing.some((alarm) => alarm.id === again.id));
});
