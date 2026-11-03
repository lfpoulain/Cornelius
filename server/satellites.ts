import { randomUUID } from 'node:crypto';
import { GESTURES, type Gesture } from '../shared/satellite-gestures.js';
import type { WebSocket } from 'ws';
import type { DiagnosticLog } from './logs.js';
import type { SessionController } from './controller.js';
import type { PerceptionBridge } from './perception.js';
import type { WakeArbiter } from './wake-arbiter.js';
import type { Satellite, SatelliteStore } from './satellites-store.js';

/** Version du protocole des satellites (docs/developpement/satellites-protocole.md). */
export const SATELLITE_PROTOCOL = 1;
const FRAME_BYTES = 2560;
const HELLO_MS = 5000;
const PING_MS = 15_000;
// Son gardé avant la détection : la question suit « Cornelius » sans pause.
const PREROLL_FRAMES = 6;
// Son gardé pendant l’ouverture de la session Live (8 s au plus).
const PENDING_FRAMES = 100;
// Trame attendue par la détection de voix locale (512 échantillons).
const VAD_BYTES = 1024;

type ConversationState = 'idle' | 'connecting' | 'ready' | 'closing';

interface Connection {
  socket: WebSocket;
  satellite: Satellite;
  streamId: string;
  firmware: string | null;
  /** Annulation d’écho annoncée par le satellite : pas de semi-duplex. */
  echoCancelled: boolean;
  gestures: boolean;
  micToggle: boolean;
  muted: boolean;
  listening: boolean | null;
  alive: boolean;
  helloTimer: ReturnType<typeof setTimeout> | null;
  lastLogAt: number;
  /** Conversation de ce satellite, telle que le contrôleur la publie. */
  conversation: ConversationState;
  interactionId: string | null;
  preroll: Buffer[];
  /** Son reçu entre la détection et la session prête, rejoué à Live dès qu’elle l’est. */
  pending: Buffer[] | null;
  vadRemainder: Buffer;
}

export interface SatelliteStatus {
  gestures?: boolean;
  online: boolean;
  firmware: string | null;
  muted: boolean;
  /** Annulation d’écho annoncée dans « hello ». */
  aec: boolean;
}

/** Réglages de l’administration, tels que le satellite les applique (message « settings »). */
function settingsMessage(satellite: Satellite) {
  return {
    type: 'settings',
    volume: satellite.volume,
    led: {
      color: satellite.ledColor,
      brightness: satellite.ledBrightness,
      nightLight: satellite.nightLight,
    },
    attentive: satellite.attentive,
  };
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Satellites audio connectés : leur son de veille rejoint la perception, et leurs détections
 * l’arbitrage commun avec le miroir. Le son n’est demandé que pendant que la veille écoute.
 */
export class SatelliteHub {
  private gestureHandler?: (id: string, gesture: Gesture, current: () => boolean) => Promise<void>;
  onGesture(handler: (id: string, gesture: Gesture, current: () => boolean) => Promise<void>) {
    this.gestureHandler = handler;
  }
  mute(id: string): void {
    const connection = this.connections.get(id);
    if (connection?.firmware) this.send(connection, { type: 'mute', muted: true });
  }
  toggleMic(id: string): boolean {
    const connection = this.connections.get(id);
    if (!connection?.firmware || !connection.micToggle || connection.socket.readyState !== 1)
      return false;
    this.send(connection, { type: 'mute', muted: !connection.muted });
    return true;
  }
  volumeFeedback(id: string, volume: number): void {
    const connection = this.connections.get(id);
    if (connection?.firmware) this.send(connection, { type: 'volume', volume });
  }
  private connections = new Map<string, Connection>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: () => void;
  private disposed = false;
  constructor(
    private readonly deps: {
      store: SatelliteStore;
      perception: PerceptionBridge;
      arbiter: WakeArbiter;
      controller: SessionController;
      logs: DiagnosticLog;
      /** Micro du satellite vers la session Live de sa conversation. */
      live: {
        satelliteAudio(satelliteId: string, pcm: Buffer, echoCancelled: boolean): void;
      } | null;
      /** Faux dans les tests : pas de ping périodique. */
      heartbeat?: boolean;
    },
  ) {
    this.unsubscribe = deps.controller.subscribe(() => this.sync());
    if (deps.heartbeat !== false) {
      this.pingTimer = setInterval(() => this.ping(), PING_MS);
      this.pingTimer.unref();
    }
  }

  status(id: string): SatelliteStatus {
    const connection = this.connections.get(id);
    return connection?.firmware
      ? {
          online: true,
          firmware: connection.firmware,
          muted: connection.muted,
          aec: connection.echoCancelled,
          ...(connection.gestures ? { gestures: true } : {}),
        }
      : { online: false, firmware: null, muted: false, aec: false };
  }

  connect(socket: WebSocket, satellite: Satellite): void {
    this.connections.get(satellite.id)?.socket.close(1008, 'Satellite reconnecté ailleurs.');
    const connection: Connection = {
      socket,
      satellite,
      streamId: randomUUID(),
      firmware: null,
      echoCancelled: false,
      gestures: false,
      micToggle: false,
      muted: false,
      listening: null,
      alive: true,
      lastLogAt: 0,
      conversation: 'idle',
      interactionId: null,
      preroll: [],
      pending: null,
      vadRemainder: Buffer.alloc(0),
      helloTimer: setTimeout(() => socket.close(1008, 'Message hello attendu.'), HELLO_MS),
    };
    connection.helloTimer!.unref?.();
    this.connections.set(satellite.id, connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, binary) => {
      if (this.connections.get(satellite.id) !== connection) return;
      if (binary) return this.audio(connection, data);
      let message: Record<string, unknown>;
      try {
        message = object(JSON.parse(String(data)));
      } catch {
        if (!connection.firmware) socket.close(1008, 'Message hello attendu.');
        return;
      }
      if (!connection.firmware) return this.hello(connection, message);
      if (
        message.type === 'gesture' &&
        connection.gestures &&
        GESTURES.includes(message.gesture as Gesture)
      ) {
        void this.gestureHandler?.(
          satellite.id,
          message.gesture as Gesture,
          () => this.connections.get(satellite.id) === connection && socket.readyState === 1,
        ).catch(() => {});
        return;
      }

      if (message.type === 'mic' && typeof message.muted === 'boolean') {
        connection.muted = message.muted;
        this.deps.logs.write('info', 'local', 'Micro du satellite', {
          satellite: satellite.name,
          muted: message.muted,
        });
      } else if (
        message.type === 'log' &&
        typeof message.message === 'string' &&
        message.message.length <= 200 &&
        Date.now() - connection.lastLogAt >= 1000
      ) {
        // Mesures du satellite (niveaux d’écho…) : dans le journal de Cornelius, une par seconde
        // au plus, sans jamais de son ni de texte de conversation.
        connection.lastLogAt = Date.now();
        this.deps.logs.write(
          message.level === 'warn' ? 'warn' : 'info',
          'local',
          'Journal du satellite',
          {
            satellite: satellite.name,
            message: message.message,
          },
        );
      }
    });
    socket.on('close', () => this.closed(connection));
    socket.on('error', () => socket.close());
  }

  /** Satellite supprimé ou jeton renouvelé : sa connexion s’arrête aussitôt. */
  disconnect(id: string, reason: string): void {
    this.connections.get(id)?.socket.close(1008, reason);
  }

  /** Voix de Cornelius pour le satellite de la conversation (PCM16 16 kHz). */
  play(satelliteId: string, pcm: Buffer): void {
    const connection = this.connections.get(satelliteId);
    if (connection?.conversation !== 'ready' || connection.socket.readyState !== 1) return;
    connection.socket.send(pcm);
  }

  /** Nom ou réglages changés : la connexion en cours les reprend. */
  refresh(satellite: Satellite): void {
    const connection = this.connections.get(satellite.id);
    if (!connection) return;
    const before = JSON.stringify(settingsMessage(connection.satellite));
    connection.satellite = satellite;
    if (connection.firmware && JSON.stringify(settingsMessage(satellite)) !== before)
      this.send(connection, settingsMessage(satellite));
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const connection of this.connections.values())
      connection.socket.close(1001, 'Arrêt du serveur');
    this.connections.clear();
  }

  private hello(connection: Connection, message: Record<string, unknown>) {
    const { socket, satellite } = connection;
    if (
      message.type !== 'hello' ||
      message.protocol !== SATELLITE_PROTOCOL ||
      typeof message.firmware !== 'string' ||
      message.firmware.length < 1 ||
      message.firmware.length > 32 ||
      (message.aec !== undefined && typeof message.aec !== 'boolean')
    )
      return socket.close(
        1008,
        message.type === 'hello' && message.protocol !== SATELLITE_PROTOCOL
          ? 'Protocole non pris en charge.'
          : 'Message hello invalide.',
      );
    if (connection.helloTimer) clearTimeout(connection.helloTimer);
    connection.helloTimer = null;
    if (!this.startWake(connection)) return socket.close(1008, 'Écoute du mot d’appel saturée.');
    connection.firmware = message.firmware;
    connection.echoCancelled = message.aec === true;
    connection.gestures = message.gestures === true;
    connection.micToggle = message.micToggle === true;
    this.deps.store.seen(satellite.id);
    this.deps.logs.write('info', 'local', 'Satellite connecté', {
      satellite: satellite.name,
      firmware: message.firmware,
      aec: connection.echoCancelled,
    });
    this.send(connection, {
      type: 'welcome',
      protocol: SATELLITE_PROTOCOL,
      id: satellite.id,
      name: satellite.name,
      volume: satellite.volume,
    });
    this.send(connection, settingsMessage(satellite));
    this.sync();
  }

  private audio(connection: Connection, data: unknown) {
    const { socket } = connection;
    if (!connection.firmware) return socket.close(1008, 'Message hello attendu.');
    const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (pcm.length !== FRAME_BYTES) return socket.close(1008, 'Trame audio invalide.');
    // Trames encore en route après « listen: false », ou micro coupé : jamais analysées.
    if (connection.muted || !connection.listening) return;
    if (connection.conversation === 'connecting') {
      if (connection.pending && connection.pending.length < PENDING_FRAMES)
        connection.pending.push(pcm);
      return;
    }
    if (connection.conversation === 'ready') return this.converse(connection, pcm);
    connection.preroll.push(pcm);
    if (connection.preroll.length > PREROLL_FRAMES) connection.preroll.shift();
    this.deps.perception.wakeAudio(connection.streamId, pcm);
  }

  /** Conversation prête : le micro part vers Live et vers la détection de voix (silence). */
  private converse(connection: Connection, pcm: Buffer) {
    // Écoute attentive : micro ouvert pendant que Cornelius parle, si le satellite annule l’écho.
    this.deps.live?.satelliteAudio(
      connection.satellite.id,
      pcm,
      connection.echoCancelled && connection.satellite.attentive,
    );
    if (!connection.interactionId) return;
    let audio = Buffer.concat([connection.vadRemainder, pcm]);
    while (audio.length >= VAD_BYTES) {
      this.deps.perception.audio(connection.interactionId, audio.subarray(0, VAD_BYTES));
      audio = audio.subarray(VAD_BYTES);
    }
    connection.vadRemainder = Buffer.from(audio);
  }

  private wakeAccepted(connection: Connection, score: number) {
    if (this.connections.get(connection.satellite.id) !== connection) return;
    if (!this.deps.controller.isWakeListening()) return;
    const rounded = Math.round(score * 100) / 100;
    this.send(connection, { type: 'wake', score: rounded });
    // Le son qui précède et suit le mot rejoindra Live : la question suit souvent sans pause.
    connection.pending = [...connection.preroll];
    const accepted = this.deps.controller.satelliteWake({
      id: connection.satellite.id,
      name: connection.satellite.name,
      profileId: connection.satellite.profileId,
    });
    this.deps.logs.write('info', 'local', 'Mot d’appel entendu par un satellite', {
      satellite: connection.satellite.name,
      score: rounded,
      accepted,
    });
    if (!accepted) {
      connection.pending = null;
      this.send(connection, { type: 'busy' });
    }
  }

  /** Suit l’état publié : son demandé ou non, conversation de chaque satellite. */
  private sync() {
    const session = this.deps.controller.sessionState();
    const wakeListening = this.deps.controller.isWakeListening();
    for (const connection of this.connections.values()) {
      if (!connection.firmware) continue;
      const mine = session.satellite?.id === connection.satellite.id;
      if (mine) connection.interactionId = session.interactionId;
      const conversation = mine ? toConversation(session.phase) : 'idle';
      if (conversation !== connection.conversation) this.transition(connection, conversation);
      const listening = wakeListening || conversation === 'connecting' || conversation === 'ready';
      if (connection.listening !== listening) {
        connection.listening = listening;
        this.send(connection, { type: 'listen', enabled: listening });
      }
    }
  }

  /** Flux de veille du satellite dans la perception, avec son propre état openWakeWord. */
  private startWake(connection: Connection): boolean {
    return this.deps.perception.startWakeStream(connection.streamId, (score) =>
      this.deps.arbiter.detected({ score, accept: () => this.wakeAccepted(connection, score) }),
    );
  }

  /**
   * La conversation commence : la veille n’est plus alimentée, et son modèle garde en mémoire
   * le « Cornelius » qui vient d’être dit. Repartir de ce modèle rouvrirait une conversation dès
   * la fin de celle-ci ; un nouveau flux repart d’une écoute neuve.
   */
  private renewWake(connection: Connection) {
    this.deps.perception.endWakeStream(connection.streamId);
    connection.streamId = randomUUID();
    if (!this.startWake(connection))
      connection.socket.close(1008, 'Écoute du mot d’appel saturée.');
  }

  private transition(connection: Connection, next: ConversationState) {
    const previous = connection.conversation;
    connection.conversation = next;
    if (next === 'connecting') {
      this.renewWake(connection);
      connection.pending ??= [];
      this.send(connection, { type: 'session', state: 'connecting' });
      return;
    }
    if (next === 'ready') {
      this.send(connection, { type: 'session', state: 'ready' });
      const pending = connection.pending ?? [];
      connection.pending = null;
      for (const frame of pending) this.converse(connection, frame);
      return;
    }
    // Clôture : plus de son dans un sens ni dans l’autre.
    connection.pending = null;
    connection.preroll = [];
    connection.vadRemainder = Buffer.alloc(0);
    if (next === 'idle') connection.interactionId = null;
    if (previous === 'connecting' || previous === 'ready')
      this.send(connection, { type: 'session', state: 'closed' });
  }

  private ping() {
    for (const connection of this.connections.values()) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }

  private closed(connection: Connection) {
    if (connection.helloTimer) clearTimeout(connection.helloTimer);
    // Fermetures dues à l’arrêt du serveur : la base est déjà fermée.
    if (this.disposed) return;
    this.deps.perception.endWakeStream(connection.streamId);
    if (this.connections.get(connection.satellite.id) !== connection) return;
    this.connections.delete(connection.satellite.id);
    if (!connection.firmware) return;
    this.deps.controller.satelliteGone(connection.satellite.id);
    this.deps.store.seen(connection.satellite.id);
    this.deps.logs.write('info', 'local', 'Satellite déconnecté', {
      satellite: connection.satellite.name,
    });
  }

  private send(connection: Connection, value: unknown) {
    if (connection.socket.readyState === 1) connection.socket.send(JSON.stringify(value));
  }
}

function toConversation(phase: string): ConversationState {
  return phase === 'connecting' || phase === 'ready' || phase === 'closing' ? phase : 'idle';
}
