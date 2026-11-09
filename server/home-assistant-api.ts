import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { compile } from '../shared/validation.js';
import { HomeAssistant, commandSchema, homeAssistantError } from './home-assistant.js';
import {
  HOME_ASSISTANT_ENTITY_PATTERN,
  type HomeAssistantCommand,
} from '../shared/home-assistant.js';

const revision = { type: 'integer', minimum: 0 };
const connection = compile<{ url: string; token?: string; revision: number }>({
  type: 'object',
  additionalProperties: false,
  required: ['url', 'revision'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    token: { type: 'string', maxLength: 4096, pattern: '^[^\\s]*$' },
    revision,
  },
});
const selection = compile<{ selected: string[]; revision: number }>({
  type: 'object',
  additionalProperties: false,
  required: ['selected', 'revision'],
  properties: {
    selected: {
      type: 'array',
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', pattern: HOME_ASSISTANT_ENTITY_PATTERN, maxLength: 255 },
    },
    revision,
  },
});
// Les autorisations s’enregistrent seules, sans emporter une sélection en cours de modification.
const access = compile<{
  enabled?: boolean;
  knownPeopleOnly?: boolean;
  climateControl?: boolean;
  revision: number;
}>({
  type: 'object',
  additionalProperties: false,
  required: ['revision'],
  minProperties: 2,
  properties: {
    enabled: { type: 'boolean' },
    knownPeopleOnly: { type: 'boolean' },
    climateControl: { type: 'boolean' },
    revision,
  },
});
const remove = compile<{ revision: number }>({
  type: 'object',
  additionalProperties: false,
  required: ['revision'],
  properties: { revision },
});
const command = compile<HomeAssistantCommand>(commandSchema);

export function registerHomeAssistant(
  app: FastifyInstance,
  home: HomeAssistant,
  requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  onChanged: () => void,
) {
  const admin = { preHandler: requireAdmin };
  const guarded = async (reply: FastifyReply, operation: () => unknown | Promise<unknown>) => {
    try {
      return await operation();
    } catch (error) {
      const failure = homeAssistantError(error);
      return reply
        .code(failure.code === 'conflict' ? 409 : failure.code === 'invalid_params' ? 400 : 502)
        .send({ error: failure.message });
    }
  };
  app.get('/api/admin/home-assistant', admin, async () => home.view());
  app.put('/api/admin/home-assistant', admin, async (request, reply) => {
    if (!connection(request.body))
      return reply.code(400).send({ error: 'Adresse ou jeton invalide.' });
    const input = request.body;
    return guarded(reply, async () => {
      const view = await home.configure(input);
      onChanged();
      return view;
    });
  });
  app.put('/api/admin/home-assistant/selection', admin, async (request, reply) => {
    if (!selection(request.body))
      return reply.code(400).send({ error: 'Sélection invalide (100 appareils maximum).' });
    const input = request.body;
    return guarded(reply, () => {
      const view = home.select(input);
      onChanged();
      return view;
    });
  });
  app.patch('/api/admin/home-assistant/access', admin, async (request, reply) => {
    if (!access(request.body)) return reply.code(400).send({ error: 'Autorisation invalide.' });
    const input = request.body;
    return guarded(reply, () => {
      const view = home.setAccess(input);
      onChanged();
      return view;
    });
  });
  app.post('/api/admin/home-assistant/refresh', admin, async (_request, reply) =>
    guarded(reply, () => home.refresh()),
  );
  app.post('/api/admin/home-assistant/assist', admin, async (_request, reply) =>
    guarded(reply, () => home.assistSelection()),
  );
  app.post('/api/admin/home-assistant/control', admin, async (request, reply) => {
    if (!command(request.body)) return reply.code(400).send({ error: 'Commande invalide.' });
    return home.runManual(request.body, AbortSignal.timeout(12_000));
  });
  app.delete('/api/admin/home-assistant', admin, async (request, reply) => {
    if (!remove(request.body)) return reply.code(400).send({ error: 'Révision manquante.' });
    const input = request.body;
    return guarded(reply, () => {
      const view = home.disconnect(input.revision);
      onChanged();
      return view;
    });
  });
}
