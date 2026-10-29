import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';
import { secretValueError } from '../server/secrets.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-cles';
const openaiKey = 'sk-test-admin-0123456789abcd';

async function fixture(t: TestContext, overrides: Partial<AppConfig> = {}) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-secrets-images-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: password,
      origins: [origin],
      secureCookies: false,
      ...overrides,
    } satisfies AppConfig,
    { timers: false, imageGenerationRoot: imageRoot },
  );
  await services.app.ready();
  t.after(async () => {
    await services.app.close();
    rmSync(imageRoot, { recursive: true, force: true });
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

test('valeurs de clé acceptées', () => {
  assert.equal(secretValueError(openaiKey), null);
  assert.ok(secretValueError('court'));
  assert.ok(secretValueError('avec un espace dedans'));
  assert.ok(secretValueError('x'.repeat(600)));
  assert.ok(secretValueError(42));
});

test('le fournisseur compatible se configure sans jamais renvoyer sa clé', async (t) => {
  const f = await fixture(t);
  const key = 'custom-provider-secret-0123456789';
  const savedKey = await f.app.inject({
    method: 'PUT',
    url: '/api/admin/secrets/CUSTOM_OPENAI_API_KEY',
    headers: f.headers,
    payload: { value: key },
  });
  assert.equal(savedKey.statusCode, 200, savedKey.body);
  assert.equal(savedKey.body.includes(key), false);

  const settings = {
    name: 'Serveur maison',
    baseUrl: 'http://127.0.0.1:11434/v1',
    memoryModel: 'memory-model',
    memoryProvider: 'custom',
    memoryFallback: 'openai',
  };
  const saved = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/custom-provider',
    headers: f.headers,
    payload: settings,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().name, 'Serveur maison');
  assert.equal(saved.json().keyConfigured, true);
  assert.deepEqual(saved.json().ready, { memory: true });
  assert.equal(saved.body.includes(key), false);

  for (const memoryFallback of ['openai', 'mistral']) {
    const update = await f.app.inject({
      method: 'PATCH',
      url: '/api/admin/custom-provider',
      headers: f.headers,
      payload: { ...settings, memoryFallback },
    });
    assert.equal(update.statusCode, 200, update.body);
    assert.equal(update.json().memoryFallback, memoryFallback);
  }
  const invalid = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/custom-provider',
    headers: f.headers,
    payload: { ...settings, memoryFallback: 'custom' },
  });
  assert.equal(invalid.statusCode, 400);
  const voice = await f.app.inject({
    method: 'PATCH',
    url: '/api/admin/voice-provider',
    headers: f.headers,
    payload: { provider: 'custom' },
  });
  assert.equal(voice.statusCode, 400);
  for (const method of ['PATCH', 'POST'] as const) {
    const unauthorized = await f.app.inject({
      method,
      url: method === 'PATCH' ? '/api/admin/custom-provider' : '/api/admin/custom-provider/models',
      headers: { origin },
      payload: settings,
    });
    assert.equal(unauthorized.statusCode, 401);
  }
  const unauthenticated = await f.app.inject({ url: '/api/admin/custom-provider' });
  assert.equal(unauthenticated.statusCode, 401);
});

test('la clé OpenAI se saisit dans l’administration et compte sans redémarrage', async (t) => {
  const f = await fixture(t);
  const list = await f.app.inject({ url: '/api/admin/secrets', headers: f.headers });
  assert.equal(list.statusCode, 200);
  const before = list.json().secrets;
  assert.equal(before[0].env, 'OPENAI_API_KEY');
  assert.equal(before[0].group, 'providers');
  assert.equal(before[0].configured, false);
  assert.equal(f.controller.snapshot().state.setup?.openaiKey, false);

  const saved = await f.app.inject({
    method: 'PUT',
    url: '/api/admin/secrets/OPENAI_API_KEY',
    headers: f.headers,
    payload: { value: `  ${openaiKey}  ` },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const openai = saved.json().secrets[0];
  assert.deepEqual(
    { configured: openai.configured, source: openai.source, hint: openai.hint },
    { configured: true, source: 'admin', hint: 'abcd' },
  );
  // Jamais la valeur elle-même, ni dans la liste ni dans l’état diffusé.
  assert.ok(!saved.body.includes(openaiKey));
  assert.equal(f.controller.snapshot().state.setup?.openaiKey, true);
  const devices = await f.app.inject({ url: '/api/admin/devices', headers: f.headers });
  assert.equal(devices.json().apiConfigured, true);
  const logs = await f.app.inject({ url: '/api/admin/logs', headers: f.headers });
  assert.ok(!logs.body.includes(openaiKey));

  const removed = await f.app.inject({
    method: 'DELETE',
    url: '/api/admin/secrets/OPENAI_API_KEY',
    headers: f.headers,
  });
  assert.equal(removed.json().secrets[0].configured, false);
  assert.equal(f.controller.snapshot().state.setup?.openaiKey, false);
});

test('une clé de .env reste la valeur de secours, une clé saisie passe avant', async (t) => {
  const f = await fixture(t, { openaiKey: 'sk-from-env-file-wxyz' });
  const list = (await f.app.inject({ url: '/api/admin/secrets', headers: f.headers })).json();
  assert.equal(list.secrets[0].source, 'env');
  assert.equal(list.secrets[0].hint, 'wxyz');
  await f.app.inject({
    method: 'PUT',
    url: '/api/admin/secrets/OPENAI_API_KEY',
    headers: f.headers,
    payload: { value: openaiKey },
  });
  const removed = await f.app.inject({
    method: 'DELETE',
    url: '/api/admin/secrets/OPENAI_API_KEY',
    headers: f.headers,
  });
  assert.equal(removed.json().secrets[0].source, 'env');
});

test('jetons des modules : saisis dans l’administration, lus par le module', async (t) => {
  const f = await fixture(t);
  const definitions = async () =>
    (await f.app.inject({ url: '/api/admin/addons', headers: f.headers })).json();
  const weatherSecret = (body: { definitions: unknown[] }) => {
    const list = body.definitions as { secrets: { env: string; configured: boolean }[] }[];
    return list
      .flatMap((definition) => definition.secrets)
      .find((secret) => secret.env === 'CORNELIUS_METEO_CONCEPT_TOKEN');
  };
  const before = weatherSecret(await definitions());
  if (!before) return t.skip('module Météo absent');
  assert.equal(before.configured, false);
  const saved = await f.app.inject({
    method: 'PUT',
    url: '/api/admin/secrets/CORNELIUS_METEO_CONCEPT_TOKEN',
    headers: f.headers,
    payload: { value: 'meteo-token-0123456789' },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(weatherSecret(await definitions())?.configured, true);
});

test('les groupes et icônes des jetons viennent des déclarations des modules', async (t) => {
  const f = await fixture(t);
  const { definitions } = (
    await f.app.inject({ url: '/api/admin/addons', headers: f.headers })
  ).json();
  const { secrets } = (
    await f.app.inject({ url: '/api/admin/secrets', headers: f.headers })
  ).json();
  for (const definition of definitions) {
    for (const declared of definition.secrets ?? []) {
      const secret = secrets.find((entry: { env: string }) => entry.env === declared.env);
      assert.ok(secret, declared.env);
      assert.equal(secret.group, 'modules');
      assert.equal(secret.icon, definition.display?.icon);
    }
  }
});

test('clés : réservées à l’administration, noms inconnus et valeurs invalides refusés', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject({ url: '/api/admin/secrets' })).statusCode, 401);
  const unknown = await f.app.inject({
    method: 'PUT',
    url: '/api/admin/secrets/PATH',
    headers: f.headers,
    payload: { value: 'quelque-chose-de-long' },
  });
  assert.equal(unknown.statusCode, 404);
  const invalid = await f.app.inject({
    method: 'PUT',
    url: '/api/admin/secrets/OPENAI_API_KEY',
    headers: f.headers,
    payload: { value: 'sk' },
  });
  assert.equal(invalid.statusCode, 400);
});
