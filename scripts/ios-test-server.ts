/** Simulator-only TLS contract harness. Never loads .env or a production API key. */
import { createServer as https } from 'node:https';
import { createServer as http } from 'node:http';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { ensureCertificate } from '../server/network.js';
const directory = process.argv[2];
if (!directory) throw new Error('Explicit task temporary directory required.');
const cert = await ensureCertificate({ directory: join(directory, 'tls') });
const { app } = await createApp(
  {
    databasePath: ':memory:',
    adminPassword: 'ios-contract-test-only',
    origins: ['http://localhost'],
    secureCookies: false,
    lan: true,
    httpsPort: 19443,
    tlsKeyFingerprint: cert.keyFingerprint,
  },
  { timers: false, imageGenerationRoot: join(directory, 'images') },
);
await app.ready();
const tls = https({ key: cert.key, cert: cert.cert }, (req, res) => app.routing(req, res));
tls.on('upgrade', (req, socket, head) => app.server.emit('upgrade', req, socket, head));
await new Promise<void>((resolve) => tls.listen(19443, '127.0.0.1', resolve));
const bootstrap = http(async (req, res) => {
  if (req.url !== '/fixture') {
    res.writeHead(404).end();
    return;
  }
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin: 'http://localhost' },
    payload: { password: 'ios-contract-test-only' },
  });
  const cookie = login.cookies.map((item) => item.name + '=' + item.value).join('; ');
  const invitation = await app.inject({
    method: 'POST',
    url: '/api/admin/mobile/invitations',
    headers: { origin: 'http://localhost', cookie },
    payload: { localUrl: 'https://localhost:19443' },
  });
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(invitation.json().invitation));
});
await new Promise<void>((resolve) => bootstrap.listen(19444, '127.0.0.1', resolve));
console.info('Simulator contract fixture ready.');
async function stop() {
  bootstrap.closeAllConnections();
  bootstrap.close();
  tls.closeAllConnections();
  tls.close();
  await app.close();
}
process.once('SIGTERM', () => {
  void stop().finally(() => process.exit(0));
});
