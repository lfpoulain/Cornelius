import { isCardSettings } from '../shared/cards.js';
import { isLiveVoice } from '../shared/voices.js';
import { isOrbScale, ORB_SCALE_MAX, ORB_SCALE_MIN } from '../shared/display.js';
import { AdminPassword, newPasswordError } from './admin-password.js';
import { SecretStore, secretValueError } from './secrets.js';
import { TrustedDevices } from './trusted-devices.js';
import { allowedHostname, isLoopback, isPrivateAddress, localAddresses } from './network.js';
import { isOpening } from '../shared/opening.js';
import { duplicateNameMessage } from '../shared/profile-names.js';
import { isPresenceTimings } from '../shared/presence-timings.js';
import { isAdmissionSound } from '../shared/admission-sound.js';
import { GREETING_MODES, isSilenceClose, type GreetingMode } from '../shared/conversation.js';
import { DELEGATION_MODES, type DelegationMode } from '../shared/delegation.js';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DiagnosticLog } from './logs.js';
import { MemoryRepository } from './memory-store.js';
import { PersonalMemory, type MemoryExtractor } from './memory.js';
import { createMemoryExtractor } from './memory-extractor.js';
import { registerMemory } from './memory-api.js';
import { PersonalDataEraser } from './backups.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { compile } from '../shared/validation.js';
import { validateMirrorCommand } from '../shared/commands.js';
import type { MirrorCommand } from '../shared/types.js';
import {
  openDatabase,
  ProfileRepository,
  SessionPreferences,
  normalizeOpening,
  AddonRepository,
  ActionRepository,
  PersonalityRepository,
} from './storage.js';
import { SessionController } from './controller.js';
import { DEFAULT_ADMIN_PASSWORD, type AppConfig } from './config.js';
import { LiveTransport } from './live/transport.js';
import { createLiveGateway } from './live/gateway.js';
import { PerceptionBridge } from './perception.js';
import { ModelDownloads, type ModelLauncher } from './model-downloads.js';
import { VisionBridge } from './vision.js';
import { registerHardware } from './hardware.js';
import { WakeArbiter } from './wake-arbiter.js';
import { SatelliteStore } from './satellites-store.js';
import { SatelliteHub } from './satellites.js';
import { registerSatellites } from './satellites-api.js';
import { SatellitePairing } from './satellites-pairing.js';
import { AmbientModules } from './addons/ambient.js';
import { AddonRuntime, defaultTimeZone } from './addons/runtime.js';
import { loadAddons } from './addons/registry.js';
import { createHttpClient } from './addons/http.js';
import { ActionExecutor, actionSecrets } from './actions.js';
import { registerAddons } from './addons-api.js';
import { HomeAssistant } from './home-assistant.js';
import { HomeAssistantRepository } from './home-assistant-store.js';
import { registerHomeAssistant } from './home-assistant-api.js';
import { AgentRepository } from './agents-store.js';
import { HermesClient } from './hermes-client.js';
import { Agents } from './agents.js';
import { registerAgents } from './agents-api.js';
import { ImageGeneration } from './image-generation.js';
import { createOpenAIImageCreator, type OpenAIImageCreator } from './openai-images.js';
import {
  ImageGenerationRuntime,
  type ImageInstallerLauncher,
  type ImageWorkerLauncher,
} from './image-generation-runtime.js';
import {
  IMAGE_GENERATION_MODELS,
  IMAGE_GENERATION_PROVIDERS,
  OPENAI_IMAGE_MODELS,
  OPENAI_IMAGE_QUALITIES,
  type ImageGenerationModel,
  type ImageGenerationProvider,
  type OpenAIImageModel,
  type OpenAIImageQuality,
} from '../shared/types.js';

import { PERSONALITY_MAX_LENGTH, PERSONAL_CONTEXT_MAX_LENGTH } from '../shared/personality.js';
import { liveConfiguration } from './live/configuration.js';

import { registerMobile } from './mobile.js';
import { mobileIngress } from './mobile-ingress.js';

type Role = 'admin' | 'kiosk';
interface Login {
  password: string;
}
const loginSchema = compile<Login>({
  type: 'object',
  additionalProperties: false,
  required: ['password'],
  properties: {
    password: { type: 'string', minLength: 1, maxLength: 256 },
  },
});
const profileName = {
  type: 'string',
  minLength: 1,
  maxLength: 80,
  pattern: '^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$',
};
/** Création : la mémoire est autorisée par défaut, comme avant ce réglage. */
const newProfileSchema = compile<{ name: string; memoryEnabled?: boolean }>({
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: profileName, memoryEnabled: { type: 'boolean' } },
});
const nameSchema = compile<{ name: string }>({
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: profileName,
  },
});
function equalSecret(input: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(input).digest(),
    createHash('sha256').update(expected).digest(),
  );
}

export async function createApp(
  config: AppConfig,
  options: {
    timers?: boolean;
    now?: () => number;
    modelLauncher?: ModelLauncher;
    imageInstallerLauncher?: ImageInstallerLauncher;
    imageWorkerLauncher?: ImageWorkerLauncher;
    imageGenerationRoot?: string;
    memoryExtractor?: MemoryExtractor;
    /** Crée les images OpenAI (remplacé dans les tests, sans appel réseau). */
    openaiImageCreator?: (apiKey: string) => OpenAIImageCreator;
    /** Relance le serveur (fourni par server/index.ts ; absent des tests). */
    restart?: () => void;
  } = {},
) {
  const now = options.now ?? Date.now;
  const imageGenerationToken = config.imageGenerationToken || randomBytes(32).toString('base64url');
  const logs = new DiagnosticLog({
    file:
      config.databasePath === ':memory:'
        ? undefined
        : join(dirname(config.databasePath), 'logs', 'cornelius.log'),
    console: options.timers !== false,
    secrets: [
      config.openaiKey ?? '',
      config.adminPassword,
      config.perceptionToken ?? '',
      imageGenerationToken,
      config.meteoConceptToken ?? '',
      config.primApiKey ?? '',
    ],
  });
  logs.write('info', 'local', 'Démarrage du serveur');
  let db;
  try {
    db = openDatabase(config.databasePath);
  } catch (error) {
    logs.write('error', 'local', 'Ouverture de SQLite impossible', { error });
    throw error;
  }
  const profiles = new ProfileRepository(db);
  const trustedDevices = new TrustedDevices(db, now);
  const adminPassword = new AdminPassword(db, config.adminPassword, DEFAULT_ADMIN_PASSWORD, now);
  const defaultPassword = () => adminPassword.isDefault();
  if (defaultPassword())
    logs.write('warn', 'local', 'Mot de passe administrateur par défaut', {
      conseil: 'Le changer dans l’administration, Mise en route.',
    });
  // Clé OpenAI et jetons des modules : saisis dans l’administration, sinon lus dans .env.
  const envSecrets: Record<string, string | undefined> = {
    OPENAI_API_KEY: config.openaiKey,
    CORNELIUS_METEO_CONCEPT_TOKEN: config.meteoConceptToken,
    CORNELIUS_PRIM_API_KEY: config.primApiKey,
  };
  const secretStore = new SecretStore(
    db,
    (name) => (name in envSecrets ? envSecrets[name] : process.env[name]),
    now,
  );
  for (const value of secretStore.values()) logs.addSecret(value);
  const openaiKey = () => secretStore.get('OPENAI_API_KEY');
  const eraser = new PersonalDataEraser(db, config.databasePath, logs);
  const preferences = new SessionPreferences(db);
  normalizeOpening(preferences);
  const personality = new PersonalityRepository(db);
  const addonInstances = new AddonRepository(db);
  const actionRepository = new ActionRepository(db);
  const http = createHttpClient();
  const { addons, rejected } = await loadAddons({ logs, externalRoot: config.modulesDir ?? null });
  if (rejected.length > 0)
    logs.write('warn', 'addon', 'Modules ignorés au démarrage', {
      rejected: rejected.map((item) => item.name),
    });
  // Jetons déclarés par les modules : nom lu par le module, variable de .env, module.
  // Les secrets du cœur ne sont jamais prêtés à un module.
  const reservedSecrets = new Set([
    'OPENAI_API_KEY',
    'CORNELIUS_ADMIN_PASSWORD',
    'CORNELIUS_PERCEPTION_TOKEN',
    'CORNELIUS_IMAGE_GENERATION_TOKEN',
  ]);
  const addonSecrets = new Map(
    addons.flatMap((addon) =>
      (addon.secrets ?? [])
        .filter((secret) => !reservedSecrets.has(secret.env))
        .map((secret) => [secret.name, { ...secret, addon }] as const),
    ),
  );
  const addonSecret = (name: string) => {
    const secret = addonSecrets.get(name);
    return secret ? secretStore.get(secret.env) : undefined;
  };
  // Fuseau du foyer donné aux modules ; un nom inconnu retombe sur celui de Paris.
  let timeZone = config.timeZone ?? defaultTimeZone;
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone });
  } catch {
    logs.write('warn', 'addon', 'Fuseau horaire inconnu, Europe/Paris utilisé', { timeZone });
    timeZone = defaultTimeZone;
  }
  const addonRuntime = new AddonRuntime({
    addons,
    instances: addonInstances,
    http,
    logs,
    now,
    secretSource: addonSecret,
    timeZone,
  });
  const actionExecutor = new ActionExecutor(actionRepository, http, logs, Date.now, () =>
    actionSecrets(
      Object.fromEntries([...addonSecrets.keys()].map((name) => [name, addonSecret(name)])),
      process.env,
    ),
  );
  const homeAssistant = new HomeAssistant(new HomeAssistantRepository(db), http, logs);
  homeAssistant.start();
  const imageGeneration = new ImageGeneration(
    db,
    true,
    () => broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true),
    logs,
    now,
    // Une base en mémoire (tests) ne doit jamais purger les images du vrai miroir.
    config.databasePath === ':memory:'
      ? mkdtempSync(join(tmpdir(), 'cornelius-images-'))
      : resolve('data', 'generated-images'),
  );
  const agents = new Agents(new AgentRepository(db, now), new HermesClient(http, now), now);
  const initialKey = openaiKey();
  const makeImageCreator = options.openaiImageCreator ?? createOpenAIImageCreator;
  let openaiImageCreator = initialKey ? makeImageCreator(initialKey) : null;
  imageGeneration.useOpenAI({
    creator: () => openaiImageCreator,
    blocked: () => preferences.getOpenAIBlocked(),
  });
  const live = new LiveTransport(
    initialKey ? createLiveGateway(initialKey, logs) : null,
    () => preferences.getOpenAIBlocked(),
    logs,
    {
      addons: addonRuntime,
      actions: actionExecutor,
      homeAssistant,
      agents,
      imageGeneration,
      personality: (id) => personality.get(id),
    },
    now,
  );
  logs.write(
    !initialKey ? 'warn' : 'info',
    'openai',
    preferences.getOpenAIBlocked()
      ? 'Connexions OpenAI bloquées par l’administration'
      : initialKey
        ? 'Clé configurée ; connexion uniquement au démarrage d’une session'
        : 'Clé OpenAI absente',
  );
  const controller = new SessionController(profiles, live, now, preferences, (name, details) =>
    logs.write('info', 'mesure', name, details),
  );
  controller.setSetup({ openaiKey: !!initialKey });
  imageGeneration.onActivity((activity) => controller.setImageActivity(activity));
  const ambient = new AmbientModules(
    addonRuntime,
    () => controller.snapshot().state,
    () => controller.publish(),
    now,
  );
  controller.setAmbientProjection((state) => ambient.view(state));
  controller.setBrowserAudioReady(false);
  live.attach(controller);
  agents.onCapabilitiesChanged = (profileId) => live.refreshAgentTools(profileId);
  agents.onConnectionChanged = (profileId) => controller.agentsChanged(profileId);
  homeAssistant.onAliasesChanged = () => controller.homeAssistantChanged();
  const memory = new PersonalMemory(
    new MemoryRepository(db, now),
    controller,
    options.memoryExtractor ?? (initialKey ? createMemoryExtractor(initialKey) : null),
    now,
    logs,
  );
  live.attachMemory(memory);
  secretStore.onChange((name) => {
    const value = secretStore.get(name);
    logs.addSecret(value);
    if (name === 'OPENAI_API_KEY') {
      live.setGateway(value ? createLiveGateway(value, logs) : null);
      openaiImageCreator = value ? makeImageCreator(value) : null;
      if (!options.memoryExtractor)
        memory.setExtractor(value ? createMemoryExtractor(value) : null);
      controller.setSetup({ openaiKey: !!value });
    }
    logs.write('info', 'local', value ? 'Clé enregistrée' : 'Clé retirée', {
      name,
      source: secretStore.source(name),
    });
    broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true);
  });
  let lastDeviceLog = '';
  let imageGenerationRuntime!: ImageGenerationRuntime;
  const perception = new PerceptionBridge(
    db,
    controller,
    () => {
      const status = devices();
      const details = {
        connected: status.perception.connected,
        diagnostic: status.perception.diagnostic,
        cameraError: status.perception.camera.error,
      };
      const signature = JSON.stringify(details);
      if (signature !== lastDeviceLog) {
        lastDeviceLog = signature;
        logs.write(
          details.diagnostic || details.cameraError || !details.connected ? 'warn' : 'info',
          'perception',
          'État des périphériques locaux',
          details,
        );
      }
      broadcast({ schemaVersion: 1, type: 'devices', status }, true);
    },
    now,
  );
  // Miroir et satellites entendent parfois le même « Cornelius » : le meilleur score l’emporte.
  const wakeArbiter = new WakeArbiter(() => perception.wakeStreamCount());
  const satelliteStore = new SatelliteStore(db, now);
  const satellites = new SatelliteHub({
    store: satelliteStore,
    perception,
    arbiter: wakeArbiter,
    controller,
    logs,
    live,
    heartbeat: options.timers !== false,
  });
  live.attachSatelliteOutput((satelliteId, pcm) => satellites.play(satelliteId, pcm));
  const devices = () => {
    const local = perception.snapshot();
    return {
      presenceTimings: controller.getPresenceTimings(),
      apiConfigured: !!openaiKey(),
      perceptionConfigured: !!config.perceptionToken,
      defaultPassword: defaultPassword(),
      enrolledFaces: local.enrolledProfileIds.length,
      network: config.lan
        ? {
            lan: true,
            urls: localAddresses().map((address) => `https://${address}:${config.httpsPort}`),
            fingerprint: config.tlsFingerprint ?? null,
            keyFingerprint: config.tlsKeyFingerprint ?? null,
            trustedDevices: trustedDevices.count(),
          }
        : { lan: false, urls: [], fingerprint: null, trustedDevices: 0 },
      imageGeneration: {
        ...imageGeneration.snapshot(),
        installations: imageGenerationRuntime?.snapshot() ?? undefined,
      },
      perception: {
        ...local,
        vision: { ...vision.snapshot(), downloads: downloads.snapshot() },
      },
    };
  };
  const vision = new VisionBridge(
    db,
    controller,
    () => {
      broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true);
    },
    now,
    undefined,
    (name, details) =>
      logs.write(name === 'vision_echec' ? 'warn' : 'info', 'mesure', name, details),
  );
  const downloads = new ModelDownloads(
    () => broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true),
    (model) => vision.modelInstalled(model),
    undefined,
    options.modelLauncher,
  );
  imageGenerationRuntime = new ImageGenerationRuntime(
    imageGeneration,
    () => broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true),
    imageGenerationToken,
    config.origins[0] ?? 'http://127.0.0.1:3000',
    options.imageGenerationRoot,
    options.imageInstallerLauncher,
    options.imageWorkerLauncher,
  );
  perception.useVision(vision);
  live.attachVision(vision);
  vision.attachAppender(live);
  // Mode voix : avec la reconnaissance, caméra allumée en permanence pour reconnaître la
  // personne dès « Cornelius » ; avec la seule vision locale, allumée pendant la conversation ;
  // sinon éteinte. Modes caméra : toujours allumée.
  perception.setCameraPolicy(() => {
    if (controller.mobileMirror()?.background) return false;
    const session = controller.sessionState();
    if (session.mode !== 4 || controller.isVoiceRecognitionEnabled()) return true;
    if (!vision.isEnabled()) return false;
    // Une conversation de satellite se tient dans une autre pièce : la caméra n’a rien à voir.
    return ['connecting', 'ready'].includes(session.phase) && !session.satellite;
  });
  const app = Fastify({ logger: false, bodyLimit: 16_384, requestTimeout: 10_000 });
  // Sessions administrateur en mémoire (un redémarrage les ferme), avec une expiration
  // glissante : chaque requête authentifiée repousse la fin d’une heure. La table reste rangée
  // de la moins récemment utilisée à la plus récente : au-delà de maxAdminSessions, une
  // nouvelle connexion ferme la plus ancienne au lieu de refuser le bon mot de passe.
  const adminSessionSeconds = 3600;
  const maxAdminSessions = 64;
  const sessions = new Map<string, number>();
  const clients = new Map<
    WebSocket,
    { role: Role; sessionId: string | null; kioskId: string | null; remote: boolean }
  >();
  let kiosk: { socket: WebSocket; kioskId: string } | null = null;
  // Page du miroir qui a déclaré son média, pour distinguer une reconnexion d’un rechargement.
  let kioskPage: string | null = null;
  const cookieName = (role: Role) => `cornelius_${role}`;
  const adminCookie = cookieName('admin');
  const kioskCookie = cookieName('kiosk');

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 256_000 } });

  function purgeSessions() {
    for (const [id, expiresAt] of sessions) if (expiresAt <= now()) sessions.delete(id);
  }

  function adminIdentity(request: FastifyRequest): string | null {
    const id = request.cookies[adminCookie];
    const expiresAt = id ? sessions.get(id) : undefined;
    if (!id || expiresAt === undefined || expiresAt <= now()) return null;
    return id;
  }

  /** Ouvre ou prolonge une session : une heure à partir de maintenant, côté serveur et cookie. */
  function extendAdminSession(id: string, request: FastifyRequest, reply: FastifyReply) {
    // Retirer puis remettre la place en fin de table : elle devient la plus récente.
    sessions.delete(id);
    sessions.set(id, now() + adminSessionSeconds * 1000);
    // La réponse d’ouverture d’un WebSocket ne transporte pas d’en-têtes : seul le serveur
    // prolonge alors la session.
    if (request.ws) return;
    reply.setCookie(adminCookie, id, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies || request.protocol === 'https',
      maxAge: adminSessionSeconds,
    });
  }

  /** Ferme une session et les pages d’administration qui l’utilisent encore. */
  function closeAdminSession(id: string) {
    sessions.delete(id);
    for (const [socket, client] of clients)
      if (client.sessionId === id) socket.close(1008, 'Déconnexion');
  }

  // Le miroir est public sur le poste : ce cookie n’est qu’un identifiant de corrélation.
  function kioskIdentity(request: FastifyRequest, reply?: FastifyReply): string {
    const existing = request.cookies[kioskCookie];
    if (existing) return existing;
    const id = randomBytes(16).toString('base64url');
    reply?.setCookie(kioskCookie, id, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies || request.protocol === 'https',
      maxAge: 365 * 24 * 3600,
    });
    return id;
  }

  function clientActive(client: { role: Role; sessionId: string | null }): boolean {
    if (client.role === 'kiosk') return true;
    const expiresAt = client.sessionId ? sessions.get(client.sessionId) : undefined;
    return expiresAt !== undefined && expiresAt > now();
  }

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const id = adminIdentity(request);
    if (id) return extendAdminSession(id, request, reply);
    await reply.code(401).send({ error: 'Connexion administrateur requise.' });
  };

  /**
   * La requête vient de l'ordinateur lui-même. Une requête sans socket ne vient pas du réseau :
   * elle est injectée dans le processus (tests, WebSocket simulés).
   */
  function fromMachine(request: FastifyRequest): boolean {
    const socket = request.raw.socket as { remoteAddress?: string } | undefined;
    return !socket || isLoopback(socket.remoteAddress);
  }
  const lanPairingMessage =
    'Appareil non autorisé : connectez-vous une fois avec le mot de passe administrateur pour en faire un miroir.';
  /** Pages, fichiers de l'interface et connexion : servis à tout appareil du réseau local. */
  function lanPublic(url: string): boolean {
    const path = url.split('?')[0]!;
    if (['/api/health', '/api/auth', '/api/login', '/api/logout'].includes(path)) return true;
    return !(
      path.startsWith('/api/') ||
      path.startsWith('/events') ||
      path.startsWith('/audio') ||
      path.startsWith('/wake-audio')
    );
  }
  function lanAuthorized(request: FastifyRequest): boolean {
    return !!adminIdentity(request) || trustedDevices.has(request.cookies[kioskCookie]);
  }

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    // The dedicated proxy listener can route only /mobile/*; each route authenticates independently.
    if (mobileIngress.has(request.raw)) return;
    // Clients : la machine elle-même, et le réseau local quand il est ouvert. Une adresse
    // publique (port redirigé par un routeur) est toujours refusée.
    const lan = config.lan === true;
    if (!fromMachine(request) && !(lan && isPrivateAddress(request.raw.socket?.remoteAddress)))
      return reply.code(403).send({ error: 'Accès réservé au réseau local.' });
    if (!allowedHostname(request.hostname, lan, config.allowedHosts ?? []))
      return reply.code(403).send({ error: 'Hôte non autorisé.' });
    // La perception et le générateur d'images tournent sur la machine : jamais par le réseau.
    if (
      (request.url.startsWith('/perception') || request.url.startsWith('/image-generation')) &&
      !fromMachine(request)
    )
      return reply.code(403).send({ error: 'Réservé à cet ordinateur.' });
    if (request.url.startsWith('/mobile/')) return;
    // Le miroir n'a pas de mot de passe sur la machine. Depuis un autre appareil, ses données
    // (état, son, événements) demandent une session d'administration ou un appareil autorisé.
    if (!fromMachine(request) && !lanPublic(request.url) && !lanAuthorized(request))
      return reply.code(401).send({ error: lanPairingMessage });
    const origin = request.headers.origin;
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    // Même origine que la page (miroir ou administration ouverts depuis un autre appareil).
    const sameOrigin = origin === `${request.protocol}://${request.host}`;
    if (
      (origin && !config.origins.includes(origin) && !sameOrigin) ||
      ((mutation ||
        request.url.startsWith('/events') ||
        request.url.startsWith('/perception') ||
        request.url.startsWith('/audio') ||
        request.url.startsWith('/wake-audio')) &&
        !origin)
    ) {
      return reply.code(403).send({ error: 'Origine non autorisée.' });
    }
  });

  const mobile = registerMobile(app, {
    db, now, config, controller, perception, live, wakeArbiter, requireAdmin, defaultPassword,
    image: (id) => imageGeneration.generatedFile(id),
    claim: (socket, deviceId) => {
      if (kiosk?.socket !== socket) kiosk?.socket.close(1008, 'Miroir affiché sur un autre appareil.');
      kiosk = { socket, kioskId: 'mobile:' + deviceId };
      clients.set(socket, { role: 'kiosk', sessionId: null, kioskId: kiosk.kioskId, remote: true });
      controller.heartbeat();
    },
    current: (socket) => kiosk?.socket === socket,
    gone: (socket) => { clients.delete(socket); if (kiosk?.socket === socket) kiosk = null; },
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/assets/') && reply.statusCode === 200)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    logs.write('error', 'local', 'Erreur de traitement HTTP', {
      requestId: _request.id,
      route: _request.routeOptions.url,
      error,
    });
    const statusCode = (error as { statusCode?: number }).statusCode;
    const status = statusCode && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    reply.code(status).send({ error: status === 500 ? 'Erreur interne.' : 'Requête invalide.' });
  });

  app.get(
    '/image-generation',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const allowed = equalSecret(
          String(request.headers.authorization ?? ''),
          'Bearer ' + imageGenerationToken,
        );
        if (!allowed) return reply.code(403).send({ error: 'Générateur non autorisé.' });
      },
    },
    (socket) => imageGeneration.connect(socket),
  );

  app.get<{ Params: { id: string } }>('/api/generated-images/:id.webp', async (request, reply) => {
    const file = imageGeneration.generatedFile(request.params.id);
    if (!file) return reply.code(404).send({ error: 'Image introuvable.' });
    return reply
      .type('image/webp')
      .header('Cache-Control', 'private, max-age=300')
      .send(readFileSync(file));
  });

  registerHardware(app, {
    logs,
    live,
    controller,
    perception,
    wakeArbiter,
    vision,
    downloads,
    authorize: (role) => (role === 'admin' ? requireAdmin : async () => {}),
    devices,
    currentKiosk: (req) =>
      !!kiosk && !!req.cookies[kioskCookie] && kiosk.kioskId === req.cookies[kioskCookie],
    workerAuthorized: (req) =>
      !!config.perceptionToken &&
      equalSecret(String(req.headers.authorization ?? ''), 'Bearer ' + config.perceptionToken),
    faceForgotten: (profileId) => eraser.faceForgotten(profileId),
  });

  registerHomeAssistant(app, homeAssistant, requireAdmin, () => controller.homeAssistantChanged());
  registerAgents(app, agents, requireAdmin);
  const satellitePairing = new SatellitePairing(logs, now);
  registerSatellites(app, {
    store: satelliteStore,
    hub: satellites,
    pairing: satellitePairing,
    profiles,
    requireAdmin,
  });
  registerAddons(app, {
    runtime: addonRuntime,
    actions: actionExecutor,
    instances: addonInstances,
    actionRepository,
    profiles,
    logs,
    rejectedAddons: rejected,
    requireAdmin,
    onChanged: () => {
      ambient.tick();
      controller.publish();
    },
  });

  const imageGenerationSettings = compile<{
    enabled?: boolean;
    preload?: boolean;
    model?: ImageGenerationModel;
    sanaSteps?: 2 | 4;
    illustrateCards?: boolean;
    provider?: ImageGenerationProvider;
    openaiModel?: OpenAIImageModel;
    openaiQuality?: OpenAIImageQuality;
  }>({
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      enabled: { type: 'boolean' },
      preload: { type: 'boolean' },
      model: { enum: [...IMAGE_GENERATION_MODELS] },
      sanaSteps: { enum: [2, 4] },
      illustrateCards: { type: 'boolean' },
      provider: { enum: [...IMAGE_GENERATION_PROVIDERS] },
      openaiModel: { enum: [...OPENAI_IMAGE_MODELS] },
      openaiQuality: { enum: [...OPENAI_IMAGE_QUALITIES] },
    },
  });
  app.patch('/api/admin/image-generation', { preHandler: requireAdmin }, async (request, reply) => {
    if (!imageGenerationSettings(request.body))
      return reply.code(400).send({ error: 'Réglage de génération invalide.' });
    try {
      const enabledChanged =
        request.body.enabled !== undefined &&
        request.body.enabled !== imageGeneration.snapshot().enabled;
      // La description de l’outil change avec le moteur : la conversation en cours est relancée.
      const providerChanged =
        request.body.provider !== undefined &&
        request.body.provider !== imageGeneration.snapshot().provider &&
        imageGeneration.snapshot().enabled;
      if (request.body.provider !== undefined) imageGeneration.setProvider(request.body.provider);
      if (request.body.openaiModel !== undefined)
        imageGeneration.setOpenAIModel(request.body.openaiModel);
      if (request.body.openaiQuality !== undefined)
        imageGeneration.setOpenAIQuality(request.body.openaiQuality);
      if (request.body.model !== undefined) imageGeneration.setModel(request.body.model);
      if (request.body.sanaSteps !== undefined)
        imageGeneration.setSanaSteps(request.body.sanaSteps);
      if (request.body.illustrateCards !== undefined)
        imageGeneration.setIllustrateCards(request.body.illustrateCards);
      if (request.body.preload !== undefined) imageGeneration.setPreload(request.body.preload);
      if (request.body.enabled !== undefined) imageGeneration.setEnabled(request.body.enabled);
      imageGenerationRuntime.sync(request.body.model !== undefined);
      if (enabledChanged || providerChanged)
        controller.restart('Réglage de génération d’image modifié.');
      return {
        ...imageGeneration.snapshot(),
        installations: imageGenerationRuntime.snapshot(),
      };
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  });
  app.post(
    '/api/admin/image-generation/install',
    { preHandler: requireAdmin },
    async (_request, reply) => {
      try {
        imageGenerationRuntime.ensure(imageGeneration.snapshot().model);
        return {
          ...imageGeneration.snapshot(),
          installations: imageGenerationRuntime.snapshot(),
        };
      } catch (error) {
        return reply.code(409).send({ error: (error as Error).message });
      }
    },
  );

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'route inconnue';
    if (reply.statusCode < 400 && (request.method === 'GET' || route === '/api/client-logs'))
      return;
    logs.write(
      reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info',
      'http',
      'Requête locale terminée',
      {
        requestId: request.id,
        method: request.method,
        route,
        // Adresse introuvable : le chemin demandé, sans ses paramètres, dit quel lien ou quel
        // fichier manque.
        ...(reply.statusCode === 404 ? { url: request.url.split('?')[0]!.slice(0, 300) } : {}),
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
    );
  });
  app.get('/api/admin/logs', { preHandler: requireAdmin }, async () => logs.snapshot());
  type ClientLog = {
    event: string;
    stage: string;
    name?: string;
    message?: string;
    interactionId?: string;
  };
  const clientLogEntry = {
    type: 'object',
    additionalProperties: false,
    required: ['event', 'stage'],
    properties: Object.fromEntries(
      ['event', 'stage', 'name', 'message', 'interactionId'].map((key) => [
        key,
        { type: 'string', maxLength: 500 },
      ]),
    ),
  };
  // Le navigateur regroupe ses mesures : une ouverture de session n’épuise plus la limite.
  const clientLogSchema = compile<ClientLog | { entries: ClientLog[] }>({
    oneOf: [
      clientLogEntry,
      {
        type: 'object',
        additionalProperties: false,
        required: ['entries'],
        properties: {
          entries: { type: 'array', minItems: 1, maxItems: 50, items: clientLogEntry },
        },
      },
    ],
  });
  app.post(
    '/api/client-logs',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!clientLogSchema(request.body))
        return reply.code(400).send({ error: 'Diagnostic invalide.' });
      for (const entry of 'entries' in request.body ? request.body.entries : [request.body])
        logs.write(
          entry.event === 'error' ? 'error' : 'info',
          'navigateur',
          'Diagnostic navigateur',
          { ...entry },
        );
      return { ok: true };
    },
  );
  app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));
  app.get<{ Querystring: { role?: string } }>('/api/auth', async (request, reply) => {
    if (request.query.role === 'admin') {
      const id = adminIdentity(request);
      if (id) extendAdminSession(id, request, reply);
      return { role: id ? ('admin' as const) : null };
    }
    const kioskId = kioskIdentity(request, reply);
    if (!fromMachine(request) && !adminIdentity(request) && !trustedDevices.has(kioskId))
      return { role: null };
    return { role: 'kiosk' as const };
  });
  app.post(
    '/api/login',
    { config: { rateLimit: { max: config.loginRateLimit ?? 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!loginSchema(request.body))
        return reply.code(400).send({ error: 'Mot de passe invalide.' });
      if (!adminPassword.verify(request.body.password)) {
        return reply.code(401).send({ error: 'Mot de passe incorrect.' });
      }
      // Depuis un autre appareil, le mot de passe par défaut serait devinable par quiconque
      // sur le réseau : il faut d'abord le changer, sur la machine elle-même.
      if (defaultPassword() && !fromMachine(request))
        return reply.code(403).send({
          error:
            'Mot de passe par défaut : changez-le d’abord dans l’administration, sur l’ordinateur du miroir (Mise en route).',
        });
      purgeSessions();
      const existing = request.cookies[adminCookie];
      if (existing) sessions.delete(existing);
      // Navigateurs oubliés, fenêtres privées : la session la moins récemment utilisée laisse
      // sa place, plutôt que de bloquer l’administration jusqu’à leur expiration.
      while (sessions.size >= maxAdminSessions) {
        const oldest = sessions.keys().next().value!;
        closeAdminSession(oldest);
        logs.write('info', 'local', 'Session administrateur la plus ancienne fermée', {
          limit: maxAdminSessions,
        });
      }
      extendAdminSession(randomBytes(32).toString('base64url'), request, reply);
      const kioskId = kioskIdentity(request, reply);
      // Se connecter depuis un autre appareil l'autorise aussi comme miroir.
      if (!fromMachine(request)) trustedDevices.add(kioskId);
      return { role: 'admin' as const };
    },
  );
  app.post<{ Body: { current?: unknown; next?: unknown } }>(
    '/api/admin/password',
    {
      preHandler: requireAdmin,
      config: { rateLimit: { max: config.loginRateLimit ?? 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { current, next } = request.body ?? {};
      if (typeof current !== 'string' || !adminPassword.verify(current))
        return reply.code(403).send({ error: 'Mot de passe actuel incorrect.' });
      const error = newPasswordError(next, DEFAULT_ADMIN_PASSWORD);
      if (error) return reply.code(400).send({ error });
      adminPassword.set(next as string);
      logs.addSecret(next as string);
      // Les autres navigateurs connectés doivent se reconnecter avec le nouveau mot de passe.
      const keep = adminIdentity(request);
      for (const id of [...sessions.keys()]) if (id !== keep) closeAdminSession(id);
      logs.write('info', 'local', 'Mot de passe administrateur changé');
      broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true);
      return { ok: true, source: adminPassword.source() };
    },
  );
  app.post('/api/admin/restart', { preHandler: requireAdmin }, async (_request, reply) => {
    if (!options.restart)
      return reply.code(503).send({ error: 'Redémarrage indisponible pour ce serveur.' });
    logs.write('info', 'local', 'Redémarrage demandé depuis l’administration');
    // Laisser partir la réponse avant de fermer les connexions.
    setTimeout(options.restart, 300).unref?.();
    return { ok: true };
  });
  /** Clés connues : OpenAI, puis les jetons des modules. Jamais leur valeur. */
  function secretViews() {
    const describe = (env: string) => ({
      env,
      configured: !!secretStore.get(env),
      source: secretStore.source(env),
      hint: secretStore.hint(env),
    });
    return [
      {
        ...describe('OPENAI_API_KEY'),
        label: 'Clé OpenAI',
        usedBy: 'Conversation et mémoire',
        url: 'https://platform.openai.com/api-keys',
        note: null,
      },
      ...[
        ...new Map([...addonSecrets.values()].map((secret) => [secret.env, secret])).values(),
      ].map((secret) => ({
        ...describe(secret.env),
        label: secret.label.replace(/^(un|une)\s+/u, '').replace(/^./u, (c) => c.toUpperCase()),
        usedBy: secret.addon.sourceLabel,
        url: secret.url ?? null,
        note: secret.note ?? null,
      })),
    ];
  }
  const knownSecret = (env: string) => secretViews().some((secret) => secret.env === env);
  app.get('/api/admin/secrets', { preHandler: requireAdmin }, async () => ({
    secrets: secretViews(),
  }));
  app.put<{ Params: { env: string }; Body: { value?: unknown } }>(
    '/api/admin/secrets/:env',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!knownSecret(request.params.env)) return reply.code(404).send({ error: 'Clé inconnue.' });
      const error = secretValueError(request.body?.value);
      if (error) return reply.code(400).send({ error });
      secretStore.set(request.params.env, String(request.body!.value));
      return { secrets: secretViews() };
    },
  );
  app.delete<{ Params: { env: string } }>(
    '/api/admin/secrets/:env',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!knownSecret(request.params.env)) return reply.code(404).send({ error: 'Clé inconnue.' });
      secretStore.delete(request.params.env);
      return { secrets: secretViews() };
    },
  );
  // Retire l'autorisation de tous les appareils du réseau : chacun devra se reconnecter.
  app.delete('/api/admin/trusted-devices', { preHandler: requireAdmin }, async () => {
    trustedDevices.clear();
    for (const [socket, client] of clients)
      if (client.role === 'kiosk' && client.remote) socket.close(1008, lanPairingMessage);
    broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true);
    return { ok: true };
  });
  app.post('/api/logout', async (request, reply) => {
    const id = request.cookies[adminCookie];
    if (id) closeAdminSession(id);
    reply.clearCookie(adminCookie, { path: '/' });
    return { ok: true };
  });
  app.get('/api/state', async () => controller.snapshot());
  app.post<{ Body: MirrorCommand }>(
    '/api/commands',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!validateMirrorCommand(request.body))
        return reply.code(400).send({ error: 'Commande invalide.' });
      try {
        controller.command(request.body);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      return controller.snapshot();
    },
  );

  const personalitySchema = compile<{ instructions: string }>({
    type: 'object',
    additionalProperties: false,
    required: ['instructions'],
    properties: { instructions: { type: 'string', maxLength: PERSONALITY_MAX_LENGTH } },
  });
  const personalContextSchema = compile<{ context: string }>({
    type: 'object',
    additionalProperties: false,
    required: ['context'],
    properties: { context: { type: 'string', maxLength: PERSONAL_CONTEXT_MAX_LENGTH } },
  });
  const personalityView = (profileId: string | null) => {
    const preferences = personality.get(profileId);
    const tools = [
      ...addonRuntime.tools(profileId),
      ...actionExecutor.tools(profileId),
      ...homeAssistant.tools(profileId !== null),
      ...agents.tools(profileId),
      ...imageGeneration.tools(),
      ...vision.tools(),
      ...memory.tools(),
    ];
    const delegationMode = controller.snapshot().state.delegationMode;
    const features = {
      webSearch: controller.isWebSearchEnabled(),
      voice: controller.getSpeechVoice(),
    };
    const base = liveConfiguration(tools, undefined, delegationMode, features);
    const effective = liveConfiguration(tools, preferences, delegationMode, features);
    return {
      profileId,
      ...preferences,
      prompts: [
        { title: 'Sans vos préférences : conversation', content: base.instructions ?? '' },
        {
          title: 'Sans vos préférences : recherches et actions',
          content:
            base.delegation?.type === 'responses'
              ? (base.delegation.responses.instructions ?? '')
              : '',
        },
        {
          title: 'Avec vos préférences enregistrées : conversation',
          content: effective.instructions ?? '',
        },
        {
          title: 'Avec vos préférences enregistrées : recherches et actions',
          content:
            effective.delegation?.type === 'responses'
              ? (effective.delegation.responses.instructions ?? '')
              : '',
        },
      ],
    };
  };
  app.get<{ Params: { scope: string } }>(
    '/api/admin/personality/:scope',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = request.params.scope === 'household' ? null : request.params.scope;
      if (id !== null && !profiles.get(id))
        return reply.code(404).send({ error: 'Profil introuvable.' });
      return personalityView(id);
    },
  );
  app.put<{ Params: { scope: string } }>(
    '/api/admin/personality/:scope',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = request.params.scope === 'household' ? null : request.params.scope;
      if (id !== null && !profiles.get(id))
        return reply.code(404).send({ error: 'Profil introuvable.' });
      if (!personalitySchema(request.body))
        return reply.code(400).send({ error: 'Consignes invalides (4000 caractères maximum).' });
      const instructions = request.body.instructions.trim();
      const previous = personality.get(id);
      if (instructions !== (id === null ? previous.household : previous.personal)) {
        personality.set(id, instructions);
        controller.personalityChanged(id);
      }
      return personalityView(id);
    },
  );

  app.put<{ Params: { profileId: string } }>(
    '/api/admin/personality/:profileId/context',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = request.params.profileId;
      if (!profiles.get(id)) return reply.code(404).send({ error: 'Profil introuvable.' });
      if (!personalContextSchema(request.body))
        return reply.code(400).send({ error: 'Contexte invalide (4000 caractères maximum).' });
      const context = request.body.context.trim();
      if (context !== personality.get(id).personalContext) {
        personality.setContext(id, context);
        controller.personalContextChanged(id);
      }
      return personalityView(id);
    },
  );

  registerMemory(app, memory, controller, requireAdmin, eraser);
  app.get('/api/admin/profiles', { preHandler: requireAdmin }, async () => profiles.list());
  app.post('/api/admin/profiles', { preHandler: requireAdmin }, async (request, reply) => {
    if (!newProfileSchema(request.body))
      return reply.code(400).send({ error: 'Nom de profil invalide.' });
    if (profiles.list().length >= 32) return reply.code(400).send({ error: '32 profils maximum.' });
    const name = request.body.name.trim();
    const taken = profiles.sameName(name);
    if (taken) return reply.code(409).send({ error: duplicateNameMessage(taken.name, name) });
    const profile = profiles.create(name);
    if (request.body.memoryEnabled === false) {
      try {
        memory.repository.setEnabled(
          profile.id,
          false,
          memory.repository.policy(profile.id)!.version,
        );
      } catch (error) {
        // Sans le refus enregistré, le profil ne doit pas exister avec la mémoire active.
        profiles.delete(profile.id);
        throw error;
      }
    }
    controller.profilesChanged();
    perception.refreshProfiles();
    return reply.code(201).send(profile);
  });
  app.patch<{ Params: { id: string } }>(
    '/api/admin/profiles/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!nameSchema(request.body))
        return reply.code(400).send({ error: 'Nom de profil invalide.' });
      if (!profiles.get(request.params.id))
        return reply.code(404).send({ error: 'Profil introuvable.' });
      const name = request.body.name.trim();
      // Les doublons créés avant cette règle restent possibles ; seul un nouveau est refusé.
      const taken = profiles.sameName(name, request.params.id);
      if (taken) return reply.code(409).send({ error: duplicateNameMessage(taken.name, name) });
      const profile = profiles.rename(request.params.id, name);
      controller.profilesChanged();
      perception.refreshProfiles();
      return profile;
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/admin/profiles/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!profiles.get(request.params.id))
        return reply.code(404).send({ error: 'Profil introuvable.' });
      memory.invalidate(request.params.id);
      agents.invalidate(request.params.id);
      profiles.delete(request.params.id);
      // Visage, souvenirs, contexte et jetons du profil quittent aussi les copies de sécurité.
      eraser.profileDeleted(request.params.id);
      controller.profilesChanged();
      perception.refreshProfiles();
      return { ok: true };
    },
  );
  const openaiBlockSchema = compile<{ blocked: boolean }>({
    type: 'object',
    additionalProperties: false,
    required: ['blocked'],
    properties: { blocked: { type: 'boolean' } },
  });
  app.post('/api/admin/openai', { preHandler: requireAdmin }, async (request, reply) => {
    if (!openaiBlockSchema(request.body))
      return reply.code(400).send({ error: 'Blocage invalide.' });
    const wasBlocked = preferences.getOpenAIBlocked();
    preferences.setOpenAIBlocked(request.body.blocked);
    if (request.body.blocked) live.block();
    else if (wasBlocked) controller.resumeAutomatic();
    controller.publish();
    // La génération d’image par OpenAI suit le même blocage.
    broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true);
    return controller.snapshot();
  });
  const privacySchema = compile<{ enabled: boolean }>({
    type: 'object',
    additionalProperties: false,
    required: ['enabled'],
    properties: { enabled: { type: 'boolean' } },
  });
  app.patch('/api/admin/privacy', { preHandler: requireAdmin }, async (request, reply) => {
    if (!privacySchema(request.body))
      return reply.code(400).send({ error: 'Réglage de confidentialité invalide.' });
    controller.setPrivacyMode(request.body.enabled);
    return controller.snapshot();
  });
  app.patch('/api/admin/presence-timings', { preHandler: requireAdmin }, async (request, reply) => {
    if (!isPresenceTimings(request.body))
      return reply.code(400).send({
        error:
          'Délais invalides : présence et regard de 0 à 5 s, départ de 0 à 30 s, perte du regard de 0 à 60 s.',
      });
    controller.setPresenceTimings(request.body);
    perception.refreshPresenceTimings();
    broadcast({ schemaVersion: 1, type: 'devices', status: devices() }, true);
    return controller.getPresenceTimings();
  });
  const delegationModeSchema = compile<{ mode: DelegationMode }>({
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: { mode: { enum: [...DELEGATION_MODES] } },
  });
  app.patch('/api/admin/opening', { preHandler: requireAdmin }, async (request, reply) => {
    if (!isOpening(request.body))
      return reply.code(400).send({ error: 'Réglage d’ouverture invalide.' });
    controller.setOpening(request.body);
    perception.syncCamera();
    return controller.snapshot();
  });
  app.patch('/api/admin/delegation-mode', { preHandler: requireAdmin }, async (request, reply) => {
    if (!delegationModeSchema(request.body))
      return reply.code(400).send({ error: 'Mode de délégation invalide.' });
    controller.setDelegationMode(request.body.mode);
    return controller.snapshot();
  });
  const enabledSchema = compile<{ enabled: boolean }>({
    type: 'object',
    additionalProperties: false,
    required: ['enabled'],
    properties: { enabled: { type: 'boolean' } },
  });
  app.patch('/api/admin/admission-sound', { preHandler: requireAdmin }, async (request, reply) => {
    if (!isAdmissionSound(request.body))
      return reply.code(400).send({ error: 'Réglage du son d’ouverture invalide.' });
    controller.setAdmissionSound(request.body);
    return controller.snapshot();
  });
  app.patch('/api/admin/web-search', { preHandler: requireAdmin }, async (request, reply) => {
    if (!enabledSchema(request.body))
      return reply.code(400).send({ error: 'Réglage de la recherche web invalide.' });
    controller.setWebSearchEnabled(request.body.enabled);
    return controller.snapshot();
  });
  app.patch('/api/admin/silence-close', { preHandler: requireAdmin }, async (request, reply) => {
    if (!isSilenceClose(request.body))
      return reply.code(400).send({ error: 'Fermeture après silence invalide : de 3 à 300 s.' });
    controller.setSilenceClose(request.body);
    return controller.snapshot();
  });
  const greetingSchema = compile<{ mode: GreetingMode }>({
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: { mode: { enum: [...GREETING_MODES] } },
  });
  app.patch('/api/admin/greeting', { preHandler: requireAdmin }, async (request, reply) => {
    if (!greetingSchema(request.body)) return reply.code(400).send({ error: 'Accueil invalide.' });
    controller.setGreetingMode(request.body.mode);
    return controller.snapshot();
  });
  app.patch('/api/admin/cards', { preHandler: requireAdmin }, async (request, reply) => {
    if (!isCardSettings(request.body))
      return reply.code(400).send({ error: 'Réglage des cartes invalide.' });
    controller.setCardSettings(request.body);
    return controller.snapshot();
  });
  app.patch<{ Body: { voice?: unknown } }>(
    '/api/admin/voice',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isLiveVoice(request.body?.voice))
        return reply.code(400).send({ error: 'Voix inconnue.' });
      controller.setSpeechVoice(request.body.voice);
      return controller.snapshot();
    },
  );
  app.patch<{ Body: { scale?: unknown } }>(
    '/api/admin/orb-scale',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isOrbScale(request.body?.scale))
        return reply
          .code(400)
          .send({ error: `Taille de l’orbe invalide (${ORB_SCALE_MIN} à ${ORB_SCALE_MAX} %).` });
      controller.setOrbScale(request.body.scale);
      return controller.snapshot();
    },
  );
  app.patch(
    '/api/admin/advanced-audio-buffer',
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!enabledSchema(request.body))
        return reply.code(400).send({ error: 'Réglage du tampon audio invalide.' });
      controller.setAdvancedAudioBuffer(request.body.enabled);
      return controller.snapshot();
    },
  );
  app.get<{ Querystring: { role?: string } }>(
    '/events',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (request.query.role === 'admin') return requireAdmin(request, reply);
        kioskIdentity(request, reply);
      },
    },
    (socket, request) => {
      const role: Role = request.query.role === 'admin' ? 'admin' : 'kiosk';
      const sessionId = role === 'admin' ? adminIdentity(request) : null;
      const kioskId = role === 'kiosk' ? kioskIdentity(request) : null;
      logs.write('info', 'local', 'Navigateur connecté', { role });
      clients.set(socket, { role, sessionId, kioskId, remote: !fromMachine(request) });
      if (role === 'kiosk') {
        mobile.release();
        if (kiosk) kiosk.socket.close(1008, 'Miroir ouvert dans un autre onglet');
        // L’état audio appartient à la page : elle le renvoie dès l’ouverture (media_ready).
        kiosk = { socket, kioskId: kioskId! };
        controller.heartbeat();
      }
      // Native pong frames keep a background kiosk alive without relying on throttled JS timers.
      socket.on('pong', () => {
        const client = clients.get(socket);
        if (kiosk?.socket === socket && role === 'kiosk' && client && clientActive(client)) {
          controller.heartbeat();
        }
      });
      socket.on('message', (data) => {
        const client = clients.get(socket);
        if (!client || !clientActive(client)) return socket.close(1008, 'Connexion expirée');
        try {
          const message = JSON.parse(data.toString()) as {
            type?: string;
            ready?: unknown;
            page?: unknown;
          };
          if (
            message.type === 'media_ready' &&
            typeof message.ready === 'boolean' &&
            kiosk?.socket === socket &&
            role === 'kiosk'
          ) {
            // Une autre page (rechargement, nouvel onglet) ne possède pas le média de la
            // session en cours ; la même page reconnectée le garde.
            const page = typeof message.page === 'string' ? message.page.slice(0, 64) : null;
            if (page === null || page !== kioskPage) controller.setBrowserAudioReady(false);
            kioskPage = page;
            controller.setBrowserAudioReady(message.ready);
          }
          if (message.type === 'heartbeat' && kiosk?.socket === socket && role === 'kiosk')
            controller.heartbeat();
        } catch {
          socket.close(1003, 'Message invalide');
        }
      });
      socket.on('error', () => socket.close());
      socket.on('close', (code: number) => {
        logs.write('info', 'local', 'Navigateur déconnecté', { role, code });
        clients.delete(socket);
        if (kiosk?.socket === socket) {
          kiosk = null;
          // Le média WebRTC ne passe pas par ce WebSocket : une coupure réseau ou une
          // resynchronisation garde la conversation, et le délai navigateur (5 s) la ferme
          // si la page ne revient pas. Une fermeture voulue par la page la libère aussitôt.
          if (![1006, 1011, 1013].includes(code)) controller.setBrowserAudioReady(false);
        }
      });
      socket.send(JSON.stringify(controller.snapshot()));
      if (role === 'admin')
        socket.send(JSON.stringify({ schemaVersion: 1, type: 'devices', status: devices() }));
    },
  );

  function broadcast(event: unknown, adminOnly = false) {
    const payload = JSON.stringify(event);
    for (const [socket, client] of clients) {
      if (adminOnly && client.role !== 'admin') continue;
      if (!clientActive(client)) {
        socket.close(1008, 'Connexion expirée');
        continue;
      }
      if (socket.readyState === 1) {
        if (socket.bufferedAmount > 128 * 1024) socket.close(1013, 'Resynchronisation nécessaire');
        else socket.send(payload);
      }
    }
  }
  let lastTransition = '';
  const unsubscribe = controller.subscribe((event) => {
    const details = {
      phase: event.state.session.phase,
      reason: event.state.session.reason,
      diagnostic: event.state.diagnostic,
      interactionId: event.interactionId,
      openaiBlocked: event.state.openaiBlocked,
      presenceHealth: event.state.presence.health,
    };
    const signature = JSON.stringify(details);
    if (signature !== lastTransition) {
      lastTransition = signature;
      logs.write(details.diagnostic ? 'warn' : 'info', 'session', 'État du contrôleur', details);
    }
    broadcast(event);
    ambient.tick();
    perception.syncCamera();
  });

  if (config.staticRoot && existsSync(config.staticRoot)) {
    await app.register(staticFiles, { root: config.staticRoot });
    app.get('/admin', async (_request, reply) => reply.sendFile('index.html'));
  } else {
    app.get('/', async () => ({
      message: 'Exécutez npm run build, ou ouvrez le serveur Vite (npm run dev:web).',
    }));
  }
  const controllerTimer =
    options.timers === false
      ? null
      : setInterval(() => {
          controller.tick();
          ambient.tick();
          perception.tick();
          vision.tick();
          memory.tick();
          agents.tick();
          const state = controller.snapshot().state;
          const profileId = state.activeProfile?.id;
          if (profileId && state.session.phase === 'ready') {
            agents.resume(profileId, state.session.interactionId!);
            const task = agents.pendingDelivery(profileId);
            if (task && live.deliverAgentTask(profileId, task)) agents.markDelivered(task);
          }
        }, 250);
  const heartbeatTimer =
    options.timers === false
      ? null
      : setInterval(() => {
          if (kiosk?.socket.readyState === 1) kiosk.socket.ping();
          broadcast(controller.keepalive());
        }, 1000);
  heartbeatTimer?.unref();
  controllerTimer?.unref();
  app.addHook('onClose', async () => {
    logs.write('info', 'local', 'Arrêt du serveur');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (controllerTimer) clearInterval(controllerTimer);
    unsubscribe();
    mobile.dispose();
    ambient.dispose();
    homeAssistant.dispose();
    imageGenerationRuntime.dispose();
    imageGeneration.dispose();
    for (const socket of clients.keys()) socket.close(1001, 'Arrêt du serveur');
    await memory.dispose();
    controller.close('Arrêt du serveur.');
    await live.shutdown();
    await agents.dispose();
    downloads.dispose();
    satellites.dispose();
    satellitePairing.dispose();
    wakeArbiter.dispose();
    perception.dispose();
    db.close();
  });
  return { app, controller, profiles, logs, memory, agents };
}
