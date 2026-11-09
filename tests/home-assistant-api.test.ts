import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { fakeHomeAssistant, type haState } from './helpers/home-assistant.js';

test('routes Home Assistant : authentification, origine, validation et secret côté serveur', async (t) => {
  const fake = await fakeHomeAssistant();
  const services = await createApp(
    {
      databasePath: ':memory:',
      adminPassword: 'test-admin-password',
      origins: ['http://localhost'],
      secureCookies: false,
    },
    { timers: false },
  );
  const { app } = services;
  t.after(async () => {
    await app.close();
    await fake.close();
  });
  const root = '/api/admin/home-assistant';
  assert.equal((await app.inject({ url: root })).statusCode, 401);
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin: 'http://localhost' },
    payload: { password: 'test-admin-password' },
  });
  const entry = login.cookies.find((item) => item.name === 'cornelius_admin')!;
  const headers = { cookie: entry.name + '=' + entry.value, origin: 'http://localhost' };
  const denied = await app.inject({
    method: 'PUT',
    url: root,
    headers: { ...headers, origin: 'http://evil.invalid' },
    payload: { url: fake.url, token: fake.token, revision: 0 },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(fake.wsCalls.length, 0);
  for (const [method, suffix] of [
    ['PUT', ''],
    ['PUT', '/selection'],
    ['PATCH', '/access'],
    ['POST', '/control'],
    ['POST', '/assist'],
    ['POST', '/refresh'],
    ['DELETE', ''],
  ] as const) {
    assert.equal(
      (
        await app.inject({
          method,
          url: root + suffix,
          headers: { origin: 'http://localhost' },
          payload: {},
        })
      ).statusCode,
      401,
    );
  }
  const configured = await app.inject({
    method: 'PUT',
    url: root,
    headers,
    payload: { url: fake.url, token: fake.token, revision: 0 },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  assert.equal(configured.json().hasToken, true);
  assert.deepEqual(
    configured.json().entities.find((entity: { id: string }) => entity.id === 'light.salon')
      .aliases,
    ['Lumière du canapé', 'Salon cosy'],
  );
  assert.ok(!configured.body.includes(fake.token));
  const invalid = await app.inject({
    method: 'PUT',
    url: root + '/selection',
    headers,
    payload: { revision: 1, selected: ['camera.entree'] },
  });
  assert.equal(invalid.statusCode, 400);
  // La sélection ne transporte plus les autorisations : chacune a son propre appel.
  const mixed = await app.inject({
    method: 'PUT',
    url: root + '/selection',
    headers,
    payload: { revision: 1, selected: ['light.salon'], enabled: true },
  });
  assert.equal(mixed.statusCode, 400);
  const chosen = await app.inject({
    method: 'PUT',
    url: root + '/selection',
    headers,
    payload: { revision: 1, selected: ['light.salon'] },
  });
  assert.equal(chosen.statusCode, 200);
  assert.deepEqual(chosen.json().selected, ['light.salon']);
  assert.equal(chosen.json().enabled, false);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: root + '/access',
        headers,
        payload: { revision: 2 },
      })
    ).statusCode,
    400,
  );
  const selected = await app.inject({
    method: 'PATCH',
    url: root + '/access',
    headers,
    payload: { revision: 2, enabled: true },
  });
  assert.equal(selected.statusCode, 200, selected.body);
  assert.equal(selected.json().enabled, true);
  assert.deepEqual(selected.json().selected, ['light.salon']);
  assert.equal(selected.json().knownPeopleOnly, false);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: root + '/selection',
        headers,
        payload: { revision: 1, selected: [] },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: root + '/access',
        headers,
        payload: { revision: 1, enabled: false },
      })
    ).statusCode,
    409,
  );
  const control = await app.inject({
    method: 'POST',
    url: root + '/control',
    headers,
    payload: { entityId: 'light.salon', action: 'turn_on', brightnessPct: 35 },
  });
  assert.equal(control.json().result.confirmed, true, control.body);
  const manual = await app.inject({
    method: 'POST',
    url: root + '/control',
    headers,
    payload: { entityId: 'switch.bureau', action: 'turn_on', brightnessPct: null },
  });
  assert.equal(manual.json().result.confirmed, true);
  assert.equal(fake.calls.length, 2);
  // Couleur depuis l’administration : une teinte sombre, relue à pleine intensité, est confirmée.
  fake.states.set('light.ruban', {
    entity_id: 'light.ruban',
    state: 'off',
    last_updated: new Date().toISOString(),
    attributes: {
      friendly_name: 'Ruban LED',
      supported_color_modes: ['hs'],
      brightness: 200,
    } as unknown as ReturnType<typeof haState>['attributes'],
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: root + '/refresh', headers, payload: {} })).statusCode,
    200,
  );
  const purple = await app.inject({
    method: 'POST',
    url: root + '/control',
    headers,
    payload: {
      entityId: 'light.ruban',
      action: 'turn_on',
      brightnessPct: null,
      rgbColor: [128, 0, 128],
      colorTempKelvin: null,
    },
  });
  assert.equal(purple.statusCode, 200, purple.body);
  assert.equal(purple.json().result.confirmed, true, purple.body);
  assert.deepEqual(fake.calls.at(-1), {
    path: '/api/services/light/turn_on',
    body: { entity_id: 'light.ruban', rgb_color: [128, 0, 128] },
  });
  fake.calls.length = 2;
  const unavailable = await app.inject({
    method: 'POST',
    url: root + '/control',
    headers,
    payload: { entityId: 'switch.inconnu', action: 'turn_on', brightnessPct: null },
  });
  assert.equal(unavailable.json().error.code, 'forbidden');
  const forged = await app.inject({
    method: 'POST',
    url: root + '/control',
    headers,
    payload: { entityId: 'switch.bureau', action: 'turn_on', brightnessPct: null, actor: 'admin' },
  });
  assert.equal(forged.statusCode, 400);
  assert.equal(fake.calls.length, 2);
  const prompts = await app.inject({ url: '/api/admin/personality/household', headers });
  assert.ok(prompts.body.includes('home_assistant__control'));
  assert.ok(!prompts.body.includes(fake.token));
  const logs = await app.inject({ url: '/api/admin/logs', headers });
  assert.ok(!logs.body.includes(fake.token));
  const removed = await app.inject({
    method: 'DELETE',
    url: root,
    headers,
    payload: { revision: selected.json().revision },
  });
  assert.equal(removed.json().hasToken, false);
  assert.deepEqual(removed.json().selected, []);
});
