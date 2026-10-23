import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { liveConfiguration } from '../server/live/configuration.js';

test('la voix choisie part dans la configuration Live, Cedar par défaut', () => {
  assert.equal(liveConfiguration().audio?.output?.voice, 'cedar');
  assert.equal(
    liveConfiguration([], undefined, undefined, { voice: 'marin' }).audio?.output?.voice,
    'marin',
  );
  assert.match(String(liveConfiguration().instructions), /français de France/);
});

test('la voix se règle dans l’administration et reste après un redémarrage', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-voice-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    databasePath: join(directory, 'cornelius.sqlite'),
    perceptionToken: 'p'.repeat(40),
    imageGenerationToken: 'i'.repeat(40),
    adminPassword: 'mot-de-passe-voix',
    origins: ['http://localhost'],
    secureCookies: false,
  };
  const open = async () => {
    const services = await createApp(config, { timers: false, imageGenerationRoot: directory });
    await services.app.ready();
    const login = await services.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin: 'http://localhost' },
      payload: { password: 'mot-de-passe-voix' },
    });
    const entry = login.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
    return {
      ...services,
      headers: { origin: 'http://localhost', cookie: `${entry.name}=${entry.value}` },
    };
  };
  const first = await open();
  assert.equal(first.controller.snapshot().state.speechVoice, 'cedar');
  const refused = await first.app.inject({
    method: 'PATCH',
    url: '/api/admin/voice',
    headers: first.headers,
    payload: { voice: 'robot' },
  });
  assert.equal(refused.statusCode, 400);
  const saved = await first.app.inject({
    method: 'PATCH',
    url: '/api/admin/voice',
    headers: first.headers,
    payload: { voice: 'marin' },
  });
  assert.equal(saved.statusCode, 200);
  await first.app.close();
  const second = await open();
  assert.equal(second.controller.snapshot().state.speechVoice, 'marin');
  await second.app.close();
});

test('Mistral: clé privée, choix authentifié et persistance après redémarrage', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-provider-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    databasePath: join(directory, 'cornelius.sqlite'),
    adminPassword: 'test-provider-password',
    origins: ['http://localhost'],
    secureCookies: false,
  };
  const first = await createApp(config, { timers: false, imageGenerationRoot: directory });
  await first.app.ready();
  const route = '/api/admin/voice-provider';
  assert.equal(
    (
      await first.app.inject({
        method: 'PATCH',
        url: route,
        headers: { origin: 'http://localhost' },
        payload: { provider: 'mistral' },
      })
    ).statusCode,
    401,
  );
  const login = await first.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin: 'http://localhost' },
    payload: { password: config.adminPassword },
  });
  const cookie = login.cookies.find((c) => c.name === 'cornelius_admin')!;
  const headers = { origin: 'http://localhost', cookie: `${cookie.name}=${cookie.value}` };
  const choose = (provider: string) =>
    first.app.inject({ method: 'PATCH', url: route, headers, payload: { provider } });
  assert.equal((await choose('mistral')).statusCode, 400);
  assert.equal((await choose('invalid')).statusCode, 400);
  assert.equal(
    (
      await first.app.inject({
        method: 'PATCH',
        url: route,
        headers: { cookie: headers.cookie },
        payload: { provider: 'mistral' },
      })
    ).statusCode,
    403,
  );
  const key = 'test-mistral-private-key-not-for-network';
  assert.equal(
    (
      await first.app.inject({
        method: 'PUT',
        url: '/api/admin/secrets/MISTRAL_API_KEY',
        headers,
        payload: { value: key },
      })
    ).statusCode,
    200,
  );
  const secrets = await first.app.inject({ url: '/api/admin/secrets', headers });
  assert.equal(secrets.body.includes(key), false);
  assert.equal(
    secrets.json().secrets.find((s: { env: string }) => s.env === 'MISTRAL_API_KEY').configured,
    true,
  );
  const saved = await choose('mistral');
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().state.voiceProvider, 'mistral');
  assert.equal(saved.json().state.setup.voiceKey, true);
  assert.equal(saved.json().state.setup.openaiKey, false);
  assert.equal(saved.body.includes(key), false);
  await first.app.close();
  const second = await createApp(config, { timers: false, imageGenerationRoot: directory });
  assert.equal(second.controller.snapshot().state.voiceProvider, 'mistral');
  assert.equal(second.controller.snapshot().state.setup?.voiceKey, true);
  await second.app.close();
});
