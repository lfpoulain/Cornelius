import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  HEADER_NAME_PATTERN,
  REF_PATTERN,
  refFromLabel,
  type AddonInstance,
  type HttpActionDefinition,
} from '../shared/addons.js';
import { compile } from '../shared/validation.js';
import { safeUrl } from './addons/http.js';
import type { AddonRuntime } from './addons/runtime.js';
import type { ActionExecutor } from './actions.js';
import type { DiagnosticLog } from './logs.js';
import type { ActionRepository, AddonRepository, ProfileRepository } from './storage.js';

const refPattern = REF_PATTERN;
const idPattern = '^[a-z][a-z0-9_]{0,31}$';
const idSchema = { type: 'string', minLength: 1, maxLength: 128 };
const refSchema = { anyOf: [{ type: 'string', pattern: refPattern }, { type: 'null' }] };
const profileSchema = { anyOf: [idSchema, { type: 'null' }] };
const labelSchema = { type: 'string', minLength: 1, maxLength: 80, pattern: '\\S' };
const headersSchema = {
  type: 'object',
  propertyNames: { pattern: HEADER_NAME_PATTERN },
  // Un retour à la ligne dans une valeur ferait refuser la requête au moment de l'envoi.
  additionalProperties: { type: 'string', maxLength: 500, pattern: '^[^\\r\\n\\u0000]*$' },
  maxProperties: 20,
};
const headerName = new RegExp(HEADER_NAME_PATTERN, 'u');

/** Premier en-tête mal formé, expliqué en français ; null quand tous sont valides. */
function headerProblem(body: unknown): string | null {
  const headers = (body as { headers?: unknown } | null)?.headers;
  if (!headers || typeof headers !== 'object') return null;
  for (const [name, value] of Object.entries(headers)) {
    if (!headerName.test(name))
      return `Nom d’en-tête « ${name} » invalide : lettres, chiffres et tirets, sans espace ni accent.`;
    if (typeof value === 'string' && /[\r\n\0]/u.test(value))
      return `Valeur de l’en-tête « ${name} » invalide : pas de retour à la ligne.`;
  }
  return null;
}

const createInstance = compile<{
  addonId: string;
  enabled?: boolean;
  displayEnabled?: boolean;
  profileId: string | null;
  ref: string | null;
  label: string;
  config: Record<string, unknown>;
}>({
  type: 'object',
  additionalProperties: false,
  required: ['addonId', 'profileId', 'ref', 'label', 'config'],
  properties: {
    enabled: { type: 'boolean' },
    displayEnabled: { type: 'boolean' },
    addonId: { type: 'string', pattern: idPattern },
    profileId: profileSchema,
    ref: refSchema,
    label: labelSchema,
    config: { type: 'object' },
  },
});

const patchInstance = compile<{
  profileId?: string | null;
  ref?: string | null;
  label?: string;
  enabled?: boolean;
  displayEnabled?: boolean;
  config?: Record<string, unknown>;
}>({
  type: 'object',
  additionalProperties: false,
  properties: {
    profileId: profileSchema,
    ref: refSchema,
    label: labelSchema,
    enabled: { type: 'boolean' },
    displayEnabled: { type: 'boolean' },
    config: { type: 'object' },
  },
});

const createAction = compile<{
  ref: string;
  label: string;
  description?: string;
  method: 'GET' | 'POST';
  url: string;
  profileId: string | null;
  headers: Record<string, string>;
  body: string | null;
  confirmation: 'required' | 'none';
  enabled?: boolean;
}>({
  type: 'object',
  additionalProperties: false,
  required: ['ref', 'label', 'method', 'url', 'profileId', 'headers', 'body', 'confirmation'],
  properties: {
    ref: { type: 'string', pattern: refPattern },
    label: labelSchema,
    description: { type: 'string', maxLength: 200 },
    method: { enum: ['GET', 'POST'] },
    url: { type: 'string', minLength: 1, maxLength: 1024 },
    profileId: profileSchema,
    headers: headersSchema,
    body: { anyOf: [{ type: 'string', maxLength: 8_000 }, { type: 'null' }] },
    confirmation: { enum: ['required', 'none'] },
    enabled: { type: 'boolean' },
  },
});

const patchAction = compile<{
  ref?: string;
  label?: string;
  description?: string;
  method?: 'GET' | 'POST';
  url?: string;
  profileId?: string | null;
  headers?: Record<string, string>;
  body?: string | null;
  confirmation?: 'required' | 'none';
  enabled?: boolean;
}>({
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', pattern: refPattern },
    label: labelSchema,
    description: { type: 'string', maxLength: 200 },
    method: { enum: ['GET', 'POST'] },
    url: { type: 'string', minLength: 1, maxLength: 1024 },
    profileId: profileSchema,
    headers: headersSchema,
    body: { anyOf: [{ type: 'string', maxLength: 8_000 }, { type: 'null' }] },
    confirmation: { enum: ['required', 'none'] },
    enabled: { type: 'boolean' },
  },
});

const validateSchema = compile<{ config: Record<string, unknown> }>({
  type: 'object',
  additionalProperties: false,
  required: ['config'],
  properties: { config: { type: 'object' } },
});

const searchSchema = compile<{
  kind: string;
  query?: string;
  values?: Record<string, unknown>;
}>({
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { type: 'string', minLength: 1, maxLength: 32 },
    query: { type: 'string', maxLength: 120 },
    values: { type: 'object' },
  },
});

export function registerAddons(
  app: FastifyInstance,
  services: {
    runtime: AddonRuntime;
    actions: ActionExecutor;
    instances: AddonRepository;
    actionRepository: ActionRepository;
    profiles: ProfileRepository;
    logs: DiagnosticLog;
    /** Dossiers de addons/ refusés au chargement, avec la raison détaillée. */
    rejectedAddons?: { name: string; reason: string }[];
    onChanged?(): void;
    requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  },
) {
  const { runtime, actions, instances, actionRepository, profiles } = services;
  const admin = { preHandler: services.requireAdmin };
  app.addHook('onResponse', async (request, reply) => {
    if (
      request.method !== 'GET' &&
      request.url.startsWith('/api/admin/addons') &&
      !request.url.endsWith('/validate') &&
      reply.statusCode < 400
    )
      services.onChanged?.();
  });

  /**
   * Identifiant tiré du nom quand l'administrateur n'en donne pas (« maison », puis
   * « maison-2 ») : sans lui, la voix ne peut pas choisir entre deux sources du même module.
   * Les identifiants de tous les propriétaires comptent, le foyer et un profil se croisent.
   */
  function autoRef(addonId: string, label: string, selfId: string | null): string {
    const taken = new Set(
      instances
        .listInstances()
        .filter((instance) => instance.addonId === addonId && instance.id !== selfId)
        .map((instance) => instance.ref)
        .filter((ref): ref is string => ref !== null),
    );
    return refFromLabel(label, taken);
  }

  function instanceView(instance: AddonInstance) {
    const snapshot = instances.getSnapshot(instance);
    return {
      ...instance,
      // Le formulaire part des réglages migrés : les champs d'une nouvelle configVersion y
      // apparaissent remplis, comme à la collecte. configVersion reste celle enregistrée.
      config: runtime.editableConfig(instance),
      snapshot,
      error: instances.getError(instance.id),
      preview: runtime.preview(instance),
    };
  }

  app.get('/api/admin/addons', admin, async () => ({
    definitions: runtime.definitions(),
    instances: instances.listInstances().map(instanceView),
    rejected: services.rejectedAddons ?? [],
  }));

  // Recherche assistée (arrêts, directions) : le module interroge le fournisseur, l'admin choisit.
  app.post<{ Params: { addonId: string } }>(
    '/api/admin/addons/:addonId/search',
    admin,
    async (request, reply) => {
      if (!searchSchema(request.body))
        return reply.code(400).send({ error: 'Recherche invalide.' });
      if (!runtime.get(request.params.addonId))
        return reply.code(404).send({ error: 'Module inconnu.' });
      try {
        const results = await runtime.search(
          request.params.addonId,
          request.body,
          new AbortController().signal,
        );
        return { results };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : 'Recherche impossible.',
        });
      }
    },
  );

  // Contrôle d'un réglage avant l'enregistrement : erreurs par champ, sans rien écrire.
  app.post<{ Params: { addonId: string } }>(
    '/api/admin/addons/:addonId/validate',
    admin,
    async (request, reply) => {
      if (!validateSchema(request.body))
        return reply.code(400).send({ error: 'Réglage à contrôler absent.' });
      if (!runtime.get(request.params.addonId))
        return reply.code(404).send({ error: 'Module inconnu.' });
      const validated = runtime.validateConfig(request.params.addonId, request.body.config);
      return { errors: validated.ok ? [] : validated.errors };
    },
  );

  app.post('/api/admin/addons/instances', admin, async (request, reply) => {
    if (!createInstance(request.body)) return reply.code(400).send({ error: 'Instance invalide.' });
    const body = request.body;
    const addon = runtime.get(body.addonId);
    if (!addon) return reply.code(404).send({ error: 'Module inconnu.' });
    if (body.displayEnabled && !addon.ambient)
      return reply.code(400).send({ error: 'Ce module ne propose pas d’affichage permanent.' });
    if (body.profileId && !profiles.get(body.profileId))
      return reply.code(400).send({ error: 'Profil introuvable.' });
    const validated = runtime.validateConfig(body.addonId, body.config);
    if (!validated.ok)
      return reply.code(400).send({ error: validated.message, fields: validated.errors });
    try {
      const instance = instances.createInstance({
        addonId: body.addonId,
        enabled: body.enabled,
        displayEnabled: body.displayEnabled,
        profileId: body.profileId,
        ref: body.ref ?? autoRef(body.addonId, body.label, null),
        label: body.label.trim(),
        config: body.config,
        configVersion: addon.configVersion,
      });
      return reply.code(201).send(instanceView(instance));
    } catch {
      return reply.code(400).send({ error: 'Identifiant déjà utilisé pour ce module.' });
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/admin/addons/instances/:id',
    admin,
    async (request, reply) => {
      if (!patchInstance(request.body))
        return reply.code(400).send({ error: 'Modification invalide.' });
      const existing = instances.getInstance(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Instance introuvable.' });
      const patch = request.body;
      if (patch.profileId !== undefined && patch.profileId && !profiles.get(patch.profileId))
        return reply.code(400).send({ error: 'Profil introuvable.' });
      if (patch.config !== undefined) {
        const validated = runtime.validateConfig(existing.addonId, patch.config);
        if (!validated.ok)
          return reply.code(400).send({ error: validated.message, fields: validated.errors });
      }
      const addon = runtime.get(existing.addonId);
      if (patch.displayEnabled && !addon?.ambient)
        return reply.code(400).send({ error: 'Ce module ne propose pas d’affichage permanent.' });
      try {
        const instance = instances.updateInstance(request.params.id, {
          ...patch,
          ref:
            patch.ref === null
              ? autoRef(existing.addonId, patch.label ?? existing.label, existing.id)
              : patch.ref,
          label: patch.label?.trim(),
          configVersion: patch.config !== undefined ? addon?.configVersion : undefined,
        });
        if (patch.config !== undefined || patch.profileId !== undefined || patch.ref !== undefined)
          instances.clearState(instance.id);
        return instanceView(instance);
      } catch {
        return reply.code(400).send({ error: 'Identifiant déjà utilisé pour ce module.' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/addons/instances/:id',
    admin,
    async (request, reply) => {
      if (!instances.getInstance(request.params.id))
        return reply.code(404).send({ error: 'Instance introuvable.' });
      instances.deleteInstance(request.params.id);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/addons/instances/:id/test',
    admin,
    async (request, reply) => {
      const instance = instances.getInstance(request.params.id);
      if (!instance) return reply.code(404).send({ error: 'Instance introuvable.' });
      try {
        const snapshot = await runtime.test(instance);
        return { snapshot, error: instances.getError(instance.id) };
      } catch (error) {
        services.logs.write('error', 'addon', 'Test de module impossible', { error });
        return reply.code(400).send({ error: 'Test impossible.' });
      }
    },
  );

  /** Commande vue par l'administration : les secrets cités et absents sont signalés. */
  function actionView(action: HttpActionDefinition) {
    return { ...action, missingSecrets: actions.missingSecrets(action) };
  }

  app.get('/api/admin/actions', admin, async () => actionRepository.listActions().map(actionView));

  app.get('/api/admin/actions/runs', admin, async () => actionRepository.listRuns(20));

  // Validation des effets sensibles : canal authentifié uniquement, jamais le modèle.
  app.get('/api/admin/actions/confirmations', admin, async () =>
    actionRepository.listConfirmations(Date.now()),
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/actions/confirmations/:id/approve',
    admin,
    async (request, reply) => {
      if (!actionRepository.approveConfirmation(request.params.id, Date.now()))
        return reply.code(404).send({ error: 'Confirmation inconnue, déjà validée ou expirée.' });
      services.logs.write('info', 'action', 'Confirmation d’action validée', {
        confirmationId: request.params.id,
      });
      return { ok: true };
    },
  );

  // Refus explicite : la demande disparaît et un rappel du modèle avec cet identifiant est annulé.
  app.post<{ Params: { id: string } }>(
    '/api/admin/actions/confirmations/:id/reject',
    admin,
    async (request, reply) => {
      const confirmation = actionRepository.getConfirmation(request.params.id);
      if (!confirmation || confirmation.expiresAt <= Date.now())
        return reply.code(404).send({ error: 'Demande inconnue, déjà traitée ou expirée.' });
      actionRepository.deleteConfirmation(confirmation.id);
      services.logs.write('info', 'action', 'Confirmation d’action refusée', {
        confirmationId: confirmation.id,
      });
      return { ok: true };
    },
  );

  app.post('/api/admin/actions', admin, async (request, reply) => {
    const header = headerProblem(request.body);
    if (header) return reply.code(400).send({ error: header });
    if (!createAction(request.body)) return reply.code(400).send({ error: 'Action invalide.' });
    const body = request.body;
    if (body.profileId && !profiles.get(body.profileId))
      return reply.code(400).send({ error: 'Profil introuvable.' });
    try {
      safeUrl(body.url);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    try {
      return reply.code(201).send(
        actionView(
          actionRepository.createAction({
            ref: body.ref,
            label: body.label.trim(),
            description: body.description?.trim() ?? '',
            method: body.method,
            url: body.url,
            profileId: body.profileId,
            headers: body.headers,
            body: body.body,
            confirmation: body.confirmation,
            enabled: body.enabled,
          }),
        ),
      );
    } catch {
      return reply.code(400).send({ error: 'Identifiant déjà utilisé.' });
    }
  });

  app.patch<{ Params: { id: string } }>('/api/admin/actions/:id', admin, async (request, reply) => {
    const header = headerProblem(request.body);
    if (header) return reply.code(400).send({ error: header });
    if (!patchAction(request.body))
      return reply.code(400).send({ error: 'Modification invalide.' });
    const existing = actionRepository.getAction(request.params.id);
    if (!existing) return reply.code(404).send({ error: 'Action introuvable.' });
    const patch = request.body;
    if (patch.profileId !== undefined && patch.profileId && !profiles.get(patch.profileId))
      return reply.code(400).send({ error: 'Profil introuvable.' });
    if (patch.url !== undefined) {
      try {
        safeUrl(patch.url);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    }
    try {
      return actionView(
        actionRepository.updateAction(request.params.id, {
          ...patch,
          label: patch.label?.trim(),
          description: patch.description?.trim(),
        }),
      );
    } catch {
      return reply.code(400).send({ error: 'Identifiant déjà utilisé.' });
    }
  });

  app.delete<{ Params: { id: string } }>(
    '/api/admin/actions/:id',
    admin,
    async (request, reply) => {
      if (!actionRepository.getAction(request.params.id))
        return reply.code(404).send({ error: 'Action introuvable.' });
      actionRepository.deleteAction(request.params.id);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/actions/:id/test',
    admin,
    async (request, reply) => {
      const action = actionRepository.getAction(request.params.id);
      if (!action) return reply.code(404).send({ error: 'Action introuvable.' });
      return actions.test(action);
    },
  );
}
