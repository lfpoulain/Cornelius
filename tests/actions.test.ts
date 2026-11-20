import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AddonCollectError,
  type AddonHttpClient,
  type AddonHttpRequest,
} from '../shared/addons.js';
import { validators } from '../shared/validation.js';
import { ActionRepository, openDatabase, ProfileRepository } from '../server/storage.js';
import { ActionExecutor, actionSecrets } from '../server/actions.js';

function stub() {
  let handler: (
    request: AddonHttpRequest,
  ) => Promise<{ status: number; body: string }> = async () => ({
    status: 200,
    body: '{}',
  });
  const calls: AddonHttpRequest[] = [];
  const client: AddonHttpClient = {
    async fetch(request) {
      calls.push(request);
      const response = await handler(request);
      return {
        status: response.status,
        headers: {},
        text: () => response.body,
        json: () => JSON.parse(response.body) as unknown,
        bytes: () => new Uint8Array(0),
      };
    },
  };
  return {
    calls,
    client,
    respond: (next: { status: number; body?: string }) => {
      handler = async () => ({ status: next.status, body: next.body ?? '{}' });
    },
  };
}

function fixture() {
  const db = openDatabase(':memory:');
  const actions = new ActionRepository(db);
  let now = Date.now();
  const http = stub();
  const executor = new ActionExecutor(actions, http.client, undefined, () => now, {
    portailToken: 'valeur-secrete',
  });
  const signal = new AbortController().signal;
  const created = actions.createAction({
    ref: 'portail',
    label: 'Portail',
    method: 'POST',
    url: 'https://maison.example/portail',
    profileId: null,
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    confirmation: 'required',
  });
  return {
    db,
    actions,
    executor,
    http,
    signal,
    created,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('une action sensible exige une validation authentifiée puis ne s’exécute qu’une fois par appel', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  f.http.respond({ status: 200 });
  const pending = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-1',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(pending.status, 'pending_confirmation');
  assert.equal(f.http.calls.length, 0);
  const confirmationId = (pending.result as { confirmationId: string }).confirmationId;
  // Le modèle seul ne peut pas exécuter : la confirmation n'est pas validée.
  const unapproved = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-1',
    callId: 'call-2',
    confirmationId,
    signal: f.signal,
  });
  assert.equal(unapproved.status, 'failed');
  assert.equal(unapproved.error?.code, 'forbidden');
  assert.equal(f.http.calls.length, 0);
  // La validation vient de l'administration.
  assert.equal(f.actions.approveConfirmation(confirmationId, Date.now()), true);
  const executed = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-1',
    callId: 'call-2',
    confirmationId,
    signal: f.signal,
  });
  assert.equal(executed.status, 'succeeded');
  assert.equal(validators.toolResult(executed), true, JSON.stringify(validators.toolResult.errors));
  assert.equal(f.http.calls.length, 1);
  // Rejeu du même appel Live : aucun second effet.
  const repeated = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-1',
    callId: 'call-2',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(repeated.status, 'succeeded');
  assert.equal(repeated.actionRunId, executed.actionRunId);
  assert.equal(f.http.calls.length, 1);
  // Un appel réellement distinct, dans la même session, s'exécute bien.
  const second = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-1',
    callId: 'call-3',
    confirmationId: null,
    signal: f.signal,
  });
  const secondId = (second.result as { confirmationId: string }).confirmationId;
  f.actions.approveConfirmation(secondId, Date.now());
  const secondRun = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-1',
    callId: 'call-3',
    confirmationId: secondId,
    signal: f.signal,
  });
  assert.equal(secondRun.status, 'succeeded');
  assert.equal(f.http.calls.length, 2);
});

test('une confirmation expirée annule l’action sans effet', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const pending = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-2',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  const confirmationId = (pending.result as { confirmationId: string }).confirmationId;
  f.actions.approveConfirmation(confirmationId, Date.now());
  f.advance(121_000);
  const cancelled = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-2',
    callId: 'call-2',
    confirmationId,
    signal: f.signal,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(f.http.calls.length, 0);
});

test('une réponse serveur incertaine ne se répète jamais automatiquement', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  f.actions.updateAction(f.created.id, { confirmation: 'none' });
  f.http.respond({ status: 503 });
  const unknown = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-3',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.error?.retryable, false);
  const repeated = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-3',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(repeated.status, 'unknown');
  assert.equal(f.http.calls.length, 1);
});

test('un refus d’authentification est un échec explicite', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  f.actions.updateAction(f.created.id, { confirmation: 'none' });
  f.http.respond({ status: 401 });
  const failed = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-4',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'auth');
});

test('le modèle ne peut viser une action d’un autre propriétaire ni une référence inconnue', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const profiles = new ProfileRepository(f.db);
  const alice = profiles.create('Alice');
  const bob = profiles.create('Bob');
  f.actions.createAction({
    ref: 'prive',
    label: 'Privé Alice',
    method: 'GET',
    url: 'https://maison.example/prive',
    profileId: alice.id,
    headers: {},
    body: null,
    confirmation: 'none',
  });
  f.http.respond({ status: 200 });
  const other = await f.executor.run({
    actionRef: 'prive',
    profileId: bob.id,
    interactionId: 'interaction-5',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(other.status, 'failed');
  assert.equal(other.error?.code, 'not_found');
  const own = await f.executor.run({
    actionRef: 'prive',
    profileId: alice.id,
    interactionId: 'interaction-5',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(own.status, 'succeeded');
  assert.equal(f.http.calls.length, 1);
  const missing = await f.executor.run({
    actionRef: 'inconnue',
    profileId: alice.id,
    interactionId: 'interaction-5',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(missing.error?.code, 'not_found');
});

test('une confirmation ne peut pas servir un autre profil', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const profiles = new ProfileRepository(f.db);
  const alice = profiles.create('Alice');
  const pending = await f.executor.run({
    actionRef: 'portail',
    profileId: alice.id,
    interactionId: 'interaction-6',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  const confirmationId = (pending.result as { confirmationId: string }).confirmationId;
  f.actions.approveConfirmation(confirmationId, Date.now());
  const forged = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-6',
    callId: 'call-2',
    confirmationId,
    signal: f.signal,
  });
  assert.equal(forged.status, 'cancelled');
  assert.equal(f.http.calls.length, 0);
});

test('les valeurs ${secret:NOM} sont résolues et un secret manquant bloque l’envoi', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  f.actions.updateAction(f.created.id, {
    confirmation: 'none',
    headers: { Authorization: 'Bearer ${secret:portailToken}' },
  });
  f.http.respond({ status: 200 });
  const sent = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-7',
    callId: 'call-1',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(sent.status, 'succeeded');
  assert.equal(f.http.calls[0]!.headers?.Authorization, 'Bearer valeur-secrete');
  f.actions.updateAction(f.created.id, {
    headers: { Authorization: 'Bearer ${secret:absent}' },
  });
  const refused = await f.executor.run({
    actionRef: 'portail',
    profileId: null,
    interactionId: 'interaction-7',
    callId: 'call-2',
    confirmationId: null,
    signal: f.signal,
  });
  assert.equal(refused.status, 'failed');
  assert.equal(refused.error?.code, 'config_invalid');
  assert.equal(f.http.calls.length, 1);
});

test('les secrets d’action viennent des jetons connus et de CORNELIUS_SECRET_', () => {
  assert.deepEqual(
    actionSecrets(
      { primApiKey: 'cle-prim' },
      {
        CORNELIUS_SECRET_PORTAIL_TOKEN: 'jeton-portail',
        CORNELIUS_SECRET_VIDE: '',
        AUTRE: 'ignore',
      },
    ),
    { primApiKey: 'cle-prim', PORTAIL_TOKEN: 'jeton-portail' },
  );
});

test('le test de destination depuis l’admin n’écrit aucun journal d’exécution', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  f.http.respond({ status: 204 });
  const testResult = await f.executor.test(f.created);
  assert.equal(testResult.status, 'succeeded');
  assert.equal(testResult.responseStatus, 204);
  f.http.respond({ status: 502 });
  const failure = await f.executor.test(f.created);
  assert.equal(failure.status, 'unknown');
});

test('une action déjà annulée ne crée ni confirmation ni effet réseau', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  for (const confirmation of ['required', 'none'] as const) {
    f.actions.updateAction(f.created.id, { confirmation });
    const result = await f.executor.run({
      actionRef: 'portail',
      profileId: null,
      interactionId: 'stopped',
      callId: confirmation,
      confirmationId: null,
      signal: AbortSignal.abort(),
    });
    assert.equal(result.status, 'cancelled');
  }
  assert.equal(f.actions.listConfirmations(Date.now()).length, 0);
  assert.equal(f.actions.listRuns().length, 0);
  assert.equal(f.http.calls.length, 0);
});

test('la confirmation approuvée vise la destination, le corps et l’interaction exacts', async (t) => {
  for (const change of ['url', 'body', 'interaction'] as const) {
    await t.test(change, async (t) => {
      const f = fixture();
      t.after(() => f.db.close());
      const input = {
        actionRef: 'portail',
        profileId: null,
        interactionId: 'initial',
        callId: 'request',
        confirmationId: null,
        signal: f.signal,
      };
      const pending = await f.executor.run(input);
      const confirmationId = pending.result!.confirmationId as string;
      f.actions.approveConfirmation(confirmationId, Date.now());
      if (change === 'url')
        f.actions.updateAction(f.created.id, { url: 'https://maison.example/garage' });
      if (change === 'body') f.actions.updateAction(f.created.id, { body: '{"mode":"autre"}' });
      const result = await f.executor.run({
        ...input,
        callId: 'execute',
        confirmationId,
        interactionId: change === 'interaction' ? 'other' : input.interactionId,
      });
      assert.equal(result.status, 'cancelled');
      assert.equal(f.http.calls.length, 0);
    });
  }
});

test('le rejeu d’un échec conserve son identifiant et le code fournisseur', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  f.actions.updateAction(f.created.id, { confirmation: 'none' });
  f.http.respond({ status: 401 });
  const input = {
    actionRef: 'portail',
    profileId: null,
    interactionId: 'replay',
    callId: 'auth',
    confirmationId: null,
    signal: f.signal,
  };
  const first = await f.executor.run(input);
  const repeated = await f.executor.run(input);
  assert.equal(repeated.actionRunId, first.actionRunId);
  assert.deepEqual(repeated.error, first.error);
  assert.equal(f.http.calls.length, 1);
});

test('une requête invalide ou une destination injoignable échoue sans résultat incertain', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const action = f.actions.createAction({
    ref: 'lampe',
    label: 'Lampe',
    method: 'GET',
    url: 'https://maison.example/lampe',
    profileId: null,
    headers: {},
    body: null,
    confirmation: 'none',
  });
  const failing = (error: AddonCollectError) =>
    new ActionExecutor(f.actions, { fetch: () => Promise.reject(error) }, undefined, Date.now);
  const run = (executor: ActionExecutor, callId: string) =>
    executor.run({
      actionRef: 'lampe',
      profileId: null,
      interactionId: 'conversation',
      callId,
      confirmationId: null,
      signal: f.signal,
    });
  const invalid = failing(
    new AddonCollectError('invalid_params', 'Requête invalide : nom d’en-tête « a b » refusé.'),
  );
  const invalidRun = await run(invalid, 'appel-1');
  assert.equal(invalidRun.status, 'failed');
  assert.equal(invalidRun.summary, 'Action « Lampe » non envoyée : requête invalide.');
  assert.equal(invalidRun.error?.code, 'invalid_params');
  assert.deepEqual(await invalid.test(action), {
    status: 'failed',
    responseStatus: null,
    summary: 'Requête invalide : nom d’en-tête « a b » refusé.',
  });

  const unreachable = failing(new AddonCollectError('unavailable', 'Source réseau injoignable.'));
  const unreachableRun = await run(unreachable, 'appel-2');
  assert.equal(unreachableRun.status, 'failed');
  assert.equal(unreachableRun.summary, 'Action « Lampe » non envoyée : destination injoignable.');
  assert.deepEqual(await unreachable.test(action), {
    status: 'failed',
    responseStatus: null,
    summary: 'Destination injoignable : vérifiez l’adresse et que l’appareil est allumé.',
  });
  const runs = f.actions.listRuns(10);
  assert.deepEqual(runs.map((entry) => [entry.status, entry.errorCode]).sort(), [
    ['failed', 'invalid_params'],
    ['failed', 'unavailable'],
  ]);

  // Coupée en route, la requête est peut-être arrivée : le résultat reste incertain.
  const cut = failing(new AddonCollectError('upstream', 'Connexion interrompue avant la réponse.'));
  assert.equal((await run(cut, 'appel-3')).status, 'unknown');
  assert.equal((await cut.test(action)).status, 'unknown');
});

test('les secrets cités et absents sont signalés par leur nom, jamais leur valeur', (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  assert.deepEqual(
    f.executor.missingSecrets({
      headers: { Authorization: 'Bearer ${secret:portailToken}', 'X-Cle': '${secret:ABSENT}' },
      body: '{"code":"${secret:CODE}","encore":"${secret:ABSENT}"}',
    }),
    ['ABSENT', 'CODE'],
  );
  assert.deepEqual(f.executor.missingSecrets({ headers: {}, body: null }), []);
});
