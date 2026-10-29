import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  CustomProviderRepository,
  createCompatibleMemoryExtractor,
  withMemoryFallback,
  customProviderMigration,
} from '../server/custom-provider.js';
import { openDatabase } from '../server/storage.js';
import { DEFAULT_CUSTOM_PROVIDER, validCustomProviderSettings } from '../shared/custom-provider.js';

test('configuration personnalisée validée, persistée et expurgée', () => {
  const db = openDatabase(':memory:');
  const repository = new CustomProviderRepository(db);
  const settings = {
    ...DEFAULT_CUSTOM_PROVIDER,
    name: 'Mon serveur',
    baseUrl: 'http://127.0.0.1:11434/v1/',
    memoryModel: 'chat-local',
    memoryProvider: 'custom' as const,
  };
  assert.equal(validCustomProviderSettings(settings), true);
  repository.set(settings);
  assert.deepEqual(repository.view(true).ready, { memory: true });
  assert.equal(repository.get().baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(
    validCustomProviderSettings({ ...settings, baseUrl: 'https://user:secret@example.test/v1' }),
    false,
  );
  db.close();
});

test('les modèles sont découverts par l’endpoint compatible sans exposer la clé', async (t) => {
  let authorization = '';
  const server = createServer((request, response) => {
    authorization = String(request.headers.authorization ?? '');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'z-model' }, { id: 'a-model' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const repository = new CustomProviderRepository(db);
  repository.set({
    ...DEFAULT_CUSTOM_PROVIDER,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  assert.deepEqual(await repository.discover('custom-secret-value'), ['a-model', 'z-model']);
  assert.equal(authorization, 'Bearer custom-secret-value');
  assert.equal(JSON.stringify(repository.view(true)).includes('custom-secret-value'), false);
});

const input = { now: '2026-10-29T00:00:00.000Z', turns: [], memories: [] };
const proposal = { schemaVersion: 1, changes: [] };

for (const responsesAvailable of [true, false]) {
  test(`extraction JSON compatible, Responses disponible : ${responsesAvailable}`, async () => {
    const calls: string[] = [];
    const extract = createCompatibleMemoryExtractor(
      'fixture-key',
      'http://model.test/v1',
      'local-model',
      async (url, init) => {
        calls.push(String(url));
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'local-model');
        assert.equal(body.tools, undefined);
        if (String(url).endsWith('/responses')) {
          assert.equal(body.store, false);
          assert.equal(body.text.format.strict, true);
          if (!responsesAvailable)
            return Response.json({ error: { message: 'Not supported' } }, { status: 404 });
          return Response.json({
            object: 'response',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: JSON.stringify(proposal) }],
              },
            ],
          });
        }
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(body.messages[1].content, JSON.stringify(input));
        return Response.json({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }],
        });
      },
    );
    assert.deepEqual(await extract(input, new AbortController().signal), proposal);
    assert.deepEqual(
      calls,
      responsesAvailable
        ? ['http://model.test/v1/responses']
        : ['http://model.test/v1/responses', 'http://model.test/v1/chat/completions'],
    );
  });
}

test('erreurs et sorties invalides déclenchent le secours, jamais une annulation', async () => {
  let fallbackCalls = 0;
  const fallback = async () => {
    fallbackCalls++;
    return proposal;
  };
  for (const body of [
    { choices: [{ finish_reason: 'stop', message: { content: '{"unexpected":true}' } }] },
    { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(proposal) } }] },
    { error: { message: 'Unavailable' } },
  ]) {
    const primary = createCompatibleMemoryExtractor(
      'fixture-key',
      'http://model.test/v1',
      'local-model',
      async (url) =>
        String(url).endsWith('/responses')
          ? Response.json({}, { status: 404 })
          : Response.json(body),
    );
    assert.deepEqual(
      await withMemoryFallback(primary, fallback)(input, new AbortController().signal),
      proposal,
    );
  }
  assert.equal(fallbackCalls, 3);
  const abort = new AbortController();
  const cancelled = async () => {
    abort.abort();
    throw new Error('cancelled');
  };
  await assert.rejects(withMemoryFallback(cancelled, fallback)(input, abort.signal), /cancelled/);
  assert.equal(fallbackCalls, 3);
  const failed = async () => {
    throw new Error('unavailable');
  };
  await assert.rejects(
    withMemoryFallback(failed, null)(input, new AbortController().signal),
    /unavailable/,
  );
});

test('la migration conserve le fournisseur mémoire des installations Mistral', () => {
  const db = openDatabase(':memory:');
  db.exec(
    "DROP TABLE custom_provider_preferences; UPDATE voice_provider_preferences SET provider = 'mistral';",
  );
  db.exec(customProviderMigration);
  assert.equal(new CustomProviderRepository(db).get().memoryProvider, 'mistral');
  assert.equal(
    db.prepare('SELECT provider FROM voice_provider_preferences').get()?.provider,
    'mistral',
  );
  db.close();
});
