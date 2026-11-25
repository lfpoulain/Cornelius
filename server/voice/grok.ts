import WebSocket from 'ws';
import type { DiagnosticLog } from '../logs.js';
import type { VoiceConfiguration, VoiceEvent, VoiceProviderAdapter } from './provider.js';

/**
 * Fournisseur vocal xAI (Grok Voice) : API temps réel de xAI, au protocole de l'API Realtime
 * d'OpenAI, ouverte par le serveur en WebSocket (la clé ne quitte jamais le serveur). Le son reste
 * en PCM16 mono 16 kHz de bout en bout : xAI accepte 16 kHz en entrée et en sortie, sans
 * rééchantillonnage. Documentation : https://docs.x.ai/docs/guides/voice/agent
 */
export const GROK_REALTIME_URL = 'wss://api.x.ai/v1/realtime';
/** Modèle épinglé ; grok-voice-latest en est l'alias chez xAI. */
export const GROK_MODEL = 'grok-voice-3.0';
export const GROK_DEFAULT_VOICE = 'eve';
/** Comme Mistral, facturé à la minute : une conversation dure 15 minutes au plus. */
export const GROK_MAX_SESSION_MS = 15 * 60_000;
const SAMPLE_RATE = 16_000;
/** Octets de PCM16 mono par milliseconde. */
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;
/**
 * xAI envoie l'audio d'une réponse bien plus vite que le temps réel ; le navigateur refuse plus de
 * 2 s de son d'avance (web/audio/provider-session.ts). La voix est donc transmise au rythme de la
 * lecture, avec au plus LEAD_MS d'avance, en morceaux de 100 ms.
 */
export const GROK_LEAD_MS = 600;
const CHUNK_BYTES = 100 * BYTES_PER_MS;
/**
 * Détection de la parole chez xAI. Son seuil par défaut (0,85) laisse échapper une voix captée à
 * distance par le micro du miroir ; 0,6 l'entend sans réagir au bruit ambiant (essai sur miroir).
 */
export const GROK_VAD = { type: 'server_vad', threshold: 0.6, silence_duration_ms: 700 } as const;
const OPEN_TIMEOUT_MS = 10_000;
const TOOL_TIMEOUT_MS = 60_000;
const MAX_PENDING_TOOLS = 32;
/** Bornes de ce qui vient de xAI : au-delà, la donnée est ignorée. */
const MAX_TEXT = 4_000;
const MAX_ARGUMENTS = 65_536;
const MAX_AUDIO_DELTA = 1_048_576;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';

/** Outils au format de session xAI : fonctions de Cornelius, plus la recherche web de xAI. */
export function grokTools(config: VoiceConfiguration): Record<string, unknown>[] {
  return [
    ...config.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    ...(config.webSearch ? [{ type: 'web_search' }] : []),
  ];
}

export interface GrokOptions {
  voice?: string;
  /** Remplaçable dans les tests. */
  url?: string;
}

export function createGrokVoiceAdapter(
  apiKey: string,
  logs?: DiagnosticLog,
  options: GrokOptions = {},
): VoiceProviderAdapter {
  const voice = options.voice || GROK_DEFAULT_VOICE;
  const url = `${options.url ?? GROK_REALTIME_URL}?model=${encodeURIComponent(GROK_MODEL)}`;
  return {
    connect(configuration, emit) {
      return new Promise((resolveConnection, rejectConnection) => {
        const socket = new WebSocket(url, {
          headers: { Authorization: 'Bearer ' + apiKey },
          handshakeTimeout: OPEN_TIMEOUT_MS,
          maxPayload: 4 * 1024 * 1024,
        });
        let ready = false;
        let closed = false;
        let speaking = false;
        let responding = false;
        let maximumDuration: ReturnType<typeof setTimeout> | undefined;
        const started = Date.now();
        const notify = (event: VoiceEvent) => {
          if (!closed) emit(event);
        };
        const send = (event: Record<string, unknown>) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
        };

        /**
         * Transcriptions de la personne : xAI renvoie « completed » plusieurs fois pendant que la
         * phrase se complète. Seule la dernière version de chaque tour part, quand Grok répond.
         */
        const heard = new Map<string, { text: string; endMs: number }>();
        const flushHeard = () => {
          for (const [id, item] of heard)
            notify({
              type: 'user_transcript',
              id,
              text: item.text,
              startMs: item.endMs,
              endMs: item.endMs,
            });
          heard.clear();
        };

        /** Voix reçue de xAI, pas encore transmise au navigateur. */
        const outgoing: Buffer[] = [];
        /** Heure à laquelle le son déjà transmis aura fini de jouer. */
        let playedUntil = 0;
        let pacer: ReturnType<typeof setTimeout> | undefined;
        let turnTimer: ReturnType<typeof setTimeout> | undefined;
        /** xAI a fini sa réponse ; le tour se termine quand le navigateur l'a jouée. */
        let turnDone = false;
        const finishTurn = () => {
          turnTimer = undefined;
          speaking = false;
          notify({ type: 'turn_completed' });
          notify({ type: 'state', state: 'listening' });
        };
        const pace = () => {
          pacer = undefined;
          const now = Date.now();
          if (playedUntil < now) playedUntil = now;
          while (outgoing.length && playedUntil - now < GROK_LEAD_MS) {
            const chunk = outgoing.shift()!;
            notify({ type: 'assistant_speech', pcm: chunk });
            playedUntil += chunk.length / BYTES_PER_MS;
          }
          if (outgoing.length) pacer = setTimeout(pace, 40);
          else if (turnDone && !turnTimer) {
            turnDone = false;
            turnTimer = setTimeout(finishTurn, Math.max(0, playedUntil - Date.now()));
          }
        };
        const queueSpeech = (pcm: Buffer) => {
          for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES)
            outgoing.push(pcm.subarray(offset, offset + CHUNK_BYTES));
          if (!pacer) pace();
        };
        /** La personne reprend la parole : la voix en attente est abandonnée. */
        const dropSpeech = () => {
          outgoing.length = 0;
          clearTimeout(pacer);
          clearTimeout(turnTimer);
          pacer = undefined;
          turnTimer = undefined;
          turnDone = false;
          playedUntil = Date.now();
        };

        /** Appels de fonction en attente de leur résultat, par call_id. */
        const pending = new Map<string, ReturnType<typeof setTimeout>>();
        /** Résultats rendus pendant que la réponse se termine : une seule relance, après elle. */
        let resumeAfterDone = false;

        const close = (): Promise<void> => {
          if (closed) return Promise.resolve();
          flushHeard();
          dropSpeech();
          closed = true;
          clearTimeout(maximumDuration);
          clearTimeout(openTimer);
          for (const timer of pending.values()) clearTimeout(timer);
          pending.clear();
          try {
            socket.close(1000);
          } catch {
            /* déjà fermée */
          }
          emit({ type: 'closed' });
          return Promise.resolve();
        };
        const fail = (error: Error) => {
          void close();
          rejectConnection(error);
        };
        const openTimer = setTimeout(() => {
          if (ready) return;
          logs?.write('error', 'xai', 'Session Grok : pas de réponse de xAI');
          fail(new Error('Session Grok : délai de connexion dépassé.'));
        }, OPEN_TIMEOUT_MS);
        openTimer.unref();

        const sessionConfig = (config: VoiceConfiguration, withTools: boolean) => ({
          instructions: config.instructions,
          ...(withTools ? { tools: grokTools(config) } : {}),
        });
        const greet = () => {
          if (configuration.welcomeInstructions)
            send({
              type: 'response.create',
              response: { instructions: configuration.welcomeInstructions },
            });
          else if (configuration.welcomeMessage)
            send({
              type: 'response.create',
              response: {
                instructions:
                  'Dis exactement cette phrase, sans rien ajouter : ' +
                  configuration.welcomeMessage,
              },
            });
        };

        socket.on('open', () => {
          send({
            type: 'session.update',
            session: {
              ...sessionConfig(configuration, true),
              voice,
              turn_detection: GROK_VAD,
              audio: {
                input: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
                output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE } },
              },
            },
          });
          // À part : si xAI refusait la transcription, la session garderait le reste.
          send({
            type: 'session.update',
            session: {
              audio: {
                input: { transcription: { model: 'grok-transcribe', language_hint: 'fr' } },
              },
            },
          });
        });

        socket.on('message', (data) => {
          let event: Record<string, unknown>;
          try {
            event = record(JSON.parse(data.toString()));
          } catch {
            return;
          }
          switch (event.type) {
            case 'session.updated':
              if (!ready) {
                ready = true;
                clearTimeout(openTimer);
                logs?.write('info', 'xai', 'Session Grok ouverte', { model: GROK_MODEL, voice });
                notify({ type: 'connected', id: String(record(event.session).id ?? started) });
                maximumDuration = setTimeout(() => void close(), GROK_MAX_SESSION_MS);
                maximumDuration.unref();
                resolveConnection(connection);
                greet();
              }
              break;
            case 'input_audio_buffer.speech_started':
              if (speaking || outgoing.length) notify({ type: 'interrupted' });
              dropSpeech();
              speaking = false;
              notify({ type: 'state', state: 'listening' });
              break;
            // Un bruit peut s'arrêter sans qu'aucune réponse suive : « réfléchit » n'est annoncé
            // qu'à la création d'une vraie réponse, sinon la fin sur silence ne viendrait jamais.
            case 'response.created':
              responding = true;
              flushHeard();
              notify({ type: 'state', state: 'thinking' });
              break;
            case 'response.output_audio.delta':
            case 'response.audio.delta': {
              const delta = typeof event.delta === 'string' ? event.delta : '';
              if (!delta || delta.length > MAX_AUDIO_DELTA) break;
              if (!speaking) {
                speaking = true;
                notify({ type: 'state', state: 'speaking' });
              }
              queueSpeech(Buffer.from(delta, 'base64'));
              break;
            }
            case 'conversation.item.input_audio_transcription.completed': {
              const said = text(event.transcript);
              if (said) {
                const endMs = Date.now() - started;
                heard.set(String(event.item_id ?? 'u' + endMs).slice(0, 128), {
                  text: said,
                  endMs,
                });
              }
              break;
            }
            case 'response.output_audio_transcript.done':
            case 'response.audio_transcript.done': {
              const answer = text(event.transcript);
              if (answer) {
                const endMs = Date.now() - started;
                notify({
                  type: 'assistant_transcript',
                  id: String(event.item_id ?? 'a' + endMs).slice(0, 128),
                  text: answer,
                  startMs: endMs,
                  endMs,
                });
              }
              break;
            }
            case 'response.function_call_arguments.done': {
              const id = typeof event.call_id === 'string' ? event.call_id.slice(0, 128) : '';
              const name = typeof event.name === 'string' ? event.name.slice(0, 128) : '';
              if (!id || !name || pending.has(id)) break;
              const args = typeof event.arguments === 'string' ? event.arguments : '{}';
              if (pending.size >= MAX_PENDING_TOOLS || args.length > MAX_ARGUMENTS) {
                // Refusé sans l'exécuter : Grok reçoit l'erreur comme résultat de l'outil.
                send({
                  type: 'conversation.item.create',
                  item: {
                    type: 'function_call_output',
                    call_id: id,
                    output: JSON.stringify({ error: 'Appel d’outil refusé (limite atteinte).' }),
                  },
                });
                if (pending.size === 0) resumeAfterDone = true;
                break;
              }
              const timer = setTimeout(() => {
                connection.result(id, JSON.stringify({ error: 'Délai de l’outil dépassé.' }));
              }, TOOL_TIMEOUT_MS);
              timer.unref();
              pending.set(id, timer);
              notify({ type: 'tool_call', id, name, arguments: args });
              break;
            }
            case 'response.done':
              responding = false;
              if (resumeAfterDone && pending.size === 0) {
                resumeAfterDone = false;
                send({ type: 'response.create' });
              } else if (pending.size === 0) {
                // Le tour se termine quand le navigateur a joué toute la réponse.
                turnDone = true;
                if (!pacer) pace();
              }
              break;
            case 'error': {
              // Code seulement : un message d'erreur peut citer la conversation.
              const error = record(event.error);
              const code = String(error.code ?? error.type ?? 'xai_error').slice(0, 80);
              logs?.write('warn', 'xai', 'Erreur signalée par xAI', { code });
              if (!ready) fail(new Error(`Session Grok refusée (${code}).`));
              break;
            }
            default:
              break;
          }
        });

        socket.on('unexpected-response', (_request, response) => {
          logs?.write('error', 'xai', 'Session Grok refusée par xAI', {
            status: response.statusCode,
          });
          fail(Object.assign(new Error('Refus de xAI'), { status: response.statusCode }));
        });
        socket.on('error', (error) => {
          logs?.write('warn', 'xai', 'Erreur réseau de la session Grok', { error });
          if (!ready) fail(error);
        });
        socket.on('close', (code) => {
          if (ready && !closed) {
            logs?.write('info', 'xai', 'Session Grok fermée par xAI', { code });
            notify({ type: 'error', code: 'xai_closed', message: `fermée par xAI (${code})` });
          }
          if (!ready) fail(new Error(`Session Grok fermée par xAI (${code}).`));
          else void close();
        });

        const connection = {
          audio(pcm: Buffer) {
            if (closed || !ready) return;
            // Connexion engorgée : la trame est perdue plutôt que d'accumuler du retard.
            if (socket.bufferedAmount > 512 * 1024) return;
            send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
          },
          result(id: string, output: string) {
            const timer = pending.get(id);
            if (!timer) return;
            clearTimeout(timer);
            pending.delete(id);
            send({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id: id, output },
            });
            // Une seule relance, quand tous les résultats de la réponse sont rendus.
            if (pending.size === 0) {
              if (responding) resumeAfterDone = true;
              else send({ type: 'response.create' });
            }
          },
          async update(config: VoiceConfiguration, toolsChanged = true) {
            if (!closed)
              send({ type: 'session.update', session: sessionConfig(config, toolsChanged) });
          },
          close,
        };
      });
    },
  };
}
