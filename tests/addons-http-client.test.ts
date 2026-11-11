import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { AddonCollectError } from '../shared/addons.js';
import { charsetOf, createHttpClient, defaultUserAgent } from '../server/addons/http.js';

type Seen = { url: string; method: string; headers: Record<string, string> };

/** Remplace fetch par une table d'adresses : chaque réponse est jouée exactement. */
function network(t: TestContext, routes: Record<string, () => Response>) {
  const seen: Seen[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({
      url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
    });
    const route = routes[url];
    return route ? route() : new Response('absent', { status: 404 });
  });
  return seen;
}

const redirect =
  (location: string, status = 302) =>
  () =>
    new Response(null, { status, headers: { location } });

async function failure(promise: Promise<unknown>): Promise<AddonCollectError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AddonCollectError);
    return error;
  }
  assert.fail('La requête aurait dû échouer.');
}

test('redirections GET suivies, adresse finale donnée, en-têtes sensibles retirés ailleurs', async (t) => {
  const seen = network(t, {
    'https://ancien.example/flux': redirect('/titres.rss', 301),
    'https://ancien.example/titres.rss': redirect('https://nouveau.example/titres.rss'),
    'https://nouveau.example/titres.rss': () => new Response('<rss/>', { status: 200 }),
  });
  const response = await createHttpClient().fetch({
    url: 'https://ancien.example/flux',
    headers: { Authorization: 'Bearer secret', Accept: 'application/rss+xml' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.text(), '<rss/>');
  assert.equal(response.url, 'https://nouveau.example/titres.rss');
  assert.deepEqual(
    seen.map((call) => [call.url, call.headers.Authorization ?? null]),
    [
      ['https://ancien.example/flux', 'Bearer secret'],
      ['https://ancien.example/titres.rss', 'Bearer secret'],
      ['https://nouveau.example/titres.rss', null],
    ],
  );
  assert.equal(seen[2]!.headers.Accept, 'application/rss+xml');
});

test('pas de redirection pour un POST, ni vers http, ni au-delà de trois', async (t) => {
  network(t, {
    'https://a.example/action': redirect('https://b.example/action', 307),
    'https://a.example/fuite': redirect('http://a.example/clair'),
    'https://a.example/1': redirect('/2'),
    'https://a.example/2': redirect('/3'),
    'https://a.example/3': redirect('/4'),
    'https://a.example/4': redirect('/5'),
    'https://a.example/ftp': redirect('ftp://a.example/x'),
  });
  const client = createHttpClient();
  const post = await failure(client.fetch({ url: 'https://a.example/action', method: 'POST' }));
  assert.match(post.message, /utiliser son adresse finale/u);
  assert.match(
    (await failure(client.fetch({ url: 'https://a.example/fuite' }))).message,
    /non chiffrée/u,
  );
  assert.match(
    (await failure(client.fetch({ url: 'https://a.example/1' }))).message,
    /Trop de redirections/u,
  );
  assert.equal(
    (await failure(client.fetch({ url: 'https://a.example/ftp' }))).code,
    'invalid_params',
  );
});

test('encodage : charset de l’en-tête, déclaration XML, sinon UTF-8', async (t) => {
  const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // « café » en ISO-8859-1
  // « <t>été</t> » en ISO-8859-1, déclaré par le document seulement.
  const xml = new Uint8Array([
    ...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><t>'),
    0xe9,
    0x74,
    0xe9,
    ...new TextEncoder().encode('</t>'),
  ]);
  network(t, {
    'https://a.example/latin1': () =>
      new Response(latin1, { headers: { 'content-type': 'text/plain; charset=ISO-8859-1' } }),
    'https://a.example/xml': () => new Response(xml, { headers: { 'content-type': 'text/xml' } }),
    'https://a.example/utf8': () => new Response('café'),
  });
  const client = createHttpClient();
  assert.equal((await client.fetch({ url: 'https://a.example/latin1' })).text(), 'café');
  assert.match((await client.fetch({ url: 'https://a.example/xml' })).text(), /<t>été<\/t>/u);
  assert.equal((await client.fetch({ url: 'https://a.example/utf8' })).text(), 'café');
  assert.equal(charsetOf('text/html; charset="windows-1252"', new Uint8Array()), 'windows-1252');
  assert.equal(charsetOf('text/html; charset=inconnu', new Uint8Array()), 'utf-8');
});

test('une réponse coupée à maxBytes le signale ; une réponse entière non', async (t) => {
  network(t, {
    'https://a.example/gros': () => new Response('x'.repeat(5000)),
    'https://a.example/juste': () => new Response('x'.repeat(100)),
  });
  const client = createHttpClient();
  const cut = await client.fetch({ url: 'https://a.example/gros', maxBytes: 1000 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.text().length, 1000);
  const whole = await client.fetch({ url: 'https://a.example/juste', maxBytes: 100 });
  assert.equal(whole.truncated, false);
});

test('User-Agent par défaut, sauf si le module donne le sien', async (t) => {
  const seen = network(t, { 'https://a.example/': () => new Response('ok') });
  const client = createHttpClient();
  await client.fetch({ url: 'https://a.example/' });
  await client.fetch({ url: 'https://a.example/', headers: { 'user-agent': 'Module/1.0' } });
  assert.equal(seen[0]!.headers['User-Agent'], defaultUserAgent);
  assert.match(defaultUserAgent, /^Cornelius\/\d+\.\d+\.\d+ /u);
  assert.equal(seen[1]!.headers['user-agent'], 'Module/1.0');
  assert.equal(seen[1]!.headers['User-Agent'], undefined);
});

test('cache partagé : même réponse pendant cacheMs, puis relue ; erreurs et POST jamais', async (t) => {
  let count = 0;
  const seen = network(t, {
    'https://a.example/etat': () => new Response(`etat ${++count}`),
    'https://a.example/erreur': () => new Response('panne', { status: 503 }),
  });
  let now = 0;
  const client = createHttpClient({ now: () => now });
  const get = () => client.fetch({ url: 'https://a.example/etat', cacheMs: 60_000 });
  assert.equal((await get()).text(), 'etat 1');
  assert.equal((await get()).text(), 'etat 1');
  now += 60_001;
  assert.equal((await get()).text(), 'etat 2');
  // Sans cacheMs, chaque appel part.
  await client.fetch({ url: 'https://a.example/etat' });
  await client.fetch({ url: 'https://a.example/etat', method: 'POST', cacheMs: 60_000 });
  await client.fetch({ url: 'https://a.example/erreur', cacheMs: 60_000 });
  await client.fetch({ url: 'https://a.example/erreur', cacheMs: 60_000 });
  assert.equal(seen.filter((call) => call.url.endsWith('/erreur')).length, 2);
  assert.equal(seen.filter((call) => call.url.endsWith('/etat')).length, 4);
});

test('deux demandes identiques en vol n’en font qu’une ; l’annulation de l’une épargne l’autre', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    await gate;
    return new Response('partagé');
  });
  const client = createHttpClient();
  const abort = new AbortController();
  const first = client.fetch({ url: 'https://a.example/x', cacheMs: 5000, signal: abort.signal });
  const second = client.fetch({ url: 'https://a.example/x', cacheMs: 5000 });
  abort.abort();
  release();
  assert.equal((await failure(first)).code, 'unavailable');
  assert.equal((await second).text(), 'partagé');
  assert.equal(calls, 1);
});

test('bytes() rend le corps brut intact (format binaire), text() décode toujours', async (t) => {
  // Octets invalides en UTF-8 (0xff, 0x80), comme dans un message protobuf GTFS-RT.
  const brut = new Uint8Array([0x0a, 0x03, 0xff, 0x80, 0x00, 0x12, 0x01, 0x41]);
  network(t, {
    'https://flux.example/tripUpdates': () =>
      new Response(brut, { status: 200, headers: { 'content-type': 'application/x-protobuf' } }),
    'https://flux.example/texte': () =>
      new Response(new TextEncoder().encode('Montréal'), { status: 200 }),
  });
  const client = createHttpClient();
  const binaire = await client.fetch({ url: 'https://flux.example/tripUpdates' });
  assert.deepEqual([...binaire.bytes()], [...brut]);
  // Le décodage en texte, lui, remplace les octets invalides : ils seraient perdus.
  assert.match(binaire.text(), /�/u);
  const texte = await client.fetch({ url: 'https://flux.example/texte' });
  assert.equal(texte.text(), 'Montréal');
  assert.deepEqual([...texte.bytes()], [...new TextEncoder().encode('Montréal')]);
});

test('bytes() d’une réponse partagée par le cache : une copie, coupée à maxBytes', async (t) => {
  const brut = new Uint8Array(1000).map((_, i) => i % 256);
  const seen = network(t, {
    'https://flux.example/reseau.pb': () => new Response(brut, { status: 200 }),
  });
  const client = createHttpClient();
  const request = { url: 'https://flux.example/reseau.pb', cacheMs: 30_000, maxBytes: 600 };
  const premiere = await client.fetch(request);
  const lu = premiere.bytes();
  assert.equal(lu.byteLength, 600);
  assert.equal(premiere.truncated, true);
  lu.fill(0);
  const seconde = await client.fetch(request);
  assert.equal(seen.length, 1, 'servie par le cache');
  assert.deepEqual([...seconde.bytes()], [...brut.subarray(0, 600)], 'le cache n’est pas modifié');
});
