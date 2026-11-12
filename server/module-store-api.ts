import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleStoreView } from '../shared/module-store.js';
import { compile } from '../shared/validation.js';
import type { CoreUpdater } from './core-update.js';
import { StoreError, type ModuleStore } from './module-store/store.js';
import type { AddonRepository } from './storage.js';

const repositorySchema = compile<{ url: string; branch?: string | null }>({
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 300 },
    branch: { type: ['string', 'null'], maxLength: 100 },
  },
});
const installSchema = compile<{ repository: string; module: string }>({
  type: 'object',
  additionalProperties: false,
  required: ['repository', 'module'],
  properties: {
    repository: { type: 'string', minLength: 1, maxLength: 100 },
    module: { type: 'string', minLength: 1, maxLength: 32 },
  },
});
const uninstallSchema = compile<{ deleteSources?: boolean }>({
  type: 'object',
  additionalProperties: false,
  properties: { deleteSources: { type: 'boolean' } },
});
const coreUpdateSchema = compile<{ commit: string }>({
  type: 'object',
  additionalProperties: false,
  required: ['commit'],
  properties: { commit: { type: 'string', pattern: '^[0-9a-f]{40}$' } },
});

const unavailable: Omit<ModuleStoreView, 'coreVersion'> = {
  available: false,
  autoCheck: false,
  pendingRestart: false,
  repositories: [],
  local: null,
};

/**
 * Catalogue de modules (dépôts, installation, mises à jour) et mise à jour de Cornelius.
 * Tout est réservé à l'administration.
 */
export function registerModuleStore(
  app: FastifyInstance,
  services: {
    store: ModuleStore | null;
    core: CoreUpdater;
    coreVersion: string;
    instances: AddonRepository;
    requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  },
) {
  const { store, core, instances } = services;
  const admin = { preHandler: services.requireAdmin };
  const view = (): ModuleStoreView =>
    store?.view() ?? { ...unavailable, coreVersion: services.coreVersion };

  /** Exécute une action du catalogue et renvoie l'état à jour, ou l'erreur lisible. */
  async function act(reply: FastifyReply, task: (store: ModuleStore) => Promise<unknown>) {
    if (!store) return reply.code(503).send({ error: 'Catalogue de modules indisponible.' });
    try {
      await task(store);
    } catch (error) {
      if (error instanceof StoreError)
        return reply.code(error.status).send({ error: error.message });
      throw error;
    }
    return view();
  }

  app.get('/api/admin/module-store', admin, async () => view());

  app.post('/api/admin/module-store/repositories', admin, async (request, reply) => {
    if (!repositorySchema(request.body)) return reply.code(400).send({ error: 'Dépôt invalide.' });
    const body = request.body;
    return act(reply, (store) => store.addRepository(body));
  });

  app.delete<{ Params: { id: string } }>(
    '/api/admin/module-store/repositories/:id',
    admin,
    async (request, reply) => act(reply, (store) => store.removeRepository(request.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/module-store/repositories/:id/check',
    admin,
    async (request, reply) => act(reply, (store) => store.check(request.params.id)),
  );

  app.post('/api/admin/module-store/check', admin, async (_request, reply) =>
    act(reply, (store) => store.checkAll()),
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/module-store/repositories/:id/update',
    admin,
    async (request, reply) => act(reply, (store) => store.update(request.params.id)),
  );

  app.post('/api/admin/module-store/install', admin, async (request, reply) => {
    if (!installSchema(request.body)) return reply.code(400).send({ error: 'Module invalide.' });
    const { repository, module } = request.body;
    return act(reply, (store) => store.install(repository, module));
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/module-store/modules/:id/uninstall',
    admin,
    async (request, reply) => {
      const body = request.body ?? {};
      if (!uninstallSchema(body)) return reply.code(400).send({ error: 'Demande invalide.' });
      return act(reply, async (store) => {
        await store.uninstall(request.params.id);
        // Gardées par défaut : une réinstallation retrouve les sources telles quelles.
        if (body.deleteSources)
          for (const instance of instances.listInstances())
            if (instance.addonId === request.params.id) instances.deleteInstance(instance.id);
      });
    },
  );

  app.get('/api/admin/core-update', admin, async () => core.status());

  app.post('/api/admin/core-update/check', admin, async () => core.check());

  app.post('/api/admin/core-update/apply', admin, async (request, reply) => {
    if (!coreUpdateSchema(request.body))
      return reply.code(400).send({ error: 'Version invalide.' });
    try {
      await core.start(request.body.commit);
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
    return core.status();
  });
}
