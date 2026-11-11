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
import { memoryRequestTimeoutMs } from '../server/memory-extractor.js';
import {
  DEFAULT_CUSTOM_PROVIDER,
  defaultMemoryFallback,
  validCustomProviderSettings,
} from '../shared/custom-provider.js';

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

test('le secours peut rester inactif, et le fournisseur personnalisé le choisit par défaut', () => {
  const db = openDatabase(':memory:');
  const repository = new CustomProviderRepository(db);
  const settings = {
    ...DEFAULT_CUSTOM_PROVIDER,
    baseUrl: 'http://127.0.0.1:11434/v1',
    memoryModel: 'memory-model',
    memoryProvider: 'custom' as const,
    memoryFallback: 'none' as const,
  };
  assert.equal(validCustomProviderSettings(settings), true);
  assert.equal(validCustomProviderSettings({ ...settings, memoryFallback: 'ailleurs' }), false);
  repository.set(settings);
  assert.equal(repository.get().memoryFallback, 'none');
  assert.equal(defaultMemoryFallback('custom'), 'none');
  assert.equal(defaultMemoryFallback('mistral'), 'openai');
  db.close();
});

test('un fournisseur mémoire sans secours ne demande jamais un autre service', async () => {
  const called: string[] = [];
  const primary = createCompatibleMemoryExtractor(
    'fixture-key',
    'http://model.test/v1',
    'local-model',
    async (url) => {
      called.push(String(url));
      return Response.json({ error: { message: 'unavailable' } }, { status: 503 });
    },
  );
  await assert.rejects(withMemoryFallback(primary, null)(input, new AbortController().signal));
  assert.deepEqual(called, ['http://model.test/v1/responses']);
});

test('Chat Completions ne remplace Responses que si le serveur ne la connaît pas', async () => {
  for (const [status, fallsBack] of [
    [404, true],
    [405, true],
    [501, true],
    [401, false],
    [429, false],
    [500, false],
  ] as const) {
    const called: string[] = [];
    const extract = createCompatibleMemoryExtractor(
      'fixture-key',
      'http://model.test/v1',
      'local-model',
      async (url) => {
        called.push(String(url).replace('http://model.test/v1/', ''));
        return String(url).endsWith('/responses')
          ? Response.json({ error: { message: 'refus' } }, { status })
          : Response.json({
              choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }],
            });
      },
    );
    const result = extract(input, new AbortController().signal);
    if (fallsBack) assert.deepEqual(await result, proposal, String(status));
    else await assert.rejects(result, String(status));
    assert.deepEqual(called, fallsBack ? ['responses', 'chat/completions'] : ['responses']);
  }
  // Une réponse reçue mais inutilisable ne vaut pas « API inconnue ».
  const called: string[] = [];
  const incomplete = createCompatibleMemoryExtractor(
    'fixture-key',
    'http://model.test/v1',
    'local-model',
    async (url) => {
      called.push(String(url));
      return Response.json({ object: 'response', status: 'incomplete', output: [] });
    },
  );
  await assert.rejects(incomplete(input, new AbortController().signal), /incomplète/);
  assert.deepEqual(called, ['http://model.test/v1/responses']);
});

test('le client compatible attend aussi longtemps que celui d’OpenAI avant de céder', async () => {
  assert.ok(memoryRequestTimeoutMs >= 55_000);
  const hanging = (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }),
    );
  let fallbackCalls = 0;
  const primary = createCompatibleMemoryExtractor(
    'fixture-key',
    'http://model.test/v1',
    'local-model',
    hanging as typeof globalThis.fetch,
    25,
  );
  assert.deepEqual(
    await withMemoryFallback(primary, async () => {
      fallbackCalls++;
      return proposal;
    })(input, new AbortController().signal),
    proposal,
  );
  assert.equal(fallbackCalls, 1);
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
