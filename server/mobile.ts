import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppConfig } from './config.js';
import type { SessionController } from './controller.js';
import type { PerceptionBridge } from './perception.js';
import type { LiveTransport } from './live/transport.js';
import type { WakeArbiter } from './wake-arbiter.js';
import { MobileStore } from './mobile-store.js';
import {
  MOBILE_FRAME_MAX,
  MOBILE_PROTOCOL,
  type MobileEndpoint,
  type MobileInvitation,
} from '../shared/mobile.js';
import { validateMirrorCommand } from '../shared/commands.js';
import { localAddresses, machineHostnames } from './network.js';

export function registerMobile(
  app: FastifyInstance,
  services: {
    db: DatabaseSync;
    now: () => number;
    config: AppConfig;
    controller: SessionController;
    perception: PerceptionBridge;
    live: LiveTransport;
    wakeArbiter: WakeArbiter;
    requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void>;
    defaultPassword(): boolean;
    image(id: string): string | null;
    claim(socket: WebSocket, deviceId: string): void;
    current(socket: WebSocket): boolean;
    gone(socket: WebSocket): void;
  },
) {
  const { controller, perception, live, config, now } = services;
  const store = new MobileStore(services.db, now);
  const sockets = new Set<WebSocket>();
  let owner: {
    socket: WebSocket;
    deviceId: string;
    generation: string;
    audio: WebSocket | null;
    camera: WebSocket | null;
    preroll: Buffer[];
  } | null = null;
  const remoteEndpoint = (): MobileEndpoint[] => {
    if (!config.mobileRemoteUrl) return [];
    try {
      const url = new URL(config.mobileRemoteUrl);
      if (
        url.protocol !== 'https:' ||
        !url.hostname.endsWith('.ts.net') ||
        url.username ||
        url.password ||
        url.port ||
        !['', '/'].includes(url.pathname) ||
        url.search ||
        url.hash
      )
        return [];
      return [{ url: url.origin, trust: 'system' }];
    } catch {
      return [];
    }
  };
  const info = () => ({
    protocol: MOBILE_PROTOCOL,
    serverId: store.serverId,
    endpoints: remoteEndpoint(),
  });
  let captureEnabled: boolean | null = null;
  const unsubscribe = controller.subscribe(() => {
    const enabled = perception.mobileCameraEnabled();
    if (owner?.socket.readyState === 1 && enabled !== captureEnabled) {
      captureEnabled = enabled;
      owner.socket.send(JSON.stringify({ type: 'capture', enabled }));
    }
  });
  perception.onMobileSnapshot(() => {
    if (owner?.socket.readyState === 1 && !controller.mobileMirror()?.background)
      owner.socket.send(JSON.stringify({ type: 'snapshot' }));
  });
  const token = (req: FastifyRequest) =>
    /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!store.authenticate(token(req)))
      await reply.code(401).send({ error: 'Appareil non associé ou révoqué.' });
  };
  const track = (socket: WebSocket) => {
    sockets.add(socket);
    socket.on('error', () => socket.close());
    socket.on('close', () => sockets.delete(socket));
  };
  const release = () => {
    const previous = owner;
    owner = null;
    if (!previous) return;
    previous.audio?.close(1008, 'Miroir remplacé.');
    previous.camera?.close(1008, 'Miroir remplacé.');
    perception.endWakeStream(previous.generation);
    controller.setMobileMirror(null);
    perception.setMobileSource(null);
    controller.setBrowserAudioReady(false);
  };
  app.get('/api/admin/mobile', { preHandler: services.requireAdmin }, async () => ({
    ...info(),
    devices: store.list(),
    remoteConfigured: remoteEndpoint().length > 0,
  }));
  app.post<{ Body: { localUrl?: string } }>(
    '/api/admin/mobile/invitations',
    { preHandler: services.requireAdmin },
    async (req, reply) => {
      if (services.defaultPassword())
        return reply
          .code(403)
          .send({ error: 'Changez le mot de passe administrateur avant une association.' });
      if (!config.tlsKeyFingerprint)
        return reply.code(409).send({ error: 'Activez HTTPS pour associer un iPhone.' });
      let localUrl = '';
      try {
        const url = new URL(
          req.body?.localUrl ??
            `https://${localAddresses()[0] ?? machineHostnames()[0] ?? 'localhost'}:${config.httpsPort ?? 3443}`,
        );
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== '/'
        )
          throw new Error();
        // Administrator explicitly chooses the advertised address (Docker host, not container IP).
        localUrl = url.origin;
      } catch {
        return reply.code(400).send({ error: 'Adresse HTTPS locale invalide.' });
      }
      const invitation: MobileInvitation = {
        ...info(),
        protocol: 1,
        keyFingerprint: config.tlsKeyFingerprint,
        endpoints: [{ url: localUrl, trust: 'pinned' }, ...remoteEndpoint()],
        ...store.invite(),
      };
      const link =
        'cornelius://pair?data=' + Buffer.from(JSON.stringify(invitation)).toString('base64url');
      const qr = createRequire(import.meta.url)('qrcode') as {
        toString(
          value: string,
          options: { type: string; errorCorrectionLevel: string },
        ): Promise<string>;
      };
      return {
        invitation,
        link,
        svg: await qr.toString(link, { type: 'svg', errorCorrectionLevel: 'L' }),
      };
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/admin/mobile/devices/:id',
    { preHandler: services.requireAdmin },
    async (req) => {
      const removed = store.remove(req.params.id);
      if (owner?.deviceId === req.params.id) {
        owner.socket.close(1008, 'Appareil révoqué.');
        release();
      }
      for (const socket of sockets) {
        // All ancillary streams are closed on any revocation; valid devices reconnect with fresh authorization.
        socket.close(1008, 'Autorisations actualisées.');
      }
      return { removed };
    },
  );
  app.post<{ Body: { invitation?: unknown; name?: unknown } }>(
    '/mobile/pair',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (req, reply) => {
      if (typeof req.body?.invitation !== 'string' || typeof req.body?.name !== 'string')
        return reply.code(400).send({ error: 'Invitation invalide.' });
      const credential = store.pair(req.body.invitation, req.body.name);
      return credential ?? reply.code(403).send({ error: 'Invitation expirée ou déjà utilisée.' });
    },
  );
  app.get('/mobile/info', { preHandler: auth }, async () => info());
  app.get<{ Params: { id: string } }>(
    '/mobile/images/:id.webp',
    { preHandler: auth },
    async (req, reply) => {
      // A URL alone never grants access to a previous person's generated image.
      const card = controller
        .snapshot()
        .state.cards.find(
          (card) =>
            card.content.cardType === 'image' &&
            card.content.imageUrl.endsWith('/' + req.params.id + '.webp') &&
            card.expiresAt > now() &&
            (!card.profileId || card.profileId === controller.snapshot().state.activeProfile?.id),
        );
      const path = card ? services.image(req.params.id) : null;
      if (!path) return reply.code(404).send({ error: 'Image indisponible.' });
      return reply.type('image/webp').send(readFileSync(path));
    },
  );
  app.get('/mobile/events', { websocket: true, preValidation: auth }, (socket, req) => {
    const device = store.authenticate(token(req))!;
    track(socket);
    release();
    const generation = randomUUID();
    owner = { socket, deviceId: device.id, generation, audio: null, camera: null, preroll: [] };
    socket.send(JSON.stringify({ type: 'mobile', generation, ...info() }));
    services.claim(socket, device.id);
    controller.setMobileMirror({ deviceId: device.id, generation, background: false });
    perception.setMobileSource(generation);
    const current = () =>
      owner?.socket === socket && services.current(socket) && !!store.authenticate(token(req));
    perception.startWakeStream(generation, (score) =>
      services.wakeArbiter.detected({
        score,
        accept: () =>
          current() && !controller.mobileMirror()?.background && controller.wakeDetected(),
      }),
    );
    captureEnabled = perception.mobileCameraEnabled();
    socket.send(JSON.stringify({ type: 'capture', enabled: captureEnabled }));
    socket.send(JSON.stringify(controller.snapshot()));
    socket.on('pong', () => {
      if (current()) controller.heartbeat();
    });
    let lastSnapshot = 0;
    socket.on('message', (data, binary) => {
      if (!current()) return socket.close(1008, 'Afficher ici pour reprendre le miroir.');
      if (binary || Buffer.byteLength(data.toString()) > 4096)
        return socket.close(1008, 'Commande invalide.');
      try {
        const value = JSON.parse(data.toString());
        if (value.type === 'heartbeat') {
          controller.heartbeat();
          // Presence timestamps are intentionally omitted from broadcast change detection.
          // Refresh the native snapshot without inventing new observations or sequences.
          if (now() - lastSnapshot >= 500) {
            lastSnapshot = now();
            socket.send(JSON.stringify(controller.snapshot()));
          }
        } else if (value.type === 'media_ready' && typeof value.ready === 'boolean')
          controller.setBrowserAudioReady(value.ready && !!owner?.audio);
        else if (value.type === 'background' && typeof value.enabled === 'boolean') {
          controller.setMobileBackground(value.enabled);
          perception.syncCamera();
        } else if (validateMirrorCommand(value)) controller.command(value);
        else return socket.close(1008, 'Commande invalide.');
      } catch {
        socket.close(1008, 'Commande invalide.');
      }
    });
    socket.on('close', () => {
      if (owner?.socket === socket) release();
      services.gone(socket);
    });
  });
  for (const channel of ['audio', 'camera'] as const)
    app.get<{ Querystring: { generation?: string } }>(
      '/mobile/' + channel,
      { websocket: true, preValidation: auth },
      (socket, req) => {
        track(socket);
        const active = owner;
        if (
          !active ||
          active.deviceId !== store.authenticate(token(req))?.id ||
          active.generation !== req.query.generation
        )
          return socket.close(1008, 'Miroir inactif.');
        if (channel === 'audio') {
          active.audio?.close(1008, 'Audio remplacé.');
          active.audio = socket;
        } else {
          active.camera?.close(1008, 'Caméra remplacée.');
          active.camera = socket;
        }
        let vad = Buffer.alloc(0),
          interaction: string | null = null,
          frameAt = 0;
        socket.on('message', (data, binary) => {
          if (
            owner !== active ||
            !services.current(active.socket) ||
            !store.authenticate(token(req))
          )
            return socket.close(1008, 'Miroir inactif.');
          if (!binary) return socket.close(1008, 'Trame binaire attendue.');
          const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (channel === 'camera') {
            if (active.camera !== socket) return socket.close(1008, 'Caméra remplacée.');
            if (controller.mobileMirror()?.background) return;
            if (
              frame.length > MOBILE_FRAME_MAX ||
              frame.length < 4 ||
              frame[0] !== 255 ||
              frame[1] !== 216
            )
              return socket.close(1008, 'Image invalide.');
            if (now() - frameAt < 180) return;
            frameAt = now();
            perception.mobileFrame(active.generation, frame);
          } else {
            if (active.audio !== socket) return socket.close(1008, 'Audio remplacé.');
            const end = frame.indexOf(10);
            if (end < 1 || end > 64 || frame.length - end - 1 !== 2560)
              return socket.close(1008, 'Son invalide.');
            const id = frame.subarray(0, end).toString(),
              pcm = frame.subarray(end + 1),
              scope = controller.scope();
            if (
              id === '-' &&
              controller.isWakeListening() &&
              !controller.mobileMirror()?.background
            ) {
              active.preroll.push(Buffer.from(pcm));
              if (active.preroll.length > 6) active.preroll.shift();
              perception.wakeAudio(active.generation, pcm);
            }
            if (id !== scope.interactionId) return;
            if (controller.sessionState().phase === 'connecting') {
              active.preroll.push(Buffer.from(pcm));
              if (active.preroll.length > 30) active.preroll.shift();
              return;
            }
            if (controller.sessionState().phase !== 'ready') {
              active.preroll = [];
              return;
            }
            for (const buffered of active.preroll.splice(0))
              live.mobileAudio(active.generation, buffered);
            live.mobileAudio(active.generation, pcm);
            if (interaction !== id) {
              vad = Buffer.alloc(0);
              interaction = id;
            }
            vad = Buffer.concat([vad, pcm]);
            while (vad.length >= 1024) {
              perception.audio(id, vad.subarray(0, 1024));
              vad = vad.subarray(1024);
            }
          }
        });
        socket.on('close', () => {
          if (channel === 'audio' && owner === active && active.audio === socket) {
            active.audio = null;
            controller.setBrowserAudioReady(false);
          }
        });
      },
    );
  live.attachMobileOutput((pcm) => {
    const socket = owner?.audio;
    if (socket?.readyState !== 1) return;
    if (socket.bufferedAmount > 64_000) return socket.close(1013, 'Lecture trop lente.');
    if (pcm) socket.send(pcm);
    else socket.send(JSON.stringify({ type: 'clear' }));
  });
  return {
    serverId: store.serverId,
    release,
    dispose() {
      unsubscribe();
      release();
      for (const socket of sockets) socket.close(1001, 'Arrêt du serveur.');
    },
  };
}
