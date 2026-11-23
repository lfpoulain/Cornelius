import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-modules-1234';

/** Serveur complet en mémoire, connecté en administrateur. */
async function fixture(t: TestContext, overrides: Partial<AppConfig> = {}) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-addons-api-'));
  const config: AppConfig = {
    databasePath: ':memory:',
    perceptionToken: 'p'.repeat(40),
    imageGenerationToken: 'i'.repeat(40),
    adminPassword: password,
    origins: [origin],
    secureCookies: false,
    ...overrides,
  };
  const services = await createApp(config, {
    timers: false,
    imageGenerationRoot: imageRoot,
    modelLauncher: () =>
      spawn(
        process.execPath,
        ['-e', 'process.stdout.write(JSON.stringify({state:"ready"})+"\\n")'],
        { windowsHide: true },
      ),
  });
  await services.app.ready();
  t.after(async () => {
    await setImmediate();
    await services.app.close();
    rmSync(imageRoot, { recursive: true, force: true });
  });
  const login = await services.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password },
  });
  assert.equal(login.statusCode, 200, login.body);
  const entry = login.cookies.find((cookie) => cookie.name === 'cornelius_admin');
  assert.ok(entry);
  const headers = { origin, cookie: `${entry.name}=${entry.value}` };
  const inject = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    services.app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  return { ...services, headers, inject };
}

interface SecretView {
  env: string;
  label: string;
  url: string | null;
  note: string | null;
  optional: boolean;
  configured: boolean;
}

test('le catalogue dit quels jetons manquent, sans jamais renvoyer leur valeur', async (t) => {
  const missing = await fixture(t);
  const catalog = (await missing.inject('GET', '/api/admin/addons')).json<{
    definitions: { id: string; secrets: SecretView[] }[];
  }>();
  const secrets = (id: string) => catalog.definitions.find((entry) => entry.id === id)?.secrets;
  assert.deepEqual(secrets('weather'), [
    {
      env: 'CORNELIUS_METEO_CONCEPT_TOKEN',
      label: 'un jeton Météo Concept',
      url: 'https://api.meteo-concept.com/',
      note: 'gratuit',
      optional: false,
      configured: false,
    },
  ]);
  assert.equal(secrets('transit')?.[0]?.env, 'CORNELIUS_PRIM_API_KEY');
  assert.equal(secrets('transit')?.[0]?.configured, false);
  assert.deepEqual(secrets('clock'), []);

  const configured = await fixture(t, {
    meteoConceptToken: 'valeur-meteo-secrete',
    primApiKey: 'valeur-prim-secrete',
  });
  const response = await configured.inject('GET', '/api/admin/addons');
  assert.ok(!response.body.includes('valeur-meteo-secrete'));
  assert.ok(!response.body.includes('valeur-prim-secrete'));
  const definitions = response.json<{ definitions: { id: string; secrets: SecretView[] }[] }>()
    .definitions;
  for (const id of ['weather', 'transit'])
    assert.equal(definitions.find((entry) => entry.id === id)?.secrets[0]?.configured, true, id);
});

test('un réglage se contrôle avant l’enregistrement, avec une erreur par champ', async (t) => {
  const f = await fixture(t);
  const config = { insee: '75', lat: null, lon: null, days: 3 };
  const checked = await f.inject('POST', '/api/admin/addons/weather/validate', { config });
  assert.equal(checked.statusCode, 200, checked.body);
  assert.deepEqual(checked.json(), { errors: [{ path: 'insee', message: 'Format invalide.' }] });
  const valid = await f.inject('POST', '/api/admin/addons/weather/validate', {
    config: { ...config, insee: '75056' },
  });
  assert.deepEqual(valid.json(), { errors: [] });
  assert.equal(
    (await f.inject('POST', '/api/admin/addons/inconnu/validate', { config })).statusCode,
    404,
  );
  assert.equal(
    (await f.inject('POST', '/api/admin/addons/weather/validate', { reglage: config })).statusCode,
    400,
  );
  // Le contrôle n’écrit rien.
  assert.equal(
    (await f.inject('GET', '/api/admin/addons')).json<{ instances: unknown[] }>().instances.length,
    0,
  );
  const refused = await f.inject('POST', '/api/admin/addons/instances', {
    addonId: 'weather',
    profileId: null,
    ref: 'maison',
    label: 'Maison',
    config,
  });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.json(), {
    error: 'Réglage incomplet : vérifiez les champs signalés.',
    fields: [{ path: 'insee', message: 'Format invalide.' }],
  });
});
