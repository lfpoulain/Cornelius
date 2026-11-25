import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import type { MirrorState, StateEvent } from '../../shared/types';
import { login, screenshots } from './env';

/** Dix secondes de la à 440 Hz, en WAV 8 kHz : un flux que le miroir sait lire. */
function tone(seconds = 10): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    wav.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * index) / rate) * 8000),
      44 + index * 2,
    );
  return wav;
}

const playerId = 'lecture-essai';

test('lecteur : bandeau, flux relayé, son baissé puis coupé pendant la conversation, arrêt', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // La CSP réelle du miroir ne s'ouvre à aucun hôte de flux.
  const home = await page.request.get('/');
  const csp = home.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  // `blob:` pour la source MSE de hls.js ; ni hôte de flux, ni travailleur.
  expect(csp).toContain("media-src 'self' blob:;");
  expect(csp).not.toContain('worker-src');
  expect(csp).not.toMatch(/https:(?!\/\/)/u);

  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  let sequence = 1;
  const event = (patch: Partial<MirrorState>): StateEvent => ({
    ...initial,
    bootId: 'player-browser-fixture',
    sequence: sequence++,
    sentAt: Date.now(),
    state: {
      ...initial.state,
      openaiBlocked: true,
      browserConnected: true,
      cards: [],
      ambientDisplays: [],
      screensaver: undefined,
      ...patch,
    },
  });
  const playing: MirrorState['player'] = {
    id: playerId,
    title: 'Radio Démo',
    subtitle: 'Station de démonstration',
    image: true,
    kind: 'live',
    format: 'direct',
    status: 'playing',
    volume: 6,
  };
  const reports: { id: string; status: string }[] = [];
  const stops: number[] = [];
  let socket: WebSocketRoute | null = null;
  const send = (patch: Partial<MirrorState>) => {
    const next = event(patch);
    socket?.send(JSON.stringify(next));
    return next;
  };
  const wav = tone();
  await page.route(`**/api/player/${playerId}/stream`, (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }),
  );
  await page.route(`**/api/player/${playerId}/image`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPpfDwAE5gJZx9Z0nQAAAABJRU5ErkJggg==',
        'base64',
      ),
    }),
  );
  await page.route('**/api/player/status', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/player/stop', async (route) => {
    stops.push(Date.now());
    await route.fulfill({ json: { ok: true } });
    send({ player: null });
  });
  const idle = event({ player: null });
  await page.route('**/api/state', (route) => route.fulfill({ json: idle }));
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    socket = route;
    route.send(JSON.stringify(idle));
  });
  await page.goto('/');
  // Un geste sur la page, comme « Activer la voix » : le navigateur autorise alors le son.
  await page.mouse.click(10, 10);
  // Le miroir ouvre sa connexion après le chargement : attendre qu’elle soit routée.
  await expect.poll(() => socket !== null).toBe(true);

  send({ player: playing });
  const band = page.getByRole('complementary', { name: 'En cours de lecture' });
  await expect(band).toContainText('Radio Démo');
  await expect(band).toContainText('En direct');
  await expect(band.locator('img')).toHaveAttribute('src', `/api/player/${playerId}/image`);
  await expect.poll(() => reports).toContainEqual({ id: playerId, status: 'playing' });
  const audio = page.locator('audio.mirror-player-audio');
  const volume = () => audio.evaluate((element: HTMLAudioElement) => element.volume);
  const paused = () => audio.evaluate((element: HTMLAudioElement) => element.paused);
  await expect.poll(volume).toBeCloseTo(0.6, 2);
  expect(await paused()).toBe(false);
  await page.screenshot({ path: `${screenshots}/lecteur-miroir.png` });

  // Cornelius écoute : le son baisse à 15 %.
  const session = {
    ...initial.state.session,
    phase: 'ready' as const,
    interactionId: 'conversation-essai',
    satellite: null,
  };
  send({
    player: playing,
    session,
    voice: { phase: 'listening', startedAt: Date.now(), endsAt: null },
  });
  await expect(band).toContainText('Son baissé');
  await expect.poll(volume).toBeCloseTo(0.09, 2);
  // Cornelius parle : coupé, le flux continue.
  send({
    player: playing,
    session,
    voice: { phase: 'speaking', startedAt: Date.now(), endsAt: null },
  });
  await expect.poll(volume).toBe(0);
  expect(await paused()).toBe(false);
  // Conversation d'un satellite : le miroir garde son volume.
  send({
    player: playing,
    session: { ...session, satellite: { id: 'cuisine', name: 'Cuisine' } },
    voice: { phase: 'speaking', startedAt: Date.now(), endsAt: null },
  });
  await expect.poll(volume).toBeCloseTo(0.6, 2);

  // Un fichier se met en pause pendant la conversation, puis reprend.
  const podcast = { ...playing, kind: 'file' as const, subtitle: null };
  send({ player: podcast, session });
  await expect.poll(paused).toBe(true);
  await expect(band).toContainText('En pause');
  send({ player: podcast, session: initial.state.session });
  await expect.poll(paused).toBe(false);

  await band.getByRole('button', { name: 'Arrêter Radio Démo' }).click();
  await expect(band).toHaveCount(0);
  expect(stops).toHaveLength(1);
  await expect(audio).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('lecteur : une lecture qui échoue est signalée au serveur', async ({ page }) => {
  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  const fixture: StateEvent = {
    ...initial,
    bootId: 'player-error-fixture',
    sequence: 1,
    sentAt: Date.now(),
    state: {
      ...initial.state,
      openaiBlocked: true,
      browserConnected: true,
      cards: [],
      ambientDisplays: [],
      screensaver: undefined,
      player: {
        id: 'lecture-cassee',
        title: 'Flux cassé',
        subtitle: null,
        image: false,
        kind: 'live',
        format: 'direct',
        status: 'loading',
        volume: 6,
      },
    },
  };
  const reports: { id: string; status: string; reason?: string }[] = [];
  await routeMirror(page, fixture);
  await page.route('**/api/player/lecture-cassee/stream', (route) =>
    route.fulfill({ status: 415, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/player/status', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.mouse.click(10, 10);
  const band = page.getByRole('complementary', { name: 'En cours de lecture' });
  await expect(band).toContainText('Connexion…');
  await expect.poll(() => reports.map((report) => report.status)).toContain('error');
  expect(reports.find((report) => report.status === 'error')?.reason).toBeTruthy();
});

test('lecteur : un fichier demandé pendant la conversation est accusé, en pause, puis joue', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  const session = {
    ...initial.state.session,
    phase: 'ready' as const,
    interactionId: 'conversation-fichier',
    satellite: null,
  };
  let sequence = 1;
  const event = (patch: Partial<MirrorState>): StateEvent => ({
    ...initial,
    bootId: 'player-file-fixture',
    sequence: sequence++,
    sentAt: Date.now(),
    state: {
      ...initial.state,
      openaiBlocked: true,
      browserConnected: true,
      cards: [],
      ambientDisplays: [],
      screensaver: undefined,
      ...patch,
    },
  });
  // Rien ne joue encore : aucun élément audio existant à réutiliser.
  const start = event({
    player: null,
    session,
    voice: { phase: 'listening', startedAt: Date.now(), endsAt: null },
  });
  const reports: { id: string; status: string }[] = [];
  let socket: WebSocketRoute | null = null;
  await page.route('**/api/player/episode/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: tone() }),
  );
  await page.route('**/api/player/status', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/state', (route) => route.fulfill({ json: start }));
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    socket = route;
    route.send(JSON.stringify(start));
  });
  await page.goto('/');
  await page.mouse.click(10, 10);
  await expect.poll(() => socket !== null).toBe(true);
  const episode: MirrorState['player'] = {
    id: 'episode',
    title: 'Épisode 12',
    subtitle: null,
    image: false,
    kind: 'file',
    format: 'direct',
    status: 'loading',
    volume: 6,
  };
  // Le modèle vient d'appeler l'outil : Cornelius réfléchit, la conversation est ouverte.
  socket!.send(
    JSON.stringify(
      event({
        player: episode,
        session,
        voice: { phase: 'thinking', startedAt: Date.now(), endsAt: null },
      }),
    ),
  );
  // Accusé sans attendre la fin de la conversation : l'outil répond aussitôt.
  await expect
    .poll(() => reports, { timeout: 3_000 })
    .toContainEqual({ id: 'episode', status: 'playing' });
  const audio = page.locator('audio.mirror-player-audio');
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  // Le serveur, accusé reçu, passe la lecture à « playing » : le bandeau dit la pause.
  socket!.send(
    JSON.stringify(
      event({
        player: { ...episode, status: 'playing' },
        session,
        voice: { phase: 'speaking', startedAt: Date.now(), endsAt: null },
      }),
    ),
  );
  await expect(page.getByRole('complementary', { name: 'En cours de lecture' })).toContainText(
    'En pause',
  );
  // Fin de la conversation : le fichier part.
  socket!.send(
    JSON.stringify(
      event({ player: { ...episode, status: 'playing' }, session: initial.state.session }),
    ),
  );
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(false);
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.volume))
    .toBeCloseTo(0.6, 2);
  expect(reports.filter((report) => report.status === 'playing')).toHaveLength(1);
  expect(errors).toEqual([]);
});

/** Étiquette ID3 v2.3 avec des cadres texte UTF-8. */
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
  const size = body.length;
  const head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  head[6] = (size >> 21) & 0x7f;
  head[7] = (size >> 14) & 0x7f;
  head[8] = (size >> 7) & 0x7f;
  head[9] = size & 0x7f;
  return Buffer.concat([head, body]);
}

/**
 * Morceau HLS d'audio AAC « empaqueté » : une étiquette ID3 puis `seconds` secondes de
 * trames ADTS silencieuses (AAC-LC, 44,1 kHz, mono ; la trame muette de hls.js).
 */
function silentAac(seconds: number, frames: [string, string][]): Buffer {
  const payload = Buffer.from([0x00, 0xc8, 0x00, 0x80, 0x23, 0x80]);
  const length = 7 + payload.length;
  const header = Buffer.from([
    0xff,
    0xf1,
    0x50,
    0x40 | (length >> 11),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc,
  ]);
  const count = Math.ceil((seconds * 44_100) / 1024);
  const frame = Buffer.concat([header, payload]);
  return Buffer.concat([id3(frames), ...Array.from({ length: count }, () => frame)]);
}

test('lecteur : un flux HLS se lit par hls.js, liste et morceaux relayés, titre ID3 affiché', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = (await (await page.request.get('/api/state')).json()) as StateEvent;
  const id = 'lecture-hls';
  const fixture: StateEvent = {
    ...initial,
    bootId: 'player-hls-fixture',
    sequence: 1,
    sentAt: Date.now(),
    state: {
      ...initial.state,
      openaiBlocked: true,
      browserConnected: true,
      cards: [],
      ambientDisplays: [],
      screensaver: undefined,
      player: {
        id,
        title: 'Radio HLS',
        subtitle: 'En direct',
        image: false,
        kind: 'live',
        format: 'hls',
        status: 'loading',
        volume: 6,
      },
    },
  };
  const reports: { id: string; status: string; reason?: string }[] = [];
  const requested: string[] = [];
  await page.route('**/api/player/status', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  // La liste et les morceaux, tels que le serveur les sert : des jetons sous la même origine.
  await page.route(`**/api/player/${id}/hls**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    if (path === `/api/player/${id}/hls`)
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-TARGETDURATION:4',
          '#EXT-X-MEDIA-SEQUENCE:1',
          ...[1, 2, 3].flatMap((n) => ['#EXTINF:4.0,', `/api/player/${id}/hls/jeton-${n}`]),
          '#EXT-X-ENDLIST',
          '',
        ].join('\n'),
      });
    return route.fulfill({
      status: 200,
      contentType: 'audio/aac',
      body: silentAac(4, [
        ['TPE1', 'Debussy'],
        ['TIT2', 'Clair de lune'],
      ]),
    });
  });
  await routeMirror(page, fixture);
  await page.goto('/');
  await page.mouse.click(10, 10);

  const band = page.getByRole('complementary', { name: 'En cours de lecture' });
  await expect(band).toContainText('Radio HLS');
  await expect.poll(() => reports).toContainEqual({ id, status: 'playing' });
  await expect(band).toContainText('Debussy – Clair de lune');
  // hls.js lit la liste puis les morceaux par leurs jetons, jamais le flux direct.
  expect(requested[0]).toBe(`/api/player/${id}/hls`);
  expect(requested).toContain(`/api/player/${id}/hls/jeton-1`);
  const audio = page.locator('audio.mirror-player-audio');
  expect(await audio.evaluate((element: HTMLAudioElement) => element.src)).toMatch(/^blob:/u);
  expect(reports.filter((report) => report.status === 'error')).toEqual([]);
  expect(errors).toEqual([]);
});

async function routeMirror(page: Page, fixture: StateEvent) {
  await page.route('**/api/state', (route) => route.fulfill({ json: fixture }));
  await page.routeWebSocket('**/events?role=kiosk', (route) => {
    route.send(JSON.stringify(fixture));
  });
}

test('administration : ce qui joue sur le miroir s’arrête depuis Modules', async ({ page }) => {
  const player: MirrorState['player'] = {
    id: 'lecture-admin',
    title: 'Radio Démo',
    subtitle: 'Station de démonstration',
    image: false,
    kind: 'live',
    format: 'direct',
    status: 'playing',
    volume: 6,
  };
  const withPlayer = (value: StateEvent) => {
    if (value.type === 'state') value.state.player = player;
    return value;
  };
  await page.routeWebSocket('**/events?role=admin', (route) => {
    const server = route.connectToServer();
    server.onMessage((message) =>
      route.send(JSON.stringify(withPlayer(JSON.parse(String(message))))),
    );
  });
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: withPlayer(await response.json()) });
  });
  let stopped = false;
  await page.route('**/api/admin/player/stop', async (route) => {
    stopped = true;
    await route.fulfill({ json: { ok: true } });
  });
  await login(page, '/admin#modules');
  const status = page.getByRole('status', { name: 'Lecture sur le miroir' });
  await expect(status).toContainText(
    'En cours sur le miroir : Radio Démo · Station de démonstration',
  );
  await status.getByRole('button', { name: 'Arrêter' }).click();
  await expect.poll(() => stopped).toBe(true);
});
