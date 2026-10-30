import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  GooglePhotosAlbum,
  albumUrl,
  photoUrl,
  parseAlbum,
  googlePhotosMigration,
} from '../server/google-photos.js';
import { openDatabase } from '../server/storage.js';
import { DEFAULT_GOOGLE_PHOTOS, isGooglePhotosSettings } from '../shared/google-photos.js';

// Données synthétiques : aucune URL d'album, photo ou identifiant personnel réel.
const shared = 'https://photos.google.com/share/test-album?key=test-key';
const short = 'https://photos.app.goo.gl/test-link';
const image = 'https://lh3.googleusercontent.com/pw/test-photo';
const config = { source: 'google-photos' as const, albumUrl: short, refreshMinutes: 5 };
const page = (ids = ['photo-1']) =>
  `<script>AF_initDataCallback({key:'ds:1',data:${JSON.stringify([null, ids.map((id) => [id, [image, 1600, 1200], null])])},sideChannel:{}});</script>`;

function fixture(t: TestContext, fetcher: typeof fetch, now: () => number = () => 100000) {
  const db = openDatabase(':memory:');
  const album = new GooglePhotosAlbum(db, fetcher, now);
  t.after(async () => {
    await album.dispose();
    db.close();
  });
  return { db, album };
}

test('liens stricts : partage Google uniquement, jamais une URL libre ou un album privé', () => {
  assert.equal(albumUrl(short), short);
  assert.equal(albumUrl(shared), shared);
  for (const url of [
    'http://photos.app.goo.gl/test',
    'https://photos.google.com/album/private',
    'https://photos.app.goo.gl.evil.test/test',
    'https://user:pass@photos.app.goo.gl/test',
    'https://photos.app.goo.gl:444/test',
    'https://photos.google.com/share/test?key=x&next=http://localhost',
    'https://photos.google.com/share/test?key=a&key=b',
    'https://127.0.0.1/test',
    short + '#fragment',
  ])
    assert.equal(albumUrl(url), null);
  assert.equal(photoUrl(image), image);
  assert.equal(photoUrl(image + '=w2560-h2560'), image + '=w2560-h2560');
  assert.equal(photoUrl('https://evil.googleusercontent.com/test'), null);
  assert.equal(photoUrl(image + '?redirect=localhost'), null);
  assert.ok(isGooglePhotosSettings(DEFAULT_GOOGLE_PHOTOS));
  for (const patch of [
    { refreshMinutes: 1 },
    { refreshMinutes: 5.5 },
    { refreshMinutes: 1441 },
    { refreshMinutes: NaN },
    { source: 'other' },
    { extra: true },
  ])
    assert.equal(isGooglePhotosSettings({ ...config, ...patch }), false);
});

test('parseur sans exécution : JSON imbriqué, doublons, dimensions et hôtes validés', () => {
  const html = page(['photo-1', 'photo-1', 'photo-2']);
  assert.equal(parseAlbum(html).length, 2);
  assert.equal(
    parseAlbum(html.replaceAll('https://lh3.googleusercontent.com', 'http://localhost')).length,
    0,
  );
  assert.equal(parseAlbum('<img src="' + image + '">').length, 0);
  assert.equal(
    parseAlbum('<script>AF_initDataCallback({data:[globalThis.bad=true]});</script>').length,
    0,
  );
  assert.equal(parseAlbum(html.replaceAll('1600', '-1')).length, 0);
  assert.equal(parseAlbum(page(Array.from({ length: 510 }, (_, i) => `photo-${i}`))).length, 500);
});

test('migration rejouable, source locale sans requête réseau, configuration persistée', async (t) => {
  const { db, album } = fixture(t, async () => {
    throw new Error('Ne doit pas appeler Google.');
  });
  db.exec(googlePhotosMigration);
  assert.deepEqual(album.settings(), DEFAULT_GOOGLE_PHOTOS);
  await album.refresh();
  album.configure(config);
  assert.deepEqual(album.settings(), config);
  assert.throws(() => album.configure({ ...config, albumUrl: 'http://localhost' }));
  assert.deepEqual(album.settings(), config);
});

test('redirection de partage, photos relayées en mémoire et adresses absentes du miroir', async (t) => {
  const urls: string[] = [];
  const { album } = fixture(t, async (input, init) => {
    const url = String(input);
    urls.push(url);
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.credentials, 'omit');
    if (url === short) return new Response(null, { status: 302, headers: { location: shared } });
    if (url === shared) return new Response(page());
    assert.equal(url, image + '=w2560-h2560');
    return new Response(Buffer.from([1, 2, 3]));
  });
  album.configure(config);
  await album.refresh();
  assert.equal(album.view().count, 1);
  const publicView = JSON.stringify(album.list());
  assert.ok(!publicView.includes('googleusercontent.com'));
  assert.ok(!publicView.includes('test-key'));
  assert.deepEqual(await album.image(album.list()[0]!.id), Buffer.from([1, 2, 3]));
  assert.equal(await album.image('unknown'), null);
  assert.equal(urls.length, 3);
});

test('chaque redirection est contrôlée, sans requête vers un hôte privé ou la connexion Google', async (t) => {
  for (const location of [
    'http://127.0.0.1/secret',
    'https://accounts.google.com/login',
    'https://example.com/',
  ]) {
    let calls = 0;
    const { album } = fixture(t, async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location } });
    });
    album.configure(config);
    await album.refresh();
    assert.equal(calls, 1);
    assert.equal(album.view().count, 0);
    assert.ok(album.view().error);
    assert.ok(!JSON.stringify(album.view()).includes(location));
  }
});

test('redirection d’image externe refusée et réponse trop volumineuse annulée', async (t) => {
  let calls = 0;
  const { album } = fixture(t, async (input) => {
    calls++;
    return String(input) === short
      ? new Response(page())
      : new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/photo' } });
  });
  album.configure(config);
  await album.refresh();
  assert.equal(await album.image(album.list()[0]!.id), null);
  assert.equal(calls, 2);
  const large = fixture(t, async () => new Response('x'.repeat(12 * 1024 * 1024 + 1))).album;
  large.configure(config);
  await large.refresh();
  assert.ok(large.view().error);
  assert.equal(large.view().count, 0);
});

test('actualisation : ajouts, suppressions, erreur et retrait du partage ne gardent pas de photos périmées', async (t) => {
  let time = 100000,
    body = page(),
    status = 200,
    calls = 0;
  const { album } = fixture(
    t,
    async () => {
      calls++;
      return new Response(body, { status });
    },
    () => time,
  );
  album.configure(config);
  await album.refresh();
  const before = album.revision();
  await album.refresh();
  assert.equal(calls, 1);
  time += 60000;
  body = page(['photo-2', 'photo-3']);
  await album.refresh();
  assert.equal(album.list().length, 2);
  assert.notEqual(album.revision(), before);
  time += 60000;
  status = 403;
  await album.refresh();
  assert.equal(album.list().length, 0);
  assert.ok(album.view().error);
  time += 60000;
  status = 200;
  await album.refresh();
  assert.equal(album.list().length, 2);
  assert.equal(album.view().error, null);
  album.configure(DEFAULT_GOOGLE_PHOTOS);
  assert.equal(album.list().length, 0);
  assert.equal(await album.image('anything'), null);
});

test('requêtes concurrentes regroupées et ancienne réponse ignorée après changement de source', async (t) => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const { album } = fixture(t, async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  album.configure(config);
  const first = album.refresh();
  const second = album.refresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  album.configure(DEFAULT_GOOGLE_PHOTOS);
  finish(new Response(page()));
  await first;
  assert.equal(album.list().length, 0);
  assert.equal(album.view().lastCheckedAt, null);
});

test('actualisation périodique, reprise au démarrage et arrêt du minuteur', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let time = 100000;
  let calls = 0;
  const { db, album } = fixture(
    t,
    async () => {
      calls++;
      return new Response(page());
    },
    () => time,
  );
  album.configure(config);
  album.start();
  album.start();
  await album.refresh();
  assert.equal(calls, 1);
  time += 300000;
  t.mock.timers.tick(300000);
  await album.refresh();
  assert.equal(calls, 2);
  await album.dispose();
  time += 300000;
  t.mock.timers.tick(300000);
  assert.equal(calls, 2);
  const restarted = new GooglePhotosAlbum(db, async () => new Response(page(['new-photo'])));
  assert.deepEqual(restarted.settings(), config);
  assert.equal(restarted.list().length, 0);
  await restarted.refresh();
  assert.equal(restarted.list().length, 1);
  await restarted.dispose();
});
