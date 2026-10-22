import { isCameraMode } from '../shared/camera.js';
import { randomUUID } from 'node:crypto';
import type { DiagnosticLog } from './logs.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  Scope,
  DevicesStatus,
  EngagementSettings,
  VisionDevice,
  VisionMode,
  VisionModel,
} from '../shared/types.js';
import { VISION_DEVICES, VISION_MODELS, VISION_MODES } from '../shared/types.js';
import { compile } from '../shared/validation.js';
import type { SessionController } from './controller.js';
import type { LiveTransport } from './live/transport.js';
import type { PerceptionBridge } from './perception.js';
import type { WakeArbiter } from './wake-arbiter.js';
import type { ModelDownloads } from './model-downloads.js';
import type { VisionBridge } from './vision.js';

const scopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['interactionId', 'profileEpoch', 'contextVersion'],
  properties: {
    interactionId: { type: 'string', minLength: 1, maxLength: 128 },
    profileEpoch: { type: 'integer', minimum: 0 },
    contextVersion: { type: 'integer', minimum: 0 },
  },
};
const validateOffer = compile<{ scope: Scope; sdp: string }>({
  type: 'object',
  additionalProperties: false,
  required: ['scope', 'sdp'],
  properties: { scope: scopeSchema, sdp: { type: 'string', minLength: 1, maxLength: 60_000 } },
});
const validateMedia = compile<{ scope: Scope; type: 'connected' | 'started' | 'failed' }>({
  type: 'object',
  additionalProperties: false,
  required: ['scope', 'type'],
  properties: { scope: scopeSchema, type: { enum: ['connected', 'started', 'failed'] } },
});

export function registerHardware(
  app: FastifyInstance,
  services: {
    logs: DiagnosticLog;
    live: LiveTransport | null;
    controller: SessionController;
    perception: PerceptionBridge;
    /** Départage le miroir et les satellites qui entendent le même « Cornelius ». */
    wakeArbiter: WakeArbiter;
    vision: VisionBridge;
    downloads: ModelDownloads;
    authorize(role: 'admin' | 'kiosk'): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    currentKiosk(req: FastifyRequest): boolean;
    workerAuthorized(req: FastifyRequest): boolean;
    devices(): DevicesStatus;
    /** Le visage oublié est aussi retiré des copies de sécurité de la base. */
    faceForgotten?(profileId: string): void;
  },
) {
  const { live, controller, perception, authorize } = services;
  const audioCatchupSenders = new Map<string, () => void>();
  live?.onFirstAssistantResponse((scope) => {
    const interactionId = scope.interactionId;
    if (interactionId) audioCatchupSenders.get(interactionId)?.();
  });
  const kiosk = async (req: FastifyRequest, reply: FastifyReply) => {
    await authorize('kiosk')(req, reply);
    if (!reply.sent && !services.currentKiosk(req))
      reply.code(409).send({ error: 'Un autre onglet affiche déjà le miroir.' });
  };
  app.get('/api/admin/devices', { preHandler: authorize('admin') }, async () => services.devices());

  const recognitionSettings = compile<{ threshold: number }>({
    type: 'object',
    additionalProperties: false,
    required: ['threshold'],
    properties: { threshold: { type: 'number', minimum: 0.2, maximum: 0.65 } },
  });
  app.patch('/api/admin/recognition', { preHandler: authorize('admin') }, async (req, reply) => {
    if (!recognitionSettings(req.body))
      return reply.code(400).send({ error: 'Seuil attendu entre 0,20 et 0,65.' });
    perception.setRecognitionThreshold(req.body.threshold);
    return { ok: true };
  });

  const engagementSettings = compile<EngagementSettings>({
    type: 'object',
    additionalProperties: false,
    required: ['poseTolerance', 'minFaceRatio'],
    properties: {
      poseTolerance: { type: 'number', minimum: 0.1, maximum: 0.5 },
      minFaceRatio: { type: 'number', minimum: 0.05, maximum: 0.3 },
    },
  });
  app.patch('/api/admin/engagement', { preHandler: authorize('admin') }, async (req, reply) => {
    if (!engagementSettings(req.body))
      return reply.code(400).send({ error: 'Réglages d’engagement invalides.' });
    perception.setEngagement(req.body);
    return { ok: true };
  });

  const visionSettings = compile<{ mode: VisionMode }>({
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: { mode: { enum: [...VISION_MODES] } },
  });
  app.patch('/api/admin/vision', { preHandler: authorize('admin') }, async (req, reply) => {
    if (!visionSettings(req.body))
      return reply.code(400).send({ error: 'Mode de vision invalide.' });
    try {
      services.vision.setMode(req.body.mode);
      // Mode voix : sans vision ni reconnaissance, la caméra reste éteinte même en conversation.
      perception.syncCamera();
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  const visionModelSettings = compile<{ model: VisionModel }>({
    type: 'object',
    additionalProperties: false,
    required: ['model'],
    properties: { model: { enum: [...VISION_MODELS] } },
  });
  app.patch('/api/admin/vision/model', { preHandler: authorize('admin') }, async (req, reply) => {
    if (!visionModelSettings(req.body))
      return reply.code(400).send({ error: 'Modèle de vision inconnu.' });
    try {
      services.downloads.ensure(req.body.model, services.vision.snapshot().device);
      services.vision.setModel(req.body.model);
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  const visionDeviceSettings = compile<{ device: VisionDevice }>({
    type: 'object',
    additionalProperties: false,
    required: ['device'],
    properties: { device: { enum: [...VISION_DEVICES] } },
  });
  app.patch('/api/admin/vision/device', { preHandler: authorize('admin') }, async (req, reply) => {
    if (!visionDeviceSettings(req.body))
      return reply.code(400).send({ error: 'Périphérique de vision inconnu.' });
    try {
      services.downloads.ensure(services.vision.snapshot().modelId, req.body.device);
      services.vision.setDevice(req.body.device);
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  const cameraSelection = compile<{ id: string }>({
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 1024 } },
  });
  app.post('/api/admin/camera/refresh', { preHandler: authorize('admin') }, async (_req, reply) => {
    try {
      perception.camera.refresh();
      return { ok: true };
    } catch (error) {
      services.logs.write('error', 'local', 'Échec opération matérielle', { error });
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
  // Page Caméra ou Visages ouverte : la caméra reste allumée le temps du réglage.
  app.post('/api/admin/camera/hold', { preHandler: authorize('admin') }, async () => {
    perception.holdCamera();
    return { ok: true };
  });
  app.put('/api/admin/camera/mode', { preHandler: authorize('admin') }, async (req, reply) => {
    if (!isCameraMode(req.body))
      return reply.code(400).send({ error: 'Résolution ou cadence non proposée.' });
    try {
      perception.setCameraMode({
        width: req.body.width,
        height: req.body.height,
        fps: req.body.fps,
      });
      return { ok: true };
    } catch (error) {
      services.logs.write('error', 'local', 'Échec opération matérielle', { error });
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
  app.post('/api/admin/camera/select', { preHandler: authorize('admin') }, async (req, reply) => {
    if (!cameraSelection(req.body)) return reply.code(400).send({ error: 'Caméra invalide.' });
    try {
      perception.selectCamera(req.body.id);
      return { ok: true };
    } catch (error) {
      services.logs.write('error', 'local', 'Échec opération matérielle', { error });
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
  app.get(
    '/api/admin/camera/frame',
    { preHandler: authorize('admin'), config: { rateLimit: { max: 8, timeWindow: '1 second' } } },
    async (_req, reply) => {
      try {
        const jpeg = await perception.camera.preview();
        return reply.type('image/jpeg').header('Cache-Control', 'no-store').send(jpeg);
      } catch {
        return reply
          .code(503)
          .send({ error: 'Aucune image récente. Vérifiez la caméra et la perception.' });
      }
    },
  );

  app.get('/api/admin/recognition/live', { preHandler: authorize('admin') }, async () => ({
    live: perception.recognitionLive(),
  }));
  app.delete('/api/admin/enrollment', { preHandler: authorize('admin') }, async () => {
    perception.cancelEnrollment();
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { mode?: unknown } | undefined }>(
    '/api/admin/profiles/:id/enroll',
    { preHandler: authorize('admin') },
    async (req, reply) => {
      const mode = req.body?.mode ?? 'replace';
      if (mode !== 'replace' && mode !== 'add')
        return reply.code(400).send({ error: 'Mode d’enregistrement invalide.' });
      try {
        perception.enroll(req.params.id, mode);
        return { ok: true };
      } catch (error) {
        services.logs.write('error', 'local', 'Échec opération matérielle', { error });
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/admin/profiles/:id/face',
    { preHandler: authorize('admin') },
    async (req) => {
      perception.forget(req.params.id);
      services.faceForgotten?.(req.params.id);
      return { ok: true };
    },
  );
  app.post('/api/media/offer', { preHandler: kiosk, bodyLimit: 65536 }, async (req, reply) => {
    if (!live || !validateOffer(req.body))
      return reply.code(400).send({ error: 'Offre média indisponible ou invalide.' });
    try {
      return await live.offer(req.body.scope, req.body.sdp);
    } catch (error) {
      services.logs.write('error', 'local', 'Échec opération matérielle', { error });
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
  app.post('/api/media/status', { preHandler: kiosk }, async (req, reply) => {
    if (!live || !validateMedia(req.body))
      return reply.code(400).send({ error: 'État média invalide.' });
    try {
      const { scope, type } = req.body;
      // Le miroir n’a pas de média dans la conversation d’un satellite : rien à signaler.
      if (controller.sessionState().satellite) return { ok: true };
      if (type === 'connected') live.mediaConnected(scope);
      else if (type === 'started') live.started(scope);
      else if (
        Object.entries(scope).every(
          ([key, value]) => controller.scope()[key as keyof Scope] === value,
        )
      ) {
        controller.close(
          'Microphone ou lecture audio indisponible. Vérifiez les autorisations du navigateur.',
        );
        controller.publish();
      }
      return { ok: true };
    } catch (error) {
      services.logs.write('error', 'local', 'Échec opération matérielle', { error });
      return reply.code(400).send({ error: (error as Error).message });
    }
  });
  app.get(
    '/perception',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        if (!services.workerAuthorized(req))
          return reply.code(403).send({ error: 'Perception non autorisée.' });
      },
    },
    (socket) => perception.connect(socket),
  );
  app.get<{
    Querystring: { interactionId?: string; profileEpoch?: string; contextVersion?: string };
  }>('/voice-audio', { websocket: true, preValidation: kiosk }, (socket, req) => {
    if (!live) return socket.close(1008, 'Voix indisponible.');
    const scope = {
      interactionId: req.query.interactionId ?? null,
      profileEpoch: Number(req.query.profileEpoch),
      contextVersion: Number(req.query.contextVersion),
    };
    if (
      !scope.interactionId ||
      !Number.isSafeInteger(scope.profileEpoch) ||
      !Number.isSafeInteger(scope.contextVersion)
    )
      return socket.close(1008, 'Session invalide.');
    let connection: ReturnType<LiveTransport['browserAudio']>;
    try {
      connection = live.browserAudio(scope, (pcm) => {
        if (socket.readyState !== 1) return;
        if (socket.bufferedAmount > 256_000) return socket.close(1013, 'Lecture audio trop lente.');
        socket.send(
          pcm === 'ready'
            ? JSON.stringify({ type: 'ready' })
            : (pcm ?? JSON.stringify({ type: 'interrupted' })),
        );
      });
    } catch {
      return socket.close(1008, 'Session indisponible.');
    }
    socket.on('message', (data, binary) => {
      if (
        !binary ||
        !services.currentKiosk(req) ||
        !Object.entries(scope).every(
          ([key, value]) => controller.scope()[key as keyof Scope] === value,
        ) ||
        !['connecting', 'ready'].includes(controller.sessionState().phase)
      )
        return socket.close(1008, 'Session média périmée.');
      const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (pcm.length !== 1024) return socket.close(1008, 'Trame audio invalide.');
      connection.send(pcm);
      perception.audio(scope.interactionId!, pcm);
    });
    socket.on('close', () => connection.close());
    socket.on('error', () => socket.close());
  });
  app.get('/wake-audio', { websocket: true, preValidation: kiosk }, (socket, req) => {
    if (!controller.isWakeListening())
      return socket.close(1008, 'Écoute du mot d’appel indisponible.');
    const streamId = randomUUID();
    const started = perception.startWakeStream(streamId, (score) =>
      services.wakeArbiter.detected({
        score,
        accept: () =>
          controller.wakeDetected(() => {
            if (socket.readyState === 1 && controller.isAdvancedAudioBuffer())
              socket.send(JSON.stringify({ type: 'wake_detected' }));
          }),
      }),
    );
    if (!started) return socket.close(1008, 'Écoute du mot d’appel saturée.');
    socket.on('message', (data, binary) => {
      if (!binary || !services.currentKiosk(req) || !controller.isWakeListening())
        return socket.close(1008, 'Écoute du mot d’appel périmée.');
      const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (pcm.length !== 2560) return socket.close(1008, 'Trame de veille invalide.');
      perception.wakeAudio(streamId, pcm);
    });
    socket.on('close', () => perception.endWakeStream(streamId));
    socket.on('error', () => socket.close());
  });
  app.get<{ Querystring: { interactionId?: string } }>(
    '/audio',
    { websocket: true, preValidation: kiosk },
    (socket, req) => {
      const id = req.query.interactionId;
      if (!live || !id || id !== controller.scope().interactionId)
        return socket.close(1008, 'Session média périmée.');
      const sendAudioCatchup = () => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'audio_catchup' }));
      };
      audioCatchupSenders.set(id, sendAudioCatchup);
      socket.on('close', () => {
        if (audioCatchupSenders.get(id) === sendAudioCatchup) audioCatchupSenders.delete(id);
      });
      socket.on('message', (data, binary) => {
        const state = controller.sessionState();
        if (
          !binary ||
          state.interactionId !== id ||
          !['connecting', 'ready'].includes(state.phase) ||
          !services.currentKiosk(req)
        )
          return socket.close(1008, 'Session média périmée.');
        perception.audio(id, Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      });
      socket.on('error', () => socket.close());
    },
  );
}
