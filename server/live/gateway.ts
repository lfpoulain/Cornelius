import type { DiagnosticLog } from '../logs.js';
import OpenAI from 'openai';
import WebSocket from 'ws';
import type {
  LiveCreateResponse,
  MediaSessionConfig,
  SessionConfig,
} from 'openai/resources/live/live';
import type { ConnectClientEvent, ConnectServerEvent } from 'openai/resources/live/sideband';

export interface LiveConnection {
  send(event: ConnectClientEvent): void;
  dispose(): void;
}
/** Session Live sur un WebSocket principal : le serveur porte lui-même le son (satellites). */
export interface LiveAudioConnection extends LiveConnection {
  /** PCM16 mono au format choisi au démarrage, sans en-tête. */
  sendAudio(pcm: Buffer): void;
}
export interface LiveHandlers {
  open(): void;
  event(event: ConnectServerEvent): void;
  failure(): void;
}
export interface LiveGateway {
  provider?: 'openai' | 'mistral';
  serverAudio?: boolean;
  hangup?(id: string): Promise<void>;
  /** Ouvre la connexion HTTPS que réutilisera la création de session, sans rien créer. */
  prewarm?(): Promise<void>;
  create(
    config: MediaSessionConfig,
    sdp: string,
    signal?: AbortSignal,
  ): Promise<LiveCreateResponse>;
  attach(id: string, handlers: LiveHandlers): LiveConnection;
  /** Démarre une session sur un WebSocket principal ; `open` suit l’envoi de session.start. */
  connect?(
    session: SessionConfig,
    handlers: LiveHandlers,
    welcomeMessage?: string,
  ): LiveAudioConnection;
}
export function createLiveGateway(apiKey: string, logs?: DiagnosticLog): LiveGateway {
  const client = new OpenAI({ apiKey, timeout: 4000, maxRetries: 0 });
  /** WebSocket Live authentifié : canal de contrôle d’une session WebRTC, ou session complète. */
  function socketConnection(
    url: string,
    remoteId: string | undefined,
    opened: (socket: WebSocket) => void,
    handlers: LiveHandlers,
  ) {
    const socket = new WebSocket(url, {
      headers: { Authorization: 'Bearer ' + apiKey },
      handshakeTimeout: 4000,
      maxPayload: 1024 * 1024,
    });
    socket.on('open', () => opened(socket));
    socket.on('message', (data) => {
      try {
        handlers.event(JSON.parse(data.toString()) as ConnectServerEvent);
      } catch (error) {
        logs?.write('error', 'openai', 'Traitement du message de contrôle échoué', {
          remoteId,
          error,
        });
        handlers.failure();
      }
    });
    socket.on('error', (error) => {
      logs?.write('error', 'openai', 'Erreur réseau du canal de contrôle', { remoteId, error });
      handlers.failure();
    });
    socket.on('close', (code) => {
      logs?.write('warn', 'openai', 'Canal de contrôle fermé', { remoteId, code });
      handlers.failure();
    });
    return {
      socket,
      send(event: ConnectClientEvent) {
        if (socket.readyState !== WebSocket.OPEN) throw new Error('Contrôle Live indisponible.');
        socket.send(JSON.stringify(event));
      },
      dispose() {
        socket.removeAllListeners();
        socket.on('error', () => {});
        socket.terminate();
      },
    };
  }
  return {
    hangup: (id) => client.live.sessions.hangup(id),
    // Lecture gratuite : le handshake TLS est fait avant l’admission, pas pendant la création.
    prewarm: async () => {
      await client.models.retrieve('gpt-live-1').catch(() => {});
    },
    create: (session, sdp, signal) =>
      client.live.create({ session, transport: { type: 'webrtc', sdp } }, { signal }),
    attach(id, handlers) {
      logs?.write('info', 'openai', 'Connexion du canal de contrôle', { remoteId: id });
      const { send, dispose } = socketConnection(
        'wss://api.openai.com/v1/live/sessions/' + encodeURIComponent(id) + '/attach',
        id,
        () => {
          logs?.write('info', 'openai', 'Canal de contrôle connecté', { remoteId: id });
          handlers.open();
        },
        handlers,
      );
      return { send, dispose };
    },
    connect(session, handlers) {
      logs?.write('info', 'openai', 'Connexion de la session Live du satellite');
      const { socket, send, dispose } = socketConnection(
        'wss://api.openai.com/v1/live/sessions',
        undefined,
        (opened) => {
          logs?.write('info', 'openai', 'Session Live du satellite connectée');
          opened.send(JSON.stringify({ type: 'session.start', session }));
          handlers.open();
        },
        handlers,
      );
      return {
        send,
        dispose,
        sendAudio(pcm) {
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(
            JSON.stringify({ type: 'session.input_audio.append', audio: pcm.toString('base64') }),
          );
        },
      };
    },
  };
}
