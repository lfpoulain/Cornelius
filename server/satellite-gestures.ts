import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { compile } from '../shared/validation.js';
import {
  GESTURES,
  GESTURE_ACTIONS,
  defaultGestureConfig,
  type Gesture,
  type GestureConfig,
} from '../shared/satellite-gestures.js';
import type { SatelliteStore } from './satellites-store.js';
import type { SatelliteHub } from './satellites.js';
import type { SessionController } from './controller.js';
import type { HomeAssistant } from './home-assistant.js';

export const satelliteGesturesMigration = `CREATE TABLE IF NOT EXISTS satellite_gestures (
  satellite_id TEXT PRIMARY KEY REFERENCES satellites(id) ON DELETE CASCADE,
  config TEXT NOT NULL CHECK(json_valid(config))
) STRICT;`;
export const validateGestureConfig = compile<GestureConfig>({
  type: 'object',
  additionalProperties: false,
  required: ['enabled', 'bindings'],
  properties: {
    enabled: { type: 'boolean' },
    lightEntityIds: {
      type: 'array',
      maxItems: 50,
      uniqueItems: true,
      items: { type: 'string', pattern: '^(light|switch)\\.[a-z0-9_]+$', maxLength: 255 },
    },
    bindings: {
      type: 'object',
      additionalProperties: false,
      required: [...GESTURES],
      properties: {
        ...Object.fromEntries(GESTURES.map((g) => [g, { enum: [...GESTURE_ACTIONS] }])),
        // Accept older administration clients, but never retain or execute these bindings.
        clockwise: { enum: [...GESTURE_ACTIONS] },
        counterclockwise: { enum: [...GESTURE_ACTIONS] },
      },
    },
  },
});

export class SatelliteGestures {
  private last = new Map<string, { gesture: Gesture; at: number; result: string }>();
  private busy = new Set<string>();
  constructor(
    private deps: {
      db: DatabaseSync;
      store: SatelliteStore;
      hub: SatelliteHub;
      controller: SessionController;
      home: Pick<HomeAssistant, 'runSatelliteGesture' | 'view'>;
    },
  ) {}
  forget(id: string) {
    this.last.delete(id);
  }
  config(id: string): GestureConfig {
    const row = this.deps.db
      .prepare('SELECT config FROM satellite_gestures WHERE satellite_id=?')
      .get(id);
    if (!row) return defaultGestureConfig();
    const saved: unknown = JSON.parse(String(row.config));
    if (!validateGestureConfig(saved)) return defaultGestureConfig();
    return {
      enabled: saved.enabled,
      lightEntityIds: saved.lightEntityIds ?? [],
      bindings: Object.fromEntries(
        GESTURES.map((g) => [g, saved.bindings[g] ?? 'none']),
      ) as GestureConfig['bindings'],
    };
  }
  save(id: string, value: GestureConfig) {
    const supported: GestureConfig = {
      enabled: value.enabled,
      lightEntityIds: value.lightEntityIds ?? [],
      bindings: Object.fromEntries(
        GESTURES.map((g) => [g, value.bindings[g]]),
      ) as GestureConfig['bindings'],
    };
    this.deps.db
      .prepare(
        'INSERT INTO satellite_gestures VALUES (?,?) ON CONFLICT(satellite_id) DO UPDATE SET config=excluded.config',
      )
      .run(id, JSON.stringify(supported));
  }
  async receive(id: string, gesture: Gesture, current: () => boolean = () => true) {
    const now = Date.now();
    if (
      !GESTURES.includes(gesture) ||
      !current() ||
      this.busy.has(id) ||
      now - (this.last.get(id)?.at ?? 0) < 700
    )
      return;
    const event = { gesture, at: now, result: 'capture' };
    this.last.set(id, event);
    const satellite = this.deps.store.get(id);
    const config = this.config(id);
    if (!satellite || !config.enabled) return;
    const action = config.bindings[gesture];
    if (action === 'none') return;
    this.busy.add(id);
    try {
      if (action === 'volume_up' || action === 'volume_down') {
        const next = this.deps.store.update(id, {
          volume: Math.max(
            0,
            Math.min(100, satellite.volume + (action === 'volume_up' ? 10 : -10)),
          ),
        });
        if (next) {
          this.deps.hub.refresh(next);
        }
      } else if (action === 'night_light') {
        const next = this.deps.store.update(id, { nightLight: !satellite.nightLight });
        if (next) this.deps.hub.refresh(next);
      } else if (action === 'mute' || action === 'mic_toggle') {
        event.result = this.deps.hub.mute(id)
          ? 'coupure du micro demandée'
          : 'mise à jour du firmware nécessaire pour couper le micro';
        return;
      } else if (action === 'stop') {
        if (this.deps.controller.sessionState().satellite?.id !== id) {
          event.result = 'aucune conversation dans cette pièce';
          return;
        }
        this.deps.controller.close('Arrêt par geste du satellite.');
        this.deps.controller.publish();
      } else {
        // Explicit physical control of this satellite's room lights, independent of voice identity.
        const ids = [...new Set(config.lightEntityIds ?? [])];
        const catalog = this.deps.home.view();
        const allowed = new Set(
          catalog.entities
            .filter(
              (e) =>
                catalog.selected.includes(e.id) && (e.domain === 'light' || e.domain === 'switch'),
            )
            .map((e) => e.id),
        );
        if (!ids.length || ids.length > 50 || ids.some((entity) => !allowed.has(entity))) {
          event.result = 'lampes absentes ou non autorisées';
          return;
        }
        const signal = AbortSignal.timeout(15000);
        for (const entityId of ids) {
          // Never replay across disconnection, revocation or a configuration change.
          if (
            !current() ||
            signal.aborted ||
            !this.deps.hub.status(id).online ||
            JSON.stringify(this.config(id)) !== JSON.stringify(config)
          ) {
            event.result = 'commande annulée';
            return;
          }
          const result = await this.deps.home.runSatelliteGesture(
            {
              entityId,
              action: action === 'lights_on' ? 'turn_on' : 'turn_off',
              brightnessPct: null,
            },
            signal,
          );
          if (result.status !== 'succeeded' || result.result?.confirmed !== true) {
            event.result = result.summary;
            return;
          }
        }
      }
      event.result = 'commande appliquée : ' + action;
    } catch {
      event.result = 'échec de commande';
    } finally {
      this.busy.delete(id);
    }
  }
  register(
    app: FastifyInstance,
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  ) {
    app.get<{ Params: { id: string } }>(
      '/api/admin/satellites/:id/gestures',
      { preHandler: requireAdmin },
      async (request, reply) => {
        const id = request.params.id;
        if (!this.deps.store.get(id))
          return reply.code(404).send({ error: 'Satellite introuvable.' });
        const catalog = this.deps.home.view();
        const selected = new Set(catalog.selected);
        return {
          config: this.config(id),
          last: this.last.get(id) ?? null,
          supported: this.deps.hub.status(id).gestures === true,
          lights: catalog.entities
            .filter((e) => selected.has(e.id) && (e.domain === 'light' || e.domain === 'switch'))
            .map((e) => ({ id: e.id, name: e.name })),
        };
      },
    );
    app.put<{ Params: { id: string } }>(
      '/api/admin/satellites/:id/gestures',
      { preHandler: requireAdmin },
      async (request, reply) => {
        if (!this.deps.store.get(request.params.id))
          return reply.code(404).send({ error: 'Satellite introuvable.' });
        if (!validateGestureConfig(request.body))
          return reply.code(400).send({ error: 'Associations de gestes invalides.' });
        this.save(request.params.id, request.body);
        return { config: this.config(request.params.id) };
      },
    );
  }
}
