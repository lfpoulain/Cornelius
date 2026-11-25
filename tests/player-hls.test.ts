import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { DiagnosticLog } from '../server/logs.js';
import { Player, isHlsAddress, type PlayRequest } from '../server/player.js';
import { registerPlayer } from '../server/player-api.js';
import {
  fetchPlaylist,
  fetchSegment,
  HlsTokens,
  rewritePlaylist,
  segmentType,
  sniffSegment,
  type HlsRole,
} from '../server/player-hls.js';
import { PlayerStreamError, type Connect, type UpstreamResponse } from '../server/player-stream.js';
import { id3Title } from '../web/audio/id3.js';

const signal = new AbortController().signal;
const HLS = 'application/vnd.apple.mpegurl';

function upstream(
  status: number,
  headers: Record<string, string> = {},
  body: string | Buffer = '',
): UpstreamResponse {
  const stream = new PassThrough();
  stream.end(body);
  return { status, headers, body: stream };
}

/** Un faux lien : l'adresse et le rôle, lisibles par le test. */
const links: { url: string; role: HlsRole }[] = [];
const link = (url: string, role: HlsRole) => {
  links.push({ url, role });
  return `/t/${links.length - 1}`;
};
const target = (path: string) => links[Number(path.slice(3))]!;

// --- Réécriture ----------------------------------------------------------------------------

test('hls : adresses relatives, absolues et avec paramètres, résolues sur la liste', () => {
  links.length = 0;
  const base = new URL('https://cdn.example/radio/live/index.m3u8?jeton=abc');
  const out = rewritePlaylist(
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:100',
      '# un commentaire',
      '#EXTINF:6.0,',
      'seg100.aac',
      '#EXTINF:6.0,',
      '../autre/seg101.aac?cle=1&b=2',
      '#EXTINF:6.0,',
      'https://ailleurs.example/seg102.aac',
      '#EXTINF:6.0,',
      '/racine/seg103.aac',
    ].join('\r\n'),
    base,
    link,
  );
  assert.ok(!out.includes('example'), 'aucune adresse d’origine dans la liste servie');
  assert.ok(!out.includes('commentaire'));
  const uris = out.split('\n').filter((line) => line.startsWith('/t/'));
  assert.deepEqual(
    uris.map((uri) => target(uri).url),
    [
      'https://cdn.example/radio/live/seg100.aac',
      'https://cdn.example/radio/autre/seg101.aac?cle=1&b=2',
      'https://ailleurs.example/seg102.aac',
      'https://cdn.example/racine/seg103.aac',
    ],
  );
  assert.ok(uris.every((uri) => target(uri).role === 'segment'));
  assert.match(out, /#EXT-X-MEDIA-SEQUENCE:100/u);
});

test('hls : liste maîtresse, variantes, EXT-X-MEDIA et EXT-X-MAP réécrits', () => {
  links.length = 0;
  const base = new URL('https://cdn.example/master.m3u8');
  const out = rewritePlaylist(
    [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="fr",URI="audio/fr.m3u8"',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="st",NAME="fr",URI="st/fr.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2",AUDIO="aac"',
      'haut/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.5"',
      'https://cdn2.example/bas/index.m3u8?p=1',
    ].join('\n'),
    base,
    link,
  );
  assert.ok(!out.includes('example'));
  assert.ok(!out.includes('SUBTITLES'), 'les sous-titres sont retirés');
  const media = /#EXT-X-MEDIA:.*URI="([^"]+)"/u.exec(out)![1]!;
  assert.deepEqual(target(media), { url: 'https://cdn.example/audio/fr.m3u8', role: 'playlist' });
  const variants = out.split('\n').filter((line) => line.startsWith('/t/'));
  assert.deepEqual(
    variants.map((uri) => target(uri)),
    [
      { url: 'https://cdn.example/haut/index.m3u8', role: 'playlist' },
      { url: 'https://cdn2.example/bas/index.m3u8?p=1', role: 'playlist' },
    ],
  );

  links.length = 0;
  const fmp4 = rewritePlaylist(
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"\n#EXTINF:4,\n#EXT-X-BYTERANGE:1000@720\nmedia.mp4\n',
    new URL('https://cdn.example/a/b.m3u8'),
    link,
  );
  const map = /#EXT-X-MAP:URI="([^"]+)",BYTERANGE="720@0"/u.exec(fmp4)![1]!;
  assert.deepEqual(target(map), { url: 'https://cdn.example/a/init.mp4', role: 'segment' });
  assert.match(fmp4, /#EXT-X-BYTERANGE:1000@720/u);
});

test('hls : BANDWIDTH ajouté, variantes vidéo et images retirées', () => {
  links.length = 0;
  const out = rewritePlaylist(
    [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:CODECS="mp4a.40.2"',
      'audio.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1280x720',
      'video.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=900000,CODECS="hvc1.1.6.L93.B0,mp4a.40.2"',
      'hevc.m3u8',
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=80000,URI="iframes.m3u8"',
    ].join('\n'),
    new URL('https://cdn.example/m.m3u8'),
    link,
  );
  assert.match(out, /#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"/u);
  assert.equal(out.match(/#EXT-X-STREAM-INF/gu)?.length, 1);
  assert.ok(!out.includes('I-FRAME'));
  assert.deepEqual(
    links.map((entry) => entry.url),
    ['https://cdn.example/audio.m3u8'],
  );
  // Que de la vidéo : les variantes restent (l'audio y est mêlé).
  const muxed = rewritePlaylist(
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\nv.m3u8\n',
    new URL('https://cdn.example/m.m3u8'),
    link,
  );
  assert.equal(muxed.match(/#EXT-X-STREAM-INF/gu)?.length, 1);
});

test('hls : balises de faible latence retirées', () => {
  links.length = 0;
  const out = rewritePlaylist(
    [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.0',
      '#EXT-X-PART-INF:PART-TARGET=0.33',
      '#EXTINF:4,',
      'seg1.ts',
      '#EXT-X-PART:DURATION=0.33,URI="seg2.0.ts",INDEPENDENT=YES',
      '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="seg2.1.ts"',
      '#EXT-X-RENDITION-REPORT:URI="../autre.m3u8",LAST-MSN=2',
    ].join('\n'),
    new URL('https://cdn.example/ll.m3u8'),
    link,
  );
  for (const tag of ['PART', 'PRELOAD-HINT', 'RENDITION-REPORT', 'SERVER-CONTROL'])
    assert.ok(!out.includes(`#EXT-X-${tag}`), tag);
  assert.deepEqual(
    links.map((entry) => entry.url),
    ['https://cdn.example/seg1.ts'],
  );
});

test('hls : liste chiffrée refusée avec un message clair, METHOD=NONE accepté', () => {
  const base = new URL('https://cdn.example/a.m3u8');
  for (const tag of [
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cle.example/k"',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"',
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="k"',
  ])
    assert.throws(
      () => rewritePlaylist(`#EXTM3U\n${tag}\n#EXTINF:6,\ns.ts\n`, base, link),
      (error: unknown) =>
        error instanceof PlayerStreamError &&
        error.status === 415 &&
        /chiffré \(EXT-X-KEY\)/u.test(error.message),
    );
  assert.match(
    rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:6,\ns.ts\n', base, link),
    /METHOD=NONE/u,
  );
  assert.throws(() => rewritePlaylist('<html>', base, link), /pas une liste HLS/u);
});

// --- Morceaux --------------------------------------------------------------------------------

/** Trois paquets TS de 188 octets. */
const ts = Buffer.alloc(188 * 3, 0xaa);
for (const at of [0, 188, 376]) ts[at] = 0x47;
const adts = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc, 0x21]);

function id3(frames: [string, string][]): Buffer {
  const body = Buffer.concat(
    frames.map(([id, text]) => {
      const value = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
      const header = Buffer.alloc(10);
      header.write(id, 0, 'latin1');
      header.writeUInt32BE(value.length, 4);
      return Buffer.concat([header, value]);
    }),
  );
  const head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  const size = body.length;
  head[6] = (size >> 21) & 0x7f;
  head[7] = (size >> 14) & 0x7f;
  head[8] = (size >> 7) & 0x7f;
  head[9] = size & 0x7f;
  return Buffer.concat([head, body]);
}

test('hls : type des morceaux reconnu aux octets', () => {
  assert.equal(sniffSegment(ts), 'video/mp2t');
  assert.equal(sniffSegment(adts), 'audio/aac');
  assert.equal(sniffSegment(Buffer.concat([id3([['TIT2', 'Titre']]), adts])), 'audio/aac');
  assert.equal(sniffSegment(Buffer.from([0xff, 0xfb, 0x90, 0x64])), 'audio/mpeg');
  const fmp4 = Buffer.alloc(16);
  fmp4.write('styp', 4, 'latin1');
  assert.equal(sniffSegment(fmp4), 'audio/mp4');
  assert.equal(sniffSegment(Buffer.from('<html></html>')), null);
  // Un service qui sert tout en octet-stream : le contenu tranche.
  assert.equal(segmentType('application/octet-stream', ts), 'video/mp2t');
  assert.equal(segmentType('application/octet-stream', Buffer.from('rien')), null);
  assert.equal(segmentType('audio/mp4', Buffer.from('rien')), 'audio/mp4');
  assert.equal(segmentType('text/html', ts), null);
});

test('hls : tailles bornées, plage transmise ou extraite (206)', async () => {
  const seen: Record<string, string>[] = [];
  let reply: () => UpstreamResponse = () => upstream(404);
  const connect: Connect = async (_url, headers) => {
    seen.push(headers);
    return reply();
  };
  reply = () => upstream(200, { 'content-type': HLS }, '#EXTM3U\n' + 'x'.repeat(2_000));
  await assert.rejects(
    fetchPlaylist('https://cdn.example/a.m3u8', { signal, connect, max: 1_000 }),
    (error: unknown) => error instanceof PlayerStreamError && error.status === 413,
  );
  reply = () => upstream(200, { 'content-type': 'video/mp2t', 'content-length': '99999999' }, ts);
  await assert.rejects(
    fetchSegment('https://cdn.example/s.ts', { signal, connect }),
    /trop lourd/u,
  );
  reply = () => upstream(200, { 'content-type': 'video/mp2t' }, ts);
  await assert.rejects(
    fetchSegment('https://cdn.example/s.ts', { signal, connect, max: 100 }),
    /trop lourd/u,
  );
  // Le service honore la plage : 206 et Content-Range recopiés.
  reply = () =>
    upstream(
      206,
      { 'content-type': 'video/mp2t', 'content-range': 'bytes 188-563/9999' },
      ts.subarray(0, 376),
    );
  const ranged = await fetchSegment('https://cdn.example/s.ts', {
    signal,
    connect,
    range: 'bytes=188-563',
  });
  assert.equal(seen.at(-1)!.Range, 'bytes=188-563');
  assert.equal(ranged.status, 206);
  assert.equal(ranged.contentRange, 'bytes 188-563/9999');
  // Le service l'ignore : la plage est extraite du morceau entier.
  reply = () => upstream(200, { 'content-type': 'application/octet-stream' }, ts);
  const sliced = await fetchSegment('https://cdn.example/s.ts', {
    signal,
    connect,
    range: 'bytes=188-375',
  });
  assert.equal(sliced.status, 206);
  assert.equal(sliced.contentRange, `bytes 188-375/${ts.length}`);
  assert.equal(sliced.body.length, 188);
  assert.equal(sliced.type, 'video/mp2t');
  // Une liste n'est jamais servie comme morceau.
  reply = () => upstream(200, { 'content-type': HLS }, '#EXTM3U\n');
  await assert.rejects(fetchSegment('https://cdn.example/s.ts', { signal, connect }), /audio/u);
});

test('hls : jetons bornés, une adresse déjà vue garde le sien', () => {
  const tokens = new HlsTokens(3);
  const a = tokens.issue('https://cdn.example/a.ts', 'segment');
  assert.match(a, /^[A-Za-z0-9_-]{22}$/u);
  assert.equal(tokens.issue('https://cdn.example/a.ts', 'segment'), a);
  assert.notEqual(tokens.issue('https://cdn.example/a.ts', 'playlist'), a);
  tokens.issue('https://cdn.example/b.ts', 'segment');
  tokens.issue('https://cdn.example/c.ts', 'segment');
  assert.equal(tokens.size, 3);
  assert.equal(tokens.get(a), undefined, 'le plus ancien est oublié');
});

// --- Routes ----------------------------------------------------------------------------------

const station: PlayRequest = {
  url: 'https://radio.example/direct/master.m3u8?jeton=secret',
  title: 'Radio HLS',
  subtitle: 'En direct',
  imageUrl: null,
  kind: 'live',
  addonId: 'lecteur_demo',
  instanceRef: 'radios',
};

function routesFixture(t: TestContext) {
  const player = new Player({ mirrorConnected: () => true, ackTimeoutMs: 20 });
  const logs = new DiagnosticLog();
  const app = Fastify();
  t.after(() => app.close());
  const replies: Record<string, () => UpstreamResponse> = {};
  const seen: string[] = [];
  const connect: Connect = async (url) => {
    seen.push(url.href);
    return (replies[url.href] ?? (() => upstream(404)))();
  };
  registerPlayer(app, {
    player,
    connect,
    logs,
    kiosk: async () => {},
    requireAdmin: async () => {},
  });
  const start = (request: PlayRequest = station) => {
    void player.play(request);
    return player.mirrorView()!.id;
  };
  return { player, app, replies, seen, logs, start };
}

const uris = (body: string) => body.split('\n').filter((line) => line.startsWith('/api/'));

test('routes hls : liste maîtresse, variante après redirection, morceau octet-stream', async (t) => {
  const f = routesFixture(t);
  f.replies['https://radio.example/direct/master.m3u8?jeton=secret'] = () =>
    upstream(
      200,
      { 'content-type': HLS },
      '#EXTM3U\n#EXT-X-STREAM-INF:CODECS="mp4a.40.2"\n128/index.m3u8\n',
    );
  // La variante est redirigée : ses morceaux se résolvent sur l'adresse finale.
  f.replies['https://radio.example/direct/128/index.m3u8'] = () =>
    upstream(302, { location: 'https://cdn.example/live/128/chunklist.m3u8?s=1' });
  f.replies['https://cdn.example/live/128/chunklist.m3u8?s=1'] = () =>
    upstream(200, { 'content-type': 'application/x-mpegURL' }, '#EXTM3U\n#EXTINF:6,\nseg1.ts\n');
  f.replies['https://cdn.example/live/128/seg1.ts'] = () =>
    upstream(200, { 'content-type': 'application/octet-stream' }, ts);

  const id = f.start();
  assert.equal(f.player.mirrorView()!.format, 'hls');
  const master = await f.app.inject(`/api/player/${id}/hls`);
  assert.equal(master.statusCode, 200);
  assert.equal(master.headers['content-type'], HLS);
  assert.ok(!master.body.includes('example') && !master.body.includes('secret'));
  assert.match(master.body, /BANDWIDTH=1/u);
  const [variant] = uris(master.body);
  assert.match(variant!, new RegExp(`^/api/player/${id}/hls/[A-Za-z0-9_-]{22}$`, 'u'));
  const media = await f.app.inject(variant!);
  assert.equal(media.statusCode, 200);
  const [segment] = uris(media.body);
  const served = await f.app.inject(segment!);
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['content-type'], 'video/mp2t');
  assert.equal(served.rawPayload.length, ts.length);
  assert.equal(f.seen.at(-1), 'https://cdn.example/live/128/seg1.ts');
});

test('routes hls : morceau sur le réseau local refusé, même après redirection', async (t) => {
  const f = routesFixture(t);
  f.replies['https://radio.example/direct/master.m3u8?jeton=secret'] = () =>
    upstream(
      200,
      { 'content-type': HLS },
      '#EXTM3U\n#EXTINF:6,\nhttps://192.168.1.10/seg.ts\n#EXTINF:6,\ndetour.ts\n#EXTINF:6,\nhttp://radio.example/clair.ts\n',
    );
  f.replies['https://radio.example/direct/detour.ts'] = () =>
    upstream(302, { location: 'https://10.0.0.2/seg.ts' });
  const id = f.start();
  const list = await f.app.inject(`/api/player/${id}/hls`);
  const [local, detour, clear] = uris(list.body);
  const count = f.seen.length;
  assert.equal((await f.app.inject(local!)).statusCode, 403);
  assert.equal(f.seen.length, count, 'l’adresse locale n’est jamais contactée');
  const redirected = await f.app.inject(detour!);
  assert.equal(redirected.statusCode, 403);
  assert.equal(f.seen.length, count + 1, 'la redirection vers le réseau local n’est pas suivie');
  assert.equal((await f.app.inject(clear!)).statusCode, 400, 'http refusé');
  // Un seul échec de morceau au journal par lecture.
  const logged = f.logs
    .snapshot()
    .entries.filter((entry) => entry.event === 'Morceau HLS refusé ou injoignable');
  assert.equal(logged.length, 1);
  assert.ok(!JSON.stringify(logged).includes('192.168'));
});

test('routes hls : jeton inconnu, ou d’une lecture arrêtée ou remplacée, refusé', async (t) => {
  const f = routesFixture(t);
  f.replies['https://radio.example/direct/master.m3u8?jeton=secret'] = () =>
    upstream(200, { 'content-type': HLS }, '#EXTM3U\n#EXTINF:6,\nseg.aac\n');
  f.replies['https://radio.example/direct/seg.aac'] = () =>
    upstream(200, { 'content-type': 'audio/aac' }, adts);
  const id = f.start();
  assert.equal((await f.app.inject(`/api/player/${id}/hls/inconnu`)).statusCode, 404);
  const [segment] = uris((await f.app.inject(`/api/player/${id}/hls`)).body);
  assert.equal((await f.app.inject(segment!)).statusCode, 200);
  // Le jeton d'une lecture ne vaut pas pour une autre.
  const token = segment!.split('/').at(-1)!;
  f.player.stop('miroir');
  assert.equal((await f.app.inject(segment!)).statusCode, 404);
  const next = f.start();
  assert.equal((await f.app.inject(`/api/player/${next}/hls/${token}`)).statusCode, 404);
  assert.equal((await f.app.inject(segment!)).statusCode, 404);
  assert.equal((await f.app.inject(`/api/player/${id}/hls`)).statusCode, 404);
});

test('routes hls : liste en direct relue, nouveaux morceaux sans nouveaux jetons pour les anciens', async (t) => {
  const f = routesFixture(t);
  let sequence = 1;
  const live = () =>
    [
      '#EXTM3U',
      `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
      ...[0, 1, 2].flatMap((offset) => ['#EXTINF:6,', `seg${sequence + offset}.aac`]),
    ].join('\n');
  f.replies['https://radio.example/direct/master.m3u8?jeton=secret'] = () =>
    upstream(200, { 'content-type': HLS }, live());
  const id = f.start();
  const first = uris((await f.app.inject(`/api/player/${id}/hls`)).body);
  const again = uris((await f.app.inject(`/api/player/${id}/hls`)).body);
  assert.deepEqual(again, first, 'même liste, mêmes jetons');
  sequence = 2;
  const next = uris((await f.app.inject(`/api/player/${id}/hls`)).body);
  assert.deepEqual(next.slice(0, 2), first.slice(1), 'les morceaux déjà vus gardent leur jeton');
  assert.ok(!first.includes(next[2]!), 'le nouveau morceau a son propre jeton');
});

test('routes hls : liste chiffrée ou trop lourde refusée, rien ne change pour un flux direct', async (t) => {
  const f = routesFixture(t);
  f.replies['https://radio.example/direct/master.m3u8?jeton=secret'] = () =>
    upstream(200, { 'content-type': HLS }, '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n');
  const id = f.start();
  const refused = await f.app.inject(`/api/player/${id}/hls`);
  assert.equal(refused.statusCode, 415);
  assert.match(refused.json().error, /chiffré/u);
  f.replies['https://radio.example/direct/master.m3u8?jeton=secret'] = () =>
    upstream(200, { 'content-type': HLS }, '#EXTM3U\n' + '#EXTINF:6,\na.aac\n'.repeat(40_000));
  assert.equal((await f.app.inject(`/api/player/${id}/hls`)).statusCode, 413);
  // Une page HTML n'est pas une liste.
  f.replies['https://radio.example/direct/master.m3u8?jeton=secret'] = () =>
    upstream(200, { 'content-type': 'text/html' }, '<html>');
  assert.equal((await f.app.inject(`/api/player/${id}/hls`)).statusCode, 415);
  // Un flux direct garde la voie /stream, et une liste m3u y reste refusée.
  const direct = f.start({ ...station, url: 'https://radio.example/liste.m3u' });
  assert.equal(f.player.mirrorView()!.format, 'direct');
  f.replies['https://radio.example/liste.m3u'] = () =>
    upstream(200, { 'content-type': 'audio/x-mpegurl' }, '#EXTM3U\nhttps://radio.example/a.mp3\n');
  const m3u = await f.app.inject(`/api/player/${direct}/stream`);
  assert.equal(m3u.statusCode, 415);
  assert.match(m3u.json().error, /m3u, pls/u);
});

test('hls : une adresse est HLS par son chemin .m3u8, paramètres non compris', () => {
  assert.equal(isHlsAddress('https://radio.example/a/master.m3u8'), true);
  assert.equal(isHlsAddress('https://radio.example/a/MASTER.M3U8?jeton=1'), true);
  assert.equal(isHlsAddress('https://radio.example/a.mp3?f=.m3u8'), false);
  assert.equal(isHlsAddress('https://radio.example/a.m3u'), false);
});

test('miroir : titre en cours lu dans une étiquette ID3', () => {
  assert.equal(
    id3Title(
      id3([
        ['TIT2', 'Clair de lune'],
        ['TPE1', 'Debussy'],
      ]),
    ),
    'Debussy – Clair de lune',
  );
  assert.equal(id3Title(id3([['TIT2', 'Le 15-18']])), 'Le 15-18');
  const txxx = Buffer.concat([Buffer.from([3]), Buffer.from('StreamTitle\0Artiste - Titre')]);
  const frame = Buffer.alloc(10);
  frame.write('TXXX', 0, 'latin1');
  frame.writeUInt32BE(txxx.length, 4);
  const tag = Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, txxx.length + 10]),
    frame,
    txxx,
  ]);
  assert.equal(id3Title(tag), 'Artiste - Titre');
  assert.equal(id3Title(id3([['PRIV', 'x']])), null);
  assert.equal(id3Title(Buffer.from('rien')), null);
});
