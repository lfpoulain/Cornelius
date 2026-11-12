import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { TailscalePortable } from '../server/tailscale.js';

/** Un faux tailscaled : son interface locale sur un socket, avec l'état qu'il garde en mémoire. */
async function fakeTailscaled(t: TestContext) {
  const state = {
    backend: 'NeedsLogin',
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
          AuthURL: state.authUrl,
          CertDomains: state.backend === 'Running' ? ['cornelius.exemple.ts.net'] : null,
          CurrentTailnet: { Name: 'exemple@example.com', MagicDNSSuffix: 'exemple.ts.net' },
          Self: {
            DNSName: state.backend === 'Running' ? 'cornelius.exemple.ts.net.' : '',
            TailscaleIPs: ['100.64.0.10'],
          },
          Peer: {
            a: { HostName: 'pixel', OS: 'android', Online: true, LastSeen: '0001-01-01T00:00:00Z' },
            b: { HostName: 'ipad', OS: 'iOS', Online: false, LastSeen: '2026-11-12T10:00:00Z' },
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
    status.devices.map((d) => [d.name, d.online, d.lastSeen]),
    [
      ['pixel', true, null],
      ['ipad', false, '2026-11-12T10:00:00Z'],
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

  // Déconnexion : le nom privé n'est plus accepté.
  await portable.setServing(true);
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
