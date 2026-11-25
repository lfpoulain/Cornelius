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
    kind: 'compatible',
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
  assert.equal(openai.json().kind, 'openai');
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
  assert.equal(models.json().kind, 'compatible');
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

test('Localive est reconnu à sa liste de modèles, jusqu’au changement d’adresse', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        object: 'list',
        data: ['gpt-live-1', 'lmstudio'].map((id) => ({
          id,
          object: 'model',
          created: 0,
          owned_by: 'localive',
        })),
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const f = await fixture(t);
  const patch = (baseUrl: string) =>
    f.app.inject({
      method: 'PATCH',
      url: '/api/admin/live-endpoint',
      headers: f.headers,
      payload: { baseUrl },
    });
  await patch(`http://127.0.0.1:${port}/v1`);
  const models = await f.app.inject({
    method: 'POST',
    url: '/api/admin/live-endpoint/models',
    headers: f.headers,
    payload: {},
  });
  assert.equal(models.json().kind, 'localive');
  assert.deepEqual(models.json().models, ['gpt-live-1', 'lmstudio']);
  const moved = await patch('http://192.168.1.60:8787/v1');
  assert.equal(moved.json().kind, 'compatible');
  assert.deepEqual(moved.json().models, []);
});

test('le modèle imposé ne part qu’à un serveur Live personnalisé', async (t) => {
  const f = await fixture(t);
  f.controller.setDelegationModel('qwen-live');
  const sent = () =>
    (
      f.live as unknown as {
        configuration(
          profileId: string | null,
          voiceOnly: boolean,
        ): {
          delegation?: { type: string; responses: { model: string } };
        };
      }
    ).configuration(null, false).delegation?.responses.model;
  assert.equal(sent(), 'gpt-6-luna');
  await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/live-endpoint',
    headers: f.headers,
    payload: { baseUrl: 'http://192.168.1.60:8787/v1' },
  });
  assert.equal(sent(), 'qwen-live');
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

test('attendre la réponse : réglage enregistré, envoyé à un serveur personnalisé, jamais à OpenAI', async (t) => {
  const f = await fixture(t);
  assert.equal(f.controller.snapshot().state.waitForReply, false);
  const invalid = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/wait-for-reply',
    headers: f.headers,
    payload: { enabled: 'oui' },
  });
  assert.equal(invalid.statusCode, 400);
  const saved = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/wait-for-reply',
    headers: f.headers,
    payload: { enabled: true },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json<StateEvent>().state.waitForReply, true);
  assert.equal(f.controller.isWaitForReply(), true);
  const localive = (config: ReturnType<typeof liveConfiguration>) =>
    (config as { localive?: unknown }).localive;
  assert.equal(localive(liveConfiguration([])), undefined);
  assert.deepEqual(localive(liveConfiguration([], undefined, 'fast', { waitForReply: true })), {
    wait_for_reply: true,
  });
  // OpenAI ne connaît pas cette option : elle ne part qu’à un serveur Live personnalisé.
  const sent = () =>
    localive(
      (
        f.live as unknown as {
          configuration(
            profileId: string | null,
            voiceOnly: boolean,
          ): ReturnType<typeof liveConfiguration>;
        }
      ).configuration(null, true),
    );
  assert.equal(sent(), undefined);
  await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/live-endpoint',
    headers: f.headers,
    payload: { baseUrl: 'http://192.168.1.60:8787/v1' },
  });
  assert.deepEqual(sent(), { wait_for_reply: true });
  // Décoché, Cornelius l’envoie aussi : le réglage par défaut de Localive ne s’applique pas.
  f.controller.setWaitForReply(false);
  assert.deepEqual(sent(), { wait_for_reply: false });
});
