import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import { imageSize, imageType, titleFromName } from '../server/screensaver.js';
import { openDatabase, SessionPreferences } from '../server/storage.js';
import { screensaverCollection } from '../server/screensaver-collection.js';
import {
  DEFAULT_SCREENSAVER,
  isScreensaverSettings,
  type ScreensaverView,
} from '../shared/screensaver.js';
import type { MirrorState, StateEvent } from '../shared/types.js';
import { screensaverWoken } from '../web/components/screensaver-wake.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-test-1234';
/** Plus petit en-tête JPEG reconnu : le serveur ne décode jamais l’image. */
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]);

async function fixture(t: TestContext, fetcher?: typeof fetch) {
  const root = mkdtempSync(join(tmpdir(), 'cornelius-screensaver-test-'));
  const images = mkdtempSync(join(tmpdir(), 'cornelius-screensaver-images-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      openaiKey: 'test-key',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: password,
      origins: [origin],
      secureCookies: false,
    },
    {
      timers: false,
      imageGenerationRoot: images,
      screensaverRoot: root,
      screensaverFetch: fetcher,
      modelLauncher: () =>
        spawn(
          process.execPath,
          ['-e', 'process.stdout.write(JSON.stringify({state:"ready"})+"\\n")'],
          { windowsHide: true },
        ),
    },
  );
  await services.app.ready();
  t.after(async () => {
    await services.app.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(images, { recursive: true, force: true });
  });
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password },
  });
  const cookie = login.cookies.find((entry) => entry.name === 'cornelius_admin');
  assert.ok(cookie);
  const headers = { origin, cookie: `${cookie.name}=${cookie.value}` };
  const state = async () =>
    (await services.app.inject({ url: '/api/state' })).json<StateEvent>().state;
  return { ...services, root, headers, state };
}

test('formats reconnus aux premiers octets, réglages bornés', () => {
  assert.equal(imageType(jpeg), 'image/jpeg');
  assert.equal(imageType(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), 'image/png');
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  assert.equal(titleFromName('vacances-2024_plage.JPG'), 'vacances 2024 plage');
  assert.ok(isScreensaverSettings(DEFAULT_SCREENSAVER));
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, intervalMs: 1000 }), false);
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, returnDelayMs: -1 }), false);
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, extra: true }), false);
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, transition: 'fondu' }), false);
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, wake: 'jamais' }), false);
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, durationMs: 100 }), false);
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, durationMs: 9_000 }), false);
  assert.ok(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, transition: 'fade' }));
  assert.equal(isScreensaverSettings({ ...DEFAULT_SCREENSAVER, fit: 'stretch' }), false);
});

/** En-tête JPEG minimal : une orientation EXIF facultative, puis les dimensions (SOF0). */
function jpegHeader(width: number, height: number, orientation?: number): Buffer {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation) {
    // TIFF petit-boutiste : un répertoire d’une entrée, l’orientation (0x0112).
    const tiff = Buffer.alloc(26);
    tiff.write('II', 0, 'ascii');
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x0112, 10);
    tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(orientation, 18);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
    const head = Buffer.from([0xff, 0xe1, 0, 0]);
    head.writeUInt16BE(body.length + 2, 2);
    parts.push(head, body);
  }
  const frame = Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  parts.push(frame, Buffer.alloc(16));
  return Buffer.concat(parts);
}

test('dimensions lues dans l’en-tête, rotation des photos de téléphone comprise', () => {
  assert.deepEqual(imageSize(jpegHeader(4000, 3000)), { width: 4000, height: 3000 });
  // Orientation 6 : photo prise en portrait, enregistrée couchée.
  assert.deepEqual(imageSize(jpegHeader(4000, 3000, 6)), { width: 3000, height: 4000 });
  assert.deepEqual(imageSize(jpegHeader(4000, 3000, 3)), { width: 4000, height: 3000 });
  const png = Buffer.alloc(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.writeUInt32BE(720, 16);
  png.writeUInt32BE(1280, 20);
  assert.deepEqual(imageSize(png), { width: 720, height: 1280 });
  assert.equal(imageSize(jpeg), null, 'en-tête sans dimensions');
});

test('écran de veille : réglages diffusés au miroir, images envoyées puis retirées', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.state()).screensaver, {
    ...DEFAULT_SCREENSAVER,
    imageCount: 0,
    revision: '',
  });
  const settings = {
    enabled: true,
    intervalMs: 60_000,
    returnDelayMs: 5_000,
    transition: 'embers',
    durationMs: 1_500,
    wake: 'opening',
    fit: 'whole',
  };
  const patch = (payload: Record<string, unknown>) =>
    f.app.inject({ method: 'PATCH', url: '/api/admin/screensaver', headers: f.headers, payload });
  assert.equal(
    (await f.app.inject({ method: 'PATCH', url: '/api/admin/screensaver', payload: settings }))
      .statusCode,
    403,
    'sans origine',
  );
  assert.equal((await patch({ ...settings, intervalMs: 5 })).statusCode, 400);
  const saved = await patch(settings);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json<StateEvent>().state.screensaver, {
    ...settings,
    imageCount: 0,
    revision: '',
  });

  const upload = (body: Buffer, type: string, name = encodeURIComponent('Plage d’été.jpg')) =>
    f.app.inject({
      method: 'POST',
      url: '/api/admin/screensaver/images',
      headers: { ...f.headers, 'content-type': type, 'x-file-name': name },
      payload: body,
    });
  assert.equal((await upload(Buffer.from('<svg/>          '), 'image/png')).statusCode, 415);
  const wrongType = await upload(jpeg, 'text/plain');
  // Un autre type que JPEG, PNG ou WebP n’atteint jamais la bibliothèque.
  assert.ok(wrongType.statusCode >= 400, wrongType.body);
  assert.deepEqual(readdirSync(f.root), []);
  const added = await upload(jpeg, 'image/jpeg');
  assert.equal(added.statusCode, 200, added.body);
  const [image] = added.json<ScreensaverView>().images;
  assert.ok(image);
  assert.equal(image.title, 'Plage d’été');
  assert.equal(image.origin, 'upload');
  const state = await f.state();
  assert.equal(state.screensaver?.imageCount, 1);
  assert.notEqual(state.screensaver?.revision, '');

  // Le miroir lit la liste et le fichier ; l’envoi reste réservé à l’administration.
  const list = await f.app.inject({ url: '/api/screensaver' });
  assert.deepEqual(list.json().images, [image]);
  const file = await f.app.inject({ url: image.url });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  assert.deepEqual(file.rawPayload, jpeg);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/screensaver/images',
        headers: { origin, 'content-type': 'image/jpeg' },
        payload: jpeg,
      })
    ).statusCode,
    401,
  );

  const removed = await f.app.inject({
    method: 'DELETE',
    url: `/api/admin/screensaver/images/${image.id}`,
    headers: f.headers,
  });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.json<ScreensaverView>().images, []);
  assert.deepEqual(readdirSync(f.root), []);
  assert.equal((await f.app.inject({ url: image.url })).statusCode, 404);
  assert.equal((await f.state()).screensaver?.imageCount, 0);
});

test('collection : peintures téléchargées une fois, échecs signalés', async (t) => {
  const asked: string[] = [];
  let failing = true;
  const fetcher = (async (url: string | URL | Request) => {
    asked.push(String(url));
    if (failing && asked.length === 1) return new Response('absent', { status: 404 });
    return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  const f = await fixture(t, fetcher);
  const install = async () => {
    const started = await f.app.inject({
      method: 'POST',
      url: '/api/admin/screensaver/collection',
      headers: f.headers,
      payload: {},
    });
    assert.equal(started.statusCode, 200, started.body);
    for (let wait = 0; wait < 100; wait++) {
      const view = (
        await f.app.inject({ url: '/api/admin/screensaver', headers: f.headers })
      ).json<ScreensaverView>();
      if (!view.collection.downloading) return view;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Téléchargement sans fin.');
  };
  const first = await install();
  const total = screensaverCollection.length;
  assert.equal(first.collection.installed, total - 1);
  assert.match(first.collection.error ?? '', /Une peinture/u);
  assert.ok(asked.every((url) => url.startsWith('https://commons.wikimedia.org/')));
  assert.ok(first.images.every((image) => image.origin === 'collection' && image.credit));

  failing = false;
  const second = await install();
  assert.equal(second.collection.installed, total);
  assert.equal(second.collection.error, null);
  assert.equal(asked.length, total + 1, 'seule la peinture manquante est redemandée');
  assert.equal((await f.state()).screensaver?.imageCount, total);
});

test('réglages relus de la base, transition inconnue ramenée à la valeur par défaut', () => {
  const db = openDatabase(':memory:');
  const preferences = new SessionPreferences(db);
  assert.deepEqual(preferences.getScreensaver(), DEFAULT_SCREENSAVER);
  const chosen = {
    enabled: true,
    intervalMs: 900_000,
    returnDelayMs: 60_000,
    transition: 'curtain',
    durationMs: 2_000,
    wake: 'opening',
    fit: 'fill',
  } as const;
  preferences.setScreensaver(chosen);
  assert.deepEqual(preferences.getScreensaver(), chosen);
  db.prepare("UPDATE screensaver_choices SET transition = 'retirée'").run();
  assert.deepEqual(preferences.getScreensaver(), { ...chosen, transition: 'vortex' });
  db.close();
});

test('réveil de l’orbe : au passage, ou selon ce qui ouvre la conversation', () => {
  const person = { trackId: 'one', profileId: null as string | null, engaged: false };
  const mirror = (
    wake: 'presence' | 'opening',
    trigger: 'presence' | 'gaze' | 'voice',
    people: (typeof person)[],
    audience: 'everyone' | 'members' = 'everyone',
  ) =>
    ({
      screensaver: { ...DEFAULT_SCREENSAVER, wake, imageCount: 1, revision: 'x' },
      opening: { trigger, audience, recognizeVoice: false },
      presence: {
        state: people.some((entry) => entry.engaged)
          ? 'engaged'
          : people.length
            ? 'present'
            : 'absent',
        health: 'ok',
        peopleCount: people.length,
        people,
        engagementId: null,
        observedAt: 0,
      },
    }) as unknown as MirrorState;
  const passing = [person];
  const looking = [{ ...person, engaged: true }];
  // Au passage : la présence suffit, quel que soit ce qui ouvre la conversation.
  assert.equal(screensaverWoken(mirror('presence', 'voice', passing), 'idle'), true);
  assert.equal(screensaverWoken(mirror('presence', 'gaze', []), 'idle'), false);
  // Au réveil de Cornelius : le regard, la présence, ou la conversation pour le mot d’appel.
  assert.equal(screensaverWoken(mirror('opening', 'gaze', passing), 'idle'), false);
  assert.equal(screensaverWoken(mirror('opening', 'gaze', looking), 'idle'), true);
  assert.equal(screensaverWoken(mirror('opening', 'presence', passing), 'idle'), true);
  assert.equal(screensaverWoken(mirror('opening', 'voice', looking), 'idle'), false);
  assert.equal(screensaverWoken(mirror('opening', 'voice', []), 'connecting'), true);
  // Deux personnes, aucun profil actif : le serveur voit le regard sans l’attribuer à l’une
  // d’elles. C’est ce regard-là qui ouvre la conversation, il réveille aussi l’orbe.
  const two = mirror('opening', 'gaze', [person, { ...person, trackId: 'two' }]);
  two.presence.state = 'engaged';
  assert.equal(screensaverWoken(two, 'idle'), true);
  // Réservée au foyer : seule une personne reconnue réveille l’orbe.
  assert.equal(screensaverWoken(mirror('opening', 'gaze', looking, 'members'), 'idle'), false);
  assert.equal(
    screensaverWoken(
      mirror('opening', 'gaze', [{ ...person, profileId: 'alice', engaged: true }], 'members'),
      'idle',
    ),
    true,
  );
});

test('retrait groupé : une seule demande pour plusieurs images, les autres restent', async (t) => {
  const f = await fixture(t);
  const upload = (body: Buffer) =>
    f.app.inject({
      method: 'POST',
      url: '/api/admin/screensaver/images',
      headers: { ...f.headers, 'content-type': 'image/jpeg', 'x-file-name': 'photo.jpg' },
      payload: body,
    });
  await upload(jpegHeader(4000, 3000));
  await upload(jpegHeader(4000, 3000, 6));
  const added = await upload(jpegHeader(1000, 1000));
  const images = added.json<ScreensaverView>().images;
  assert.deepEqual(
    images.map((image) => [image.width, image.height]),
    [
      [4000, 3000],
      [3000, 4000],
      [1000, 1000],
    ],
  );
  const remove = (payload: Record<string, unknown>) =>
    f.app.inject({
      method: 'POST',
      url: '/api/admin/screensaver/images/remove',
      headers: f.headers,
      payload,
    });
  assert.equal((await remove({ ids: [] })).statusCode, 400);
  assert.equal((await remove({ ids: [1, 2] })).statusCode, 400);
  const left = await remove({ ids: [images[0]!.id, images[1]!.id, 'inconnue'] });
  assert.equal(left.statusCode, 200, left.body);
  assert.deepEqual(
    left.json<ScreensaverView>().images.map((image) => image.id),
    [images[2]!.id],
  );
  assert.equal(readdirSync(f.root).length, 1);
  assert.equal((await f.state()).screensaver?.imageCount, 1);
});
