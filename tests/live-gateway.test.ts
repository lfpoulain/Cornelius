import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { liveBaseUrl } from '../server/config.js';
import { createLiveGateway, liveSocketUrl } from '../server/live/gateway.js';

test('CORNELIUS_LIVE_BASE_URL accepte une adresse http(s) et refuse le reste', () => {
  assert.equal(liveBaseUrl(undefined), undefined);
  assert.equal(liveBaseUrl('  '), undefined);
  assert.equal(liveBaseUrl('http://192.168.1.50:8000/v1/'), 'http://192.168.1.50:8000/v1');
  assert.equal(liveBaseUrl('https://live.maison/v1'), 'https://live.maison/v1');
  for (const value of [
    'pas une adresse',
    'ftp://serveur/v1',
    'http://moi:secret@serveur/v1',
    'http://serveur/v1?cle=1',
    'http://serveur/v1#x',
  ])
    assert.throws(() => liveBaseUrl(value), /CORNELIUS_LIVE_BASE_URL/u, value);
});

test('les adresses WebSocket suivent l’adresse de base', () => {
  assert.equal(
    liveSocketUrl('https://api.openai.com/v1', '/live/sessions'),
    'wss://api.openai.com/v1/live/sessions',
  );
  assert.equal(
    liveSocketUrl('http://127.0.0.1:8000/v1/', '/live/sessions/a/attach'),
    'ws://127.0.0.1:8000/v1/live/sessions/a/attach',
  );
});

test('la passerelle Live joint un serveur compatible à l’adresse configurée', async (t) => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":{"message":"absent"}}');
  });
  const wss = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  const gateway = createLiveGateway('cle-locale', undefined, `http://127.0.0.1:${port}/v1`);

  const connection = once(wss, 'connection') as Promise<[import('ws').WebSocket, IncomingMessage]>;
  let resolveOpen!: () => void;
  const opened = new Promise<void>((resolve) => (resolveOpen = resolve));
  const live = gateway.connect!({ model: 'gpt-live-1' } as never, {
    open: () => resolveOpen(),
    event: () => {},
    failure: () => {},
  });
  t.after(() => live.dispose());
  const [socket, request] = await connection;
  assert.equal(request.url, '/v1/live/sessions');
  assert.equal(request.headers.authorization, 'Bearer cle-locale');
  const [message] = (await once(socket, 'message')) as [Buffer];
  assert.equal(JSON.parse(message.toString()).type, 'session.start');
  await opened;

  await gateway.hangup!('session-1').catch(() => {});
  assert.deepEqual(requests, ['POST /v1/live/sessions/session-1/hangup']);
});
