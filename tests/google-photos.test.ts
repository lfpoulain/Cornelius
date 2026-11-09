import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  GooglePhotosAlbum,
  albumUrl,
  photoUrl,
  parseAlbum,
  googlePhotosMigration,
} from '../server/google-photos.js';
import { openDatabase, migrations } from '../server/storage.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

for (const failure of ['network', 'body', 408, 429, 500, 503] as const) {
  test(`erreur passagère ${failure} : liste conservée et reprise après une minute`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let time = 100000,
      calls = 0,
      failing = false;
    const { album } = fixture(
      t,
      async () => {
        calls++;
        if (!failing) return new Response(page());
        if (failure === 'network') throw new TypeError('offline');
        if (failure === 'body')
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('connection reset'));
              },
            }),
          );
        return new Response(null, { status: failure });
      },
      () => time,
    );
    album.configure({ ...config, refreshMinutes: 30 });
    album.start();
    await album.refresh();
    const revision = album.revision();
    failing = true;
    time += 30 * 60000;
    t.mock.timers.tick(60000);
    await album.refresh();
    assert.equal(calls, 2);
    assert.equal(album.list().length, 1);
    assert.equal(album.revision(), revision);
    assert.match(album.view().error!, /minute/u);
    await album.refresh();
    assert.equal(calls, 2);
    failing = false;
    time += 60000;
    t.mock.timers.tick(60000);
    await album.refresh();
    assert.equal(calls, 3);
    assert.equal(album.view().error, null);
    time += 60000;
    t.mock.timers.tick(60000);
    assert.equal(calls, 3);
  });
}

for (const status of [403, 404, 410, 'empty', 'format'] as const) {
  test(`album retiré ou invalide ${status} : liste et cache retirés`, async (t) => {
    let time = 100000,
      removed = false,
      downloads = 0;
    const { album } = fixture(
      t,
      async (input) => {
        if (String(input) !== short) {
          downloads++;
          return new Response('photo');
        }
        if (!removed) return new Response(page());
        return typeof status === 'number'
          ? new Response(null, { status })
          : new Response(status === 'empty' ? page([]) : '<html>consent</html>');
      },
      () => time,
    );
    album.configure(config);
    await album.refresh();
    const id = album.list()[0]!.id;
    assert.ok(await album.image(id));
    removed = true;
    time += 60000;
    await album.refresh();
    assert.equal(album.list().length, 0);
    assert.equal(await album.image(id), null);
    removed = false;
    time += 60000;
    await album.refresh();
    assert.ok(await album.image(id));
    assert.equal(downloads, 2);
  });
}

test('cache en mémoire : téléchargements regroupés, expiration et changement de source', async (t) => {
  let time = 100000,
    downloads = 0;
  let finish!: (response: Response) => void;
  const { album } = fixture(
    t,
    async (input) => {
      if (String(input) === short) return new Response(page());
      downloads++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
    () => time,
  );
  album.configure(config);
  await album.refresh();
  const id = album.list()[0]!.id;
  const requests = Array.from({ length: 12 }, () => album.image(id));
  assert.equal(downloads, 1);
  finish(new Response('photo'));
  assert.ok((await Promise.all(requests)).every(Boolean));
  assert.ok(await album.image(id));
  assert.equal(downloads, 1);
  time += 5 * 60000;
  const expired = album.image(id);
  assert.equal(downloads, 2);
  album.configure(DEFAULT_GOOGLE_PHOTOS);
  finish(new Response('old-photo'));
  assert.equal(await expired, null);
  album.configure(config);
  await album.refresh();
  const fresh = album.image(id);
  assert.equal(downloads, 3);
  finish(new Response('new-photo'));
  assert.equal(Buffer.from((await fresh)!).toString(), 'new-photo');
});

test('cache borné à 32 Mio : éviction LRU et invalidation après suppression ou changement URL', async (t) => {
  let time = 100000,
    downloads = 0;
  let urls = Array.from({ length: 6 }, (_, i) => `${image}-${i}`);
  const { album } = fixture(
    t,
    async (input) => {
      if (String(input) === short)
        return new Response(
          `<script>AF_initDataCallback({data:${JSON.stringify(urls.map((url, i) => [`photo-${i}`, [url, 100, 100]]))}});</script>`,
        );
      downloads++;
      return new Response(new Uint8Array(8 * 1024 * 1024));
    },
    () => time,
  );
  album.configure(config);
  await album.refresh();
  const ids = album.list().map((photo) => photo.id);
  for (const id of ids.slice(0, 4)) assert.ok(await album.image(id));
  assert.ok(await album.image(ids[0]!)); // 0 devient le plus récent.
  assert.ok(await album.image(ids[4]!)); // 1 est évincé.
  assert.equal(downloads, 5);
  assert.ok(await album.image(ids[0]!));
  assert.equal(downloads, 5);
  assert.ok(await album.image(ids[1]!));
  assert.equal(downloads, 6);
  urls = [urls[0]! + '-changed'];
  time += 60000;
  await album.refresh();
  assert.equal(await album.image(ids[1]!), null);
  assert.ok(await album.image(ids[0]!));
  assert.equal(downloads, 7);
});

test('huit téléchargements distincts au maximum, sans bloquer les doublons ni les reprises', async (t) => {
  const finishes: ((response: Response) => void)[] = [];
  const html = `<script>AF_initDataCallback({data:${JSON.stringify(Array.from({ length: 9 }, (_, i) => [`photo-${i}`, [`${image}-${i}`, 100, 100]]))}});</script>`;
  const { album } = fixture(t, async (input) => {
    if (String(input) === short) return new Response(html);
    return new Promise<Response>((resolve) => finishes.push(resolve));
  });
  album.configure(config);
  await album.refresh();
  const ids = album.list().map((photo) => photo.id);
  const requests = ids.slice(0, 8).map((id) => album.image(id));
  const duplicate = album.image(ids[0]!);
  assert.equal(finishes.length, 8);
  assert.equal(await album.image(ids[8]!), null);
  for (const finish of finishes) finish(new Response('photo'));
  assert.ok((await Promise.all([...requests, duplicate])).every(Boolean));
  const retry = album.image(ids[8]!);
  assert.equal(finishes.length, 9);
  finishes[8]!(new Response('photo'));
  assert.ok(await retry);
});

for (const previous of ['official', 'experimental-google-photos'] as const) {
  test(`migration depuis ${previous} : les deux fournisseurs restent disponibles sans perte de réglages`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'cornelius-google-upgrade-'));
    const filename = join(directory, 'database.sqlite');
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(filename);
      const customIndex = migrations.findIndex((sql) =>
        sql.includes('CREATE TABLE IF NOT EXISTS custom_provider_preferences'),
      );
      const previousVersion = previous === 'official' ? migrations.length - 1 : customIndex + 1;
      for (const migration of migrations.slice(
        0,
        previousVersion - (previous === 'official' ? 0 : 1),
      ))
        db.exec(migration);
      if (previous === 'official') {
        db.prepare(
          'UPDATE custom_provider_preferences SET name = ?, memory_provider = ? WHERE id = 1',
        ).run('Serveur de test', 'custom');
      } else {
        db.exec(googlePhotosMigration);
        db.prepare(
          'UPDATE screensaver_google_photos SET source = ?, album_url = ?, refresh_minutes = ? WHERE id = 1',
        ).run('google-photos', short, 15);
      }
      db.exec(`PRAGMA user_version = ${previousVersion}`);
      db.close();
      db = undefined;
      db = openDatabase(filename);
      assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, migrations.length);
      const provider = db
        .prepare('SELECT name, memory_provider FROM custom_provider_preferences WHERE id = 1')
        .get()!;
      const gallery = db
        .prepare(
          'SELECT source, album_url, refresh_minutes FROM screensaver_google_photos WHERE id = 1',
        )
        .get()!;
      if (previous === 'official') {
        assert.equal(provider.name, 'Serveur de test');
        assert.equal(provider.memory_provider, 'custom');
        assert.equal(gallery.source, 'local');
      } else {
        assert.equal(provider.memory_provider, 'openai');
        assert.equal(gallery.source, 'google-photos');
        assert.equal(gallery.album_url, short);
        assert.equal(gallery.refresh_minutes, 15);
      }
      assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    } finally {
      db?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
