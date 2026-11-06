import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';
import { liveConfiguration } from '../server/live/configuration.js';
import { DEFAULT_LIVE_BASE_URL } from '../shared/live-endpoint.js';
import type { StateEvent } from '../shared/types.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-test-1234';

async function fixture(t: TestContext, overrides: Partial<AppConfig> = {}) {
  const services = await createApp(
    {
      databasePath: ':memory:',
      openaiKey: 'cle-test',
      adminPassword: password,
      origins: [origin],
      secureCookies: false,
      ...overrides,
    },
    { timers: false },
  );
  await services.app.ready();
  t.after(async () => {
    await setImmediate();
    await services.app.close();
  });
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password },
  });
  const entry = login.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
  const headers = { origin, cookie: `${entry.name}=${entry.value}` };
  return { ...services, headers };
}

test('le serveur Live se règle dans l’administration, avant .env et OpenAI', async (t) => {
  const f = await fixture(t, { liveBaseUrl: 'http://10.0.0.5:9000/v1' });
  const read = await f.app.inject({ url: '/api/admin/live-endpoint', headers: f.headers });
  assert.equal(read.statusCode, 200, read.body);
  assert.deepEqual(read.json(), {
    baseUrl: '',
    envBaseUrl: 'http://10.0.0.5:9000/v1',
    effectiveBaseUrl: 'http://10.0.0.5:9000/v1',
    source: 'env',
    models: [],
  });
  assert.equal(
    (await f.app.inject({ url: '/api/admin/live-endpoint', headers: { origin } })).statusCode,
    401,
  );
  for (const baseUrl of ['ftp://serveur/v1', 'http://moi:secret@serveur/v1', 42])
    assert.equal(
      (
        await f.app.inject({
          method: 'PATCH',
          url: '/api/admin/live-endpoint',
          headers: f.headers,
          payload: { baseUrl },
        })
      ).statusCode,
      400,
      String(baseUrl),
    );
  const saved = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/live-endpoint',
    headers: f.headers,
    payload: { baseUrl: ' http://192.168.1.50:8000/v1/ ' },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().effectiveBaseUrl, 'http://192.168.1.50:8000/v1');
  assert.equal(saved.json().source, 'admin');
  const reset = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/live-endpoint',
    headers: f.headers,
    payload: { baseUrl: '' },
  });
  assert.equal(reset.json().source, 'env');

  const plain = await fixture(t);
  const openai = await plain.app.inject({
    url: '/api/admin/live-endpoint',
    headers: plain.headers,
  });
  assert.equal(openai.json().effectiveBaseUrl, DEFAULT_LIVE_BASE_URL);
  assert.equal(openai.json().source, 'default');
});

test('la liste des modèles est lue sur le serveur Live, avec la clé OpenAI', async (t) => {
  let authorization: string | undefined;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization;
    if (request.url !== '/v1/models') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'qwen-live', object: 'model', created: 0, owned_by: 'maison' },
          { id: 'gpt-6-luna', object: 'model', created: 0, owned_by: 'maison' },
        ],
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const f = await fixture(t);
  await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/live-endpoint',
    headers: f.headers,
    payload: { baseUrl: `http://127.0.0.1:${port}/v1` },
  });
  const models = await f.app.inject({
    method: 'POST',
    url: '/api/admin/live-endpoint/models',
    headers: f.headers,
    payload: {},
  });
  assert.equal(models.statusCode, 200, models.body);
  assert.deepEqual(models.json().models, ['gpt-6-luna', 'qwen-live']);
  assert.equal(authorization, 'Bearer cle-test');
  assert.equal(models.body.includes('cle-test'), false);

  server.close();
  server.closeAllConnections();
  const down = await f.app.inject({
    method: 'POST',
    url: '/api/admin/live-endpoint/models',
    headers: f.headers,
    payload: {},
  });
  assert.equal(down.statusCode, 502);
});

test('le modèle de délégation choisi remplace celui du mode, et se retire', async (t) => {
  const f = await fixture(t);
  for (const model of ['avec espace', 'x'.repeat(200), 3])
    assert.equal(
      (
        await f.app.inject({
          method: 'PATCH',
          url: '/api/admin/delegation-model',
          headers: f.headers,
          payload: { model },
        })
      ).statusCode,
      400,
    );
  const saved = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/delegation-model',
    headers: f.headers,
    payload: { model: 'qwen-live' },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json<StateEvent>().state.delegationModel, 'qwen-live');
  assert.equal(f.controller.getDelegationModel(), 'qwen-live');
  const cleared = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/delegation-model',
    headers: f.headers,
    payload: { model: '' },
  });
  assert.equal(cleared.json<StateEvent>().state.delegationModel, '');
});

test('la configuration Live suit le modèle imposé, sinon celui du mode', () => {
  const model = (config: ReturnType<typeof liveConfiguration>) =>
    config.delegation?.type === 'responses' ? config.delegation.responses.model : null;
  assert.equal(model(liveConfiguration([], undefined, 'fast')), 'gpt-6-luna');
  assert.equal(model(liveConfiguration([], undefined, 'ultrafast')), 'gpt-6-astra');
  assert.equal(
    model(liveConfiguration([], undefined, 'ultrafast', { delegationModel: 'qwen-live' })),
    'qwen-live',
  );
  assert.equal(
    model(liveConfiguration([], undefined, 'normal', { delegationModel: '' })),
    'gpt-6-luna',
  );
});
