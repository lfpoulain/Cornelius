import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ALARM_LABEL_MAX,
  ALARM_RING_MINUTES_MAX,
  ALARM_RING_MINUTES_MIN,
  ALARM_SNOOZE_MS,
  TIMER_MAX_MS,
  type AlarmRequest,
  type AlarmSettings,
} from '../shared/alarms.js';
import { compile } from '../shared/validation.js';
import { AlarmError, type Alarms } from './alarms.js';
import type { ProfileRepository } from './storage.js';

const settingsSchema = compile<Partial<AlarmSettings>>({
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    enabled: { type: 'boolean' },
    ringMinutes: {
      type: 'integer',
      minimum: ALARM_RING_MINUTES_MIN,
      maximum: ALARM_RING_MINUTES_MAX,
    },
  },
});

// Le satellite visé arrive avec la voix ; l'administration crée pour le miroir.
const createSchema = compile<Omit<AlarmRequest, 'target'>>({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'profileId', 'label', 'time', 'date', 'days', 'durationMs', 'inMinutes'],
  properties: {
    kind: { enum: ['alarm', 'timer', 'reminder'] },
    profileId: { type: ['string', 'null'], minLength: 1, maxLength: 128 },
    label: {
      type: 'string',
      maxLength: ALARM_LABEL_MAX * 2,
      pattern: '^[^\\u0000-\\u001f\\u007f]*$',
    },
    time: { type: ['string', 'null'], maxLength: 5 },
    date: { type: ['string', 'null'], maxLength: 10 },
    days: { type: 'integer', minimum: 0, maximum: 127 },
    durationMs: { type: ['integer', 'null'], minimum: 0, maximum: TIMER_MAX_MS },
    inMinutes: { type: ['integer', 'null'], minimum: 0, maximum: 366 * 24 * 60 },
  },
});

export function registerAlarms(
  app: FastifyInstance,
  services: {
    alarms: Alarms;
    profiles: ProfileRepository;
    requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  },
) {
  const { alarms, profiles, requireAdmin } = services;
  const admin = { preHandler: requireAdmin };

  app.get('/api/admin/alarms', admin, async () => alarms.view());

  app.put<{ Body: Partial<AlarmSettings> }>(
    '/api/admin/alarms/settings',
    admin,
    async (request, reply) => {
      if (!settingsSchema(request.body))
        return reply.code(400).send({ error: 'Réglages des alarmes invalides.' });
      alarms.saveSettings(request.body);
      return alarms.view();
    },
  );

  app.post<{ Body: Omit<AlarmRequest, 'target'> }>(
    '/api/admin/alarms',
    admin,
    async (request, reply) => {
      if (!createSchema(request.body)) return reply.code(400).send({ error: 'Échéance invalide.' });
      if (request.body.profileId !== null && !profiles.get(request.body.profileId))
        return reply.code(400).send({ error: 'Profil inconnu.', field: 'profileId' });
      try {
        alarms.create({ ...request.body, target: 'mirror' });
      } catch (error) {
        if (error instanceof AlarmError)
          return reply.code(400).send({ error: error.message, field: error.field });
        throw error;
      }
      return alarms.view();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/alarms/:id/stop',
    admin,
    async (request, reply) => {
      if (!alarms.get(request.params.id))
        return reply.code(404).send({ error: 'Échéance inconnue.' });
      if (!alarms.stop(request.params.id))
        return reply.code(409).send({ error: 'Cette échéance ne sonne pas.' });
      return alarms.view();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/alarms/:id/snooze',
    admin,
    async (request, reply) => {
      if (!alarms.get(request.params.id))
        return reply.code(404).send({ error: 'Échéance inconnue.' });
      if (!alarms.snooze(request.params.id, ALARM_SNOOZE_MS))
        return reply.code(409).send({ error: 'Cette échéance ne sonne pas.' });
      return alarms.view();
    },
  );

  app.delete<{ Params: { id: string } }>('/api/admin/alarms/:id', admin, async (request, reply) => {
    if (!alarms.remove(request.params.id))
      return reply.code(404).send({ error: 'Échéance inconnue.' });
    return alarms.view();
  });
}
