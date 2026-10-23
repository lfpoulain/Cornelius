import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';
import {
  allowedHostname,
  ensureCertificate,
  isLoopback,
  isPrivateAddress,
  machineHostnames,
  tlsWithHttpRedirect,
} from '../server/network.js';

test('adresses de la machine et du réseau local', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.ok(isLoopback(address));
  assert.ok(!isLoopback('192.168.1.10'));
  for (const address of [
    '10.0.0.4',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.20',
    '::ffff:192.168.1.20',
    '169.254.3.3',
    'fd12:3456::1',
    'fe80::1',
  ])
    assert.ok(isPrivateAddress(address), address);
  for (const address of ['8.8.8.8', '172.32.0.1', '192.0.2.2', '2001:db8::1', '', undefined])
    assert.ok(!isPrivateAddress(address), String(address));
});

test('hôtes acceptés : boucle locale toujours, réseau local seulement s’il est ouvert', () => {
  assert.ok(allowedHostname('localhost', false, []));
  assert.ok(allowedHostname('127.0.0.1', false, []));
  assert.ok(allowedHostname('[::1]', false, []));
  assert.ok(!allowedHostname('192.168.1.20', false, []));
  assert.ok(allowedHostname('192.168.1.20', true, []));
  assert.ok(!allowedHostname('8.8.8.8', true, []));
  assert.ok(!allowedHostname('evil.example', true, []));
  assert.ok(allowedHostname('Miroir.Lan', true, ['miroir.lan']));
  const [name] = machineHostnames();
  if (name) assert.ok(allowedHostname(name, true, []));
});

test('certificat autosigné : créé une fois, réutilisé, recréé si les adresses changent', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-tls-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = { directory, names: ['miroir'], addresses: ['192.168.1.20'] };
  const first = await ensureCertificate(options);
  assert.ok(first.generated);
  const x509 = new X509Certificate(first.cert);
  assert.match(x509.subjectAltName ?? '', /DNS:miroir/);
  assert.match(x509.subjectAltName ?? '', /IP Address:192\.168\.1\.20/);
  assert.equal(first.fingerprint, x509.fingerprint256);
  if (process.platform !== 'win32')
    assert.equal(statSync(join(directory, 'key.pem')).mode & 0o777, 0o600);
  const again = await ensureCertificate(options);
  assert.ok(!again.generated);
  assert.equal(again.fingerprint, first.fingerprint);
  const moved = await ensureCertificate({ ...options, addresses: ['192.168.1.21'] });
  assert.ok(moved.generated);
  assert.notEqual(moved.fingerprint, first.fingerprint);
  // Satellites : la clé, et donc son empreinte, survit au nouveau certificat ; signé en SHA-256.
  assert.equal(moved.keyFingerprint, first.keyFingerprint);
  assert.match(first.keyFingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/u);
  assert.equal(
    createHash('sha256')
      .update(new X509Certificate(moved.cert).publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')
      .toUpperCase()
      .replace(/(..)(?!$)/g, '$1:'),
    moved.keyFingerprint,
  );
});

test('port du réseau local : HTTPS servi, HTTP renvoyé vers l’adresse chiffrée', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-tls-'));
  const certificate = await ensureCertificate({ directory, names: [], addresses: ['127.0.0.1'] });
  const tls = createHttpsServer({ key: certificate.key, cert: certificate.cert }, (_req, res) =>
    res.end('chiffré'),
  );
  const front = tlsWithHttpRedirect(tls, (host) => host === '127.0.0.1');
  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    front.close();
    tls.closeAllConnections();
    rmSync(directory, { recursive: true, force: true });
  });
  const { port } = front.address() as AddressInfo;
  const get = (send: typeof httpsRequest, url: string, host?: string) =>
    new Promise<{ status?: number; location?: string; body: string }>((resolve, reject) => {
      const req = send(url, { rejectUnauthorized: false, headers: host ? { host } : {} }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, location: res.headers.location, body }),
        );
      });
      req.on('error', reject);
      req.end();
    });
  assert.equal((await get(httpsRequest, `https://127.0.0.1:${port}/`)).body, 'chiffré');
  const redirected = await get(
    httpRequest as typeof httpsRequest,
    `http://127.0.0.1:${port}/admin?x=1`,
  );
  assert.equal(redirected.status, 301);
  assert.equal(redirected.location, `https://127.0.0.1:${port}/admin?x=1`);
  // Un hôte inconnu n'est pas renvoyé ailleurs.
  const foreign = await get(
    httpRequest as typeof httpsRequest,
    `http://127.0.0.1:${port}/`,
    'evil.example',
  );
  assert.equal(foreign.status, 400);
  assert.equal(foreign.location, undefined);
});

async function fixture(t: TestContext, overrides: Partial<AppConfig> = {}) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-network-images-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: 'mot-de-passe-reseau',
      origins: ['http://localhost'],
      secureCookies: false,
      lan: true,
      httpsPort: 3443,
      ...overrides,
    } satisfies AppConfig,
    { timers: false, imageGenerationRoot: imageRoot },
  );
  await services.app.ready();
  t.after(async () => {
    await services.app.close();
    rmSync(imageRoot, { recursive: true, force: true });
  });
  return services.app;
}

test('réseau local : un appareil de la maison ouvre Cornelius, une adresse publique est refusée', async (t) => {
  const app = await fixture(t);
  const lan = await app.inject({
    url: '/api/health',
    remoteAddress: '192.168.1.30',
    headers: { host: '192.168.1.20:3443' },
  });
  assert.equal(lan.statusCode, 200);
  const outside = await app.inject({
    url: '/api/health',
    remoteAddress: '203.0.113.9',
    headers: { host: '192.168.1.20:3443' },
  });
  assert.equal(outside.statusCode, 403);
  const rebinding = await app.inject({
    url: '/api/health',
    remoteAddress: '192.168.1.30',
    headers: { host: 'evil.example' },
  });
  assert.equal(rebinding.statusCode, 403);
});

test('réseau local fermé : seule la machine elle-même est servie', async (t) => {
  const app = await fixture(t, { lan: false });
  const lan = await app.inject({
    url: '/api/health',
    remoteAddress: '192.168.1.30',
    headers: { host: '192.168.1.20:3443' },
  });
  assert.equal(lan.statusCode, 403);
  const local = await app.inject({ url: '/api/health', headers: { host: 'localhost' } });
  assert.equal(local.statusCode, 200);
});

test('réseau local : connexion avec l’origine de la page, perception réservée à la machine', async (t) => {
  const app = await fixture(t);
  const host = '192.168.1.20:3443';
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    remoteAddress: '192.168.1.30',
    headers: { host, origin: `http://${host}` },
    payload: { password: 'mot-de-passe-reseau' },
  });
  assert.equal(login.statusCode, 200, login.body);
  const foreign = await app.inject({
    method: 'POST',
    url: '/api/login',
    remoteAddress: '192.168.1.30',
    headers: { host, origin: 'http://evil.example' },
    payload: { password: 'mot-de-passe-reseau' },
  });
  assert.equal(foreign.statusCode, 403);
  for (const url of ['/perception', '/image-generation']) {
    const response = await app.inject({ url, remoteAddress: '192.168.1.30', headers: { host } });
    assert.equal(response.statusCode, 403, url);
  }
});

test('réseau local : le mot de passe par défaut n’ouvre l’administration que sur la machine', async (t) => {
  const app = await fixture(t, { adminPassword: 'cornelius' });
  const host = '192.168.1.20:3443';
  const remote = await app.inject({
    method: 'POST',
    url: '/api/login',
    remoteAddress: '192.168.1.30',
    headers: { host, origin: `http://${host}` },
    payload: { password: 'cornelius' },
  });
  assert.equal(remote.statusCode, 403);
  assert.match(remote.json().error, /changez-le d’abord dans l’administration/);
  const local = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { host: 'localhost', origin: 'http://localhost' },
    payload: { password: 'cornelius' },
  });
  assert.equal(local.statusCode, 200);
});

test('réseau local : le miroir d’un autre appareil demande une autorisation, donnée à la connexion', async (t) => {
  const app = await fixture(t);
  const host = '192.168.1.20:3443';
  const remote = { remoteAddress: '192.168.1.30', headers: { host, origin: `http://${host}` } };
  const auth = await app.inject({ url: '/api/auth?role=kiosk', ...remote });
  assert.equal(auth.json().role, null);
  const kiosk = auth.cookies.find((cookie) => cookie.name === 'cornelius_kiosk');
  assert.ok(kiosk);
  const kioskCookie = `${kiosk.name}=${kiosk.value}`;
  const refused = await app.inject({
    url: '/api/state',
    ...remote,
    headers: { ...remote.headers, cookie: kioskCookie },
  });
  assert.equal(refused.statusCode, 401);
  // La machine elle-même n'a besoin d'aucune autorisation.
  assert.equal(
    (await app.inject({ url: '/api/state', headers: { host: 'localhost' } })).statusCode,
    200,
  );
  // Les fichiers de l'interface restent servis, pour afficher la page de connexion.
  assert.notEqual((await app.inject({ url: '/', ...remote })).statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    ...remote,
    headers: { ...remote.headers, cookie: kioskCookie },
    payload: { password: 'mot-de-passe-reseau' },
  });
  assert.equal(login.statusCode, 200);
  const admin = login.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
  const adminCookie = `${admin.name}=${admin.value}`;
  // Sans session d'administration, l'appareil reste autorisé comme miroir.
  const paired = await app.inject({
    url: '/api/state',
    ...remote,
    headers: { ...remote.headers, cookie: kioskCookie },
  });
  assert.equal(paired.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        url: '/api/auth?role=kiosk',
        ...remote,
        headers: { ...remote.headers, cookie: kioskCookie },
      })
    ).json().role,
    'kiosk',
  );
  const devices = await app.inject({
    url: '/api/admin/devices',
    ...remote,
    headers: { ...remote.headers, cookie: adminCookie },
  });
  assert.equal(devices.json().network.trustedDevices, 1);

  const revoke = await app.inject({
    method: 'DELETE',
    url: '/api/admin/trusted-devices',
    ...remote,
    headers: { ...remote.headers, cookie: adminCookie },
  });
  assert.equal(revoke.statusCode, 200);
  const after = await app.inject({
    url: '/api/state',
    ...remote,
    headers: { ...remote.headers, cookie: kioskCookie },
  });
  assert.equal(after.statusCode, 401);
});
