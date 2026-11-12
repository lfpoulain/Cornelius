import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import type { AddonHttpClient } from '../shared/addons.js';
import { ActionExecutor } from '../server/actions.js';
import { registerAddons } from '../server/addons-api.js';
import { AddonRuntime } from '../server/addons/runtime.js';
import { DiagnosticLog } from '../server/logs.js';
import {
  ActionRepository,
  AddonRepository,
  openDatabase,
  ProfileRepository,
} from '../server/storage.js';

/** Routes des commandes seules, sans connexion : l’accès admin est vérifié ailleurs. */
async function fixture(t: TestContext, secrets: Record<string, string | undefined> = {}) {
  const db = openDatabase(':memory:');
  const calls: string[] = [];
  const http: AddonHttpClient = {
    async fetch(request) {
      calls.push(request.url);
      return {
        status: 200,
        headers: {},
        text: () => '{}',
        json: () => ({}),
        bytes: () => new TextEncoder().encode('{}'),
      };
    },
  };
  const actionRepository = new ActionRepository(db);
  const instances = new AddonRepository(db);
  const actions = new ActionExecutor(actionRepository, http, undefined, Date.now, secrets);
  const logs = new DiagnosticLog();
  const app = Fastify();
  registerAddons(app, {
    runtime: new AddonRuntime({ addons: [], instances, http }),
    actions,
    instances,
    actionRepository,
    profiles: new ProfileRepository(db),
    logs,
    requireAdmin: async () => {},
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const inject = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  return { db, actions, actionRepository, calls, logs, inject };
}

const portail = {
  ref: 'portail',
  label: 'Portail',
  method: 'POST',
  url: 'https://maison.example/portail',
  profileId: null,
  headers: {},
  body: '{}',
  confirmation: 'required',
};

test('une demande refusée disparaît et le rappel du modèle est annulé sans envoi', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.inject('POST', '/api/admin/actions', portail)).statusCode, 201);
  const signal = new AbortController().signal;
  const request = {
    actionRef: 'portail',
    profileId: null,
    interactionId: 'conversation-1',
    callId: 'appel-1',
    signal,
  };
  const pending = await f.actions.run({ ...request, confirmationId: null });
  assert.equal(pending.status, 'pending_confirmation');
  const confirmationId = String(pending.result?.confirmationId);
  assert.equal(
    (await f.inject('GET', '/api/admin/actions/confirmations')).json<unknown[]>().length,
    1,
  );

  const rejected = await f.inject(
    'POST',
    `/api/admin/actions/confirmations/${confirmationId}/reject`,
  );
  assert.equal(rejected.statusCode, 200, rejected.body);
  assert.deepEqual(rejected.json(), { ok: true });
  assert.deepEqual((await f.inject('GET', '/api/admin/actions/confirmations')).json(), []);
  assert.ok(
    f.logs.snapshot().entries.some((entry) => entry.event === 'Confirmation d’action refusée'),
  );

  // Une demande refusée ne peut plus être validée ni refusée deux fois.
  for (const verb of ['approve', 'reject'])
    assert.equal(
      (await f.inject('POST', `/api/admin/actions/confirmations/${confirmationId}/${verb}`))
        .statusCode,
      404,
    );
  const recalled = await f.actions.run({ ...request, callId: 'appel-2', confirmationId });
  assert.equal(recalled.status, 'cancelled');
  assert.deepEqual(f.calls, []);
});

test('refuser une demande inconnue ou expirée répond 404 sans rien toucher', async (t) => {
  const f = await fixture(t);
  const created = await f.inject('POST', '/api/admin/actions', portail);
  const action = created.json<{ id: string }>();
  const expired = f.actionRepository.createConfirmation({
    actionId: action.id,
    profileId: null,
    interactionId: null,
    params: {},
    paramsHash: 'x',
    expiresAt: Date.now() - 1,
  });
  assert.equal(
    (await f.inject('POST', '/api/admin/actions/confirmations/inconnue/reject')).statusCode,
    404,
  );
  assert.equal(
    (await f.inject('POST', `/api/admin/actions/confirmations/${expired}/reject`)).statusCode,
    404,
  );
});

test('un nom d’en-tête invalide est refusé en français, un secret absent est signalé', async (t) => {
  const f = await fixture(t, { PRESENT: 'valeur' });
  const refused = await f.inject('POST', '/api/admin/actions', {
    ...portail,
    headers: { 'Mon en-tête': 'x' },
  });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.json(), {
    error:
      'Nom d’en-tête « Mon en-tête » invalide : lettres, chiffres et tirets, sans espace ni accent.',
  });
  const newline = await f.inject('POST', '/api/admin/actions', {
    ...portail,
    headers: { 'X-Code': 'a\r\nHost: ailleurs' },
  });
  assert.equal(newline.statusCode, 400);
  assert.match(newline.json<{ error: string }>().error, /pas de retour à la ligne/u);

  const created = await f.inject('POST', '/api/admin/actions', {
    ...portail,
    headers: { Authorization: 'Bearer ${secret:ABSENT}', 'X-Ok': '${secret:PRESENT}' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const action = created.json<{ id: string; missingSecrets: string[] }>();
  assert.deepEqual(action.missingSecrets, ['ABSENT']);
  assert.deepEqual(
    (await f.inject('GET', '/api/admin/actions')).json<{ missingSecrets: string[] }[]>()[0]
      ?.missingSecrets,
    ['ABSENT'],
  );
  const patched = await f.inject('PATCH', '/api/admin/actions/' + action.id, {
    headers: { Authorization: 'Bearer ${secret:PRESENT}' },
  });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.deepEqual(patched.json<{ missingSecrets: string[] }>().missingSecrets, []);
  assert.equal(
    (
      await f.inject('PATCH', '/api/admin/actions/' + action.id, {
        headers: { 'Content Type': 'x' },
      })
    ).statusCode,
    400,
  );
  // La valeur d’un secret n’apparaît jamais dans la réponse.
  assert.doesNotMatch(patched.body, /valeur/u);
});
