import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';
import { TailscalePortable } from '../server/tailscale.js';

/** Un faux tailscaled : son interface locale sur un socket, avec l'état qu'il garde en mémoire. */
async function fakeTailscaled(t: TestContext) {
  const state = {
    backend: 'NeedsLogin',
    tun: true,
    authUrl: '' as string,
    prefs: {} as Record<string, unknown>,
    serve: {} as Record<string, any>,
    etag: '"v1"',
    calls: [] as string[],
    headers: [] as IncomingMessage['headers'][],
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      state.calls.push(`${req.method} ${req.url}`);
      state.headers.push(req.headers);
      const send = (status: number, value?: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(value === undefined ? '' : JSON.stringify(value));
      };
      if (req.url === '/localapi/v0/status')
        return send(200, {
          BackendState: state.backend,
          TUN: state.tun,
          AuthURL: state.authUrl,
          CertDomains: state.backend === 'Running' ? ['cornelius.exemple.ts.net'] : null,
          CurrentTailnet: { Name: 'exemple@example.com', MagicDNSSuffix: 'exemple.ts.net' },
          Self: {
            ID: 'nCornelius',
            DNSName: state.backend === 'Running' ? 'cornelius.exemple.ts.net.' : '',
            TailscaleIPs: ['100.64.0.10'],
          },
          Peer: {
            a: {
              ID: 'n1',
              HostName: 'pixel',
              OS: 'android',
              Online: true,
              LastSeen: '0001-01-01T00:00:00Z',
            },
            b: {
              ID: 'n2',
              HostName: 'ipad',
              OS: 'iOS',
              Online: false,
              LastSeen: '2026-11-12T10:00:00Z',
            },
          },
        });
      if (req.url === '/localapi/v0/prefs' && req.method === 'PATCH') {
        state.prefs = JSON.parse(body);
        return send(200, state.prefs);
      }
      if (req.url === '/localapi/v0/login-interactive') {
        state.authUrl = 'https://login.tailscale.com/a/essai';
        return send(204);
      }
      if (req.url === '/localapi/v0/serve-config' && req.method === 'GET')
        return send(200, state.serve, { ETag: state.etag });
      if (req.url === '/localapi/v0/serve-config' && req.method === 'POST') {
        if (req.headers['if-match'] !== state.etag) return send(412, { error: 'etag' });
        state.serve = JSON.parse(body);
        state.etag = '"v2"';
        return send(200);
      }
      if (req.url === '/localapi/v0/logout') {
        state.backend = 'NeedsLogin';
        return send(204);
      }
      send(404, { error: 'inconnu' });
    });
  });
  const dir = mkdtempSync(join(tmpdir(), 'cornelius-tailscale-'));
  const socket =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\cornelius-tailscale-${process.pid}-${Date.now()}`
      : join(dir, 'tailscaled.sock');
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { state, socket };
}

const target = 'https+insecure://cornelius:3443';

test('sans socket, Cornelius portable est absent', async () => {
  const portable = new TailscalePortable(null, target);
  assert.equal(portable.configured, false);
  const status = await portable.status();
  assert.equal(status.configured, false);
  assert.equal(status.state, 'unavailable');
  assert.deepEqual(portable.hostnames(), []);
});

test('tailscaled injoignable : état « unavailable » avec la raison, sans exception', async () => {
  const portable = new TailscalePortable(join(tmpdir(), 'absent-tailscaled.sock'), target, 500);
  const status = await portable.status();
  assert.equal(status.configured, true);
  assert.equal(status.state, 'unavailable');
  assert.ok(status.error);
});

test('connexion au compte, publication, appareils et déconnexion', async (t) => {
  const { state, socket } = await fakeTailscaled(t);
  const portable = new TailscalePortable(socket, target);

  // Non connecté : pas de lien tant qu'on ne l'a pas demandé.
  let status = await portable.status();
  assert.equal(status.state, 'needs-login');
  assert.equal(status.authUrl, null);

  // Le bouton « Connecter » : les préférences, puis le lien de connexion.
  await portable.connect();
  assert.deepEqual(state.prefs, { WantRunning: true, WantRunningSet: true });
  status = await portable.status();
  assert.equal(status.authUrl, 'https://login.tailscale.com/a/essai');
  // Chaque requête porte l'hôte et l'en-tête qu'attend tailscaled.
  assert.ok(state.headers.every((h) => h.host === 'local-tailscaled.sock'));
  assert.ok(state.headers.every((h) => h['sec-tailscale'] === 'localapi'));

  // Le compte est relié.
  state.backend = 'Running';
  status = await portable.status();
  assert.equal(status.state, 'running');
  assert.equal(status.dnsName, 'cornelius.exemple.ts.net');
  assert.equal(status.https, true);
  assert.equal(status.serving, false);
  assert.equal(status.url, null);
  assert.deepEqual(portable.hostnames(), ['cornelius.exemple.ts.net']);
  // En ligne d'abord ; une date « jamais » n'est pas une date.
  assert.deepEqual(
    status.devices.map((d) => [d.id, d.name, d.online, d.lastSeen]),
    [
      ['n1', 'pixel', true, null],
      ['n2', 'ipad', false, '2026-11-12T10:00:00Z'],
    ],
  );

  // L'interrupteur : HTTPS sur 443 vers Cornelius, sur le réseau privé seulement.
  await portable.setServing(true);
  assert.deepEqual(state.serve, {
    TCP: { '443': { HTTPS: true } },
    Web: { 'cornelius.exemple.ts.net:443': { Handlers: { '/': { Proxy: target } } } },
  });
  const served: Record<string, any> = state.serve;
  assert.equal(served.AllowFunnel, undefined, 'jamais publié sur Internet');
  status = await portable.status();
  assert.equal(status.serving, true);
  assert.equal(status.url, 'https://cornelius.exemple.ts.net');

  // Une autre publication du même tailscaled est gardée quand on ferme Cornelius portable.
  served.Web['autre.exemple.ts.net:8443'] = { Handlers: { '/': { Proxy: 'http://autre' } } };
  await portable.setServing(false);
  assert.deepEqual(Object.keys(state.serve.Web), ['autre.exemple.ts.net:8443']);
  assert.equal(state.serve.TCP['443'], undefined);

  // Un tailscaled qui publie autre chose n'est pas dédié à Cornelius : pas de déconnexion.
  await portable.setServing(true);
  await assert.rejects(portable.logout(), /d’autres services/u);
  assert.ok(!state.calls.includes('POST /localapi/v0/logout'));

  // Déconnexion : le nom privé n'est plus accepté.
  delete (state.serve as Record<string, any>).Web['autre.exemple.ts.net:8443'];
  await portable.logout();
  assert.ok(state.calls.includes('POST /localapi/v0/logout'));
  assert.deepEqual(portable.hostnames(), []);
  assert.equal(state.serve.Web['cornelius.exemple.ts.net:443'], undefined);
});

test('publication refusée sans réseau privé : message clair', async (t) => {
  const { socket } = await fakeTailscaled(t);
  const portable = new TailscalePortable(socket, target);
  await assert.rejects(portable.setServing(true), /pas encore connecté/u);
});

test('un port 443 déjà publié par autre chose n’est jamais remplacé ni retiré', async (t) => {
  const { state, socket } = await fakeTailscaled(t);
  state.backend = 'Running';
  const autre = {
    TCP: { '443': { HTTPS: true } },
    Web: {
      'cornelius.exemple.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } } },
    },
  };
  state.serve = structuredClone(autre);
  const portable = new TailscalePortable(socket, target);
  await assert.rejects(portable.setServing(true), /publie déjà autre chose/u);
  // Fermer Cornelius portable ne touche pas à ce qui n'est pas à lui.
  await portable.setServing(false);
  assert.deepEqual(state.serve, autre);
  assert.ok(!state.calls.includes('POST /localapi/v0/serve-config'));
});

/** Cornelius avec un tailscaled voisin, relié au compte : son nom privé est connu. */
async function appWithPortable(
  t: TestContext,
  overrides: Partial<AppConfig> = {},
  { tun = true }: { tun?: boolean } = {},
) {
  const { state, socket } = await fakeTailscaled(t);
  state.backend = 'Running';
  state.tun = tun;
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-portable-images-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: 'mot-de-passe-portable',
      origins: ['http://localhost'],
      secureCookies: false,
      lan: true,
      httpsPort: 3443,
      tailscaleSocket: socket,
      ...overrides,
    } satisfies AppConfig,
    { timers: false, imageGenerationRoot: imageRoot },
  );
  const app = services.app;
  await app.ready();
  t.after(async () => {
    await app.close();
    rmSync(imageRoot, { recursive: true, force: true });
  });
  // Cornelius lit l'état de tailscaled dès le démarrage : le nom privé est déjà connu.
  return app;
}

const ts = 'cornelius.exemple.ts.net';

test('relayé depuis la boucle locale, un téléphone Tailscale reste un appareil distant', async (t) => {
  const app = await appWithPortable(t);
  const get = (url: string, host = ts) => app.inject({ url, headers: { host } });
  // tailscaled relaie depuis 127.0.0.1 : le nom privé est accepté, un nom inconnu refusé.
  assert.equal((await get('/api/health')).statusCode, 200);
  assert.equal((await get('/api/health', 'autre.exemple.ts.net')).statusCode, 403);
  // Pas « l'ordinateur du miroir » : l'état du miroir demande une autorisation…
  assert.equal((await get('/api/state')).statusCode, 401);
  assert.equal((await get('/api/auth?role=kiosk')).json().role, null);
  // … la perception et le générateur d'images restent réservés à la machine…
  for (const url of ['/perception', '/image-generation'])
    assert.equal((await get(url)).statusCode, 403, url);
  // … et la machine, elle, n'a toujours besoin de rien.
  assert.equal((await get('/api/state', 'localhost')).statusCode, 200);
});

test('par Cornelius portable, le mot de passe par défaut n’ouvre pas l’administration', async (t) => {
  const app = await appWithPortable(t, { adminPassword: 'cornelius' });
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { host: ts, origin: `https://${ts}` },
    payload: { password: 'cornelius' },
  });
  assert.equal(login.statusCode, 403);
});

test('réseau local fermé : Cornelius portable reste ouvert, relayé en HTTP', async (t) => {
  const app = await appWithPortable(t, { lan: false });
  const health = (remoteAddress: string, host = ts) =>
    app.inject({ url: '/api/health', remoteAddress, headers: { host } });
  // Depuis la boucle locale : tailscaled partage le réseau de Cornelius, seul port ouvert.
  assert.equal((await health('127.0.0.1')).statusCode, 200);
  // Une adresse privée (un conteneur voisin) ou publique reste refusée, même avec le nom
  // privé : le serveur n'écoute que sur la boucle locale ; le réseau local reste fermé.
  assert.equal((await health('172.18.0.5')).statusCode, 403);
  assert.equal((await health('203.0.113.9')).statusCode, 403);
  assert.equal((await health('192.168.1.30', '192.168.1.20:3443')).statusCode, 403);
  // Le navigateur parle HTTPS à tailscaled, qui relaie en HTTP : son origine est acceptée, et la
  // connexion pose un cookie sécurisé.
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { host: ts, origin: `https://${ts}` },
    payload: { password: 'mot-de-passe-portable' },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.ok(login.cookies.every((cookie) => cookie.secure));
});

test('relayé avec un Host choisi par le client (« localhost ») : jamais la machine', async (t) => {
  for (const lan of [true, false]) {
    const app = await appWithPortable(t, { lan, adminPassword: 'cornelius' });
    // tailscale serve choisit la publication d'après le SNI, relaie le Host du client tel quel
    // et pose toujours X-Forwarded-For.
    const relay = { host: 'localhost', 'x-forwarded-for': '100.64.0.20' };
    assert.equal(
      (await app.inject({ url: '/api/state', headers: relay })).statusCode,
      401,
      `lan=${lan}`,
    );
    assert.equal(
      (await app.inject({ url: '/api/auth?role=kiosk', headers: relay })).json().role,
      null,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { ...relay, origin: 'http://localhost' },
      payload: { password: 'cornelius' },
    });
    assert.equal(login.statusCode, 403, `lan=${lan}`);
    for (const url of ['/perception', '/image-generation'])
      assert.equal((await app.inject({ url, headers: relay })).statusCode, 403, url);
    // Le même nom privé mis dans CORNELIUS_ALLOWED_HOSTS ne vaut pas mieux.
    const named = { host: 'autre.exemple.ts.net', 'x-forwarded-for': '100.64.0.20' };
    const allowed = await appWithPortable(t, { lan, allowedHosts: ['autre.exemple.ts.net'] });
    assert.notEqual(
      (await allowed.inject({ url: '/api/state', headers: named })).statusCode,
      200,
      `lan=${lan}`,
    );
  }
});

test('une publication publique (funnel) restée sur ce nom est retirée', async (t) => {
  const { state, socket } = await fakeTailscaled(t);
  state.backend = 'Running';
  state.serve = { AllowFunnel: { 'cornelius.exemple.ts.net:443': true } };
  const portable = new TailscalePortable(socket, target);
  await portable.setServing(true);
  assert.equal(state.serve.AllowFunnel, undefined);
  assert.deepEqual(state.serve.TCP, { '443': { HTTPS: true } });
  // Déjà publié, mais funnel rajouté entre-temps : retiré aussi.
  state.serve.AllowFunnel = { 'cornelius.exemple.ts.net:443': true, 'autre:443': true };
  await portable.setServing(true);
  assert.deepEqual(state.serve.AllowFunnel, { 'autre:443': true });
});

test('un Tailscale que Cornelius n’a pas connecté n’est jamais déconnecté', async (t) => {
  const { state, socket } = await fakeTailscaled(t);
  // Déjà relié à un compte (le Tailscale de la machine hôte) : pas de connexion par Cornelius.
  state.backend = 'Running';
  const portable = new TailscalePortable(socket, target);
  await portable.status();
  await assert.rejects(portable.logout(), /pas été connecté par Cornelius/u);
  assert.ok(!state.calls.includes('POST /localapi/v0/logout'));
});

test('réseau local fermé, Tailscale en espace utilisateur : la boucle locale n’est plus la machine', async (t) => {
  // network_mode: service:cornelius et --tun=userspace-networking : un pair qui ouvre
  // http://100.x.y.z:3000 est redirigé vers 127.0.0.1:3000, sans X-Forwarded-For.
  const app = await appWithPortable(t, { lan: false, adminPassword: 'cornelius' }, { tun: false });
  const direct = { host: 'localhost' };
  assert.notEqual((await app.inject({ url: '/api/state', headers: direct })).statusCode, 200);
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { ...direct, origin: 'http://localhost' },
    payload: { password: 'cornelius' },
  });
  assert.notEqual(login.statusCode, 200);
  // Les téléphones relayés par tailscale serve passent toujours, comme appareils autorisables.
  assert.equal((await app.inject({ url: '/api/health', headers: { host: ts } })).statusCode, 200);
  // Avec un TUN du noyau, une connexion directe garde l'adresse 100.x du pair : la machine reste
  // la machine.
  const noyau = await appWithPortable(t, { lan: false }, { tun: true });
  assert.equal(
    (await noyau.inject({ url: '/api/state', headers: { host: 'localhost' } })).statusCode,
    200,
  );
});

test('un Tailscale déjà relié mais arrêté (Stopped) ne devient pas celui de Cornelius', async (t) => {
  const { state, socket } = await fakeTailscaled(t);
  state.backend = 'Stopped';
  const portable = new TailscalePortable(socket, target);
  await portable.connect();
  state.backend = 'Running';
  await portable.status();
  await assert.rejects(portable.logout(), /pas été connecté par Cornelius/u);
  assert.ok(!state.calls.includes('POST /localapi/v0/logout'));
});
