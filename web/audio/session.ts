import { createGroqAudioSession } from './groq-session';
import type { Scope } from '../../shared/types';
import { request } from '../api';
import { reportDiagnostic, reportMeasure } from '../diagnostics';
import { takeAudioConnection } from './connection';
import { audioPreferences } from './preferences';

export interface AudioLevels {
  input: number;
  output: number;
}
/** `device` : micro ou permission perdus, la voix doit être réactivée ; `transport` : réseau. */
export type AudioFailure = 'device' | 'transport';

// Erreurs de capture qui exigent une nouvelle autorisation ou un autre périphérique.
const deviceErrors = new Set([
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'OverconstrainedError',
]);
// Une connexion WebRTC « disconnected » peut revenir seule après une perte réseau brève.
const disconnectGraceMs = 5000;

/** Ce navigateur ne peut pas porter la session : le serveur la clôt. */
export function reportMediaFailure(scope: Scope): void {
  void request('/api/media/status', {
    method: 'POST',
    body: JSON.stringify({ scope, type: 'failed' }),
  }).catch(() => {});
}

export function createAudioSession(
  scope: Scope,
  onFailure: (kind: AudioFailure) => void,
  onLocked?: (locked: boolean) => void,
  advancedBuffer = false,
  openedAt: number | null = null,
  provider: 'openai' | 'groq' = 'openai',
) {
  if (provider === 'groq') return createGroqAudioSession(scope, onFailure, onLocked);
  let stage = 'initialisation audio';
  const report = (event: string, error?: unknown) =>
    reportDiagnostic(event, stage, error, scope.interactionId ?? undefined);
  report('start');
  const beganAt = performance.now();
  let remoteBeganAt: number | null = null;
  let started = false;
  let serverReady = false;
  let mediaReported = false;
  const measure = (name: string, duration: number) =>
    reportMeasure(name, Math.round(duration), scope.interactionId ?? undefined);
  const { connection, prewarmed } = takeAudioConnection(advancedBuffer);
  const { peer, events } = connection;
  measure('audio_preparation_reutilisee', prewarmed ? 1 : 0);
  connection.onOverflow(() =>
    report(
      'warn',
      new Error(
        advancedBuffer
          ? 'Tampon audio local de seize secondes dépassé.'
          : 'Tampon audio local de huit secondes dépassé.',
      ),
    ),
  );
  const audio = new Audio();
  audio.autoplay = false;
  const context = connection.context;
  const sources: MediaStreamAudioSourceNode[] = [];
  const inputMeter = context.createAnalyser();
  const outputMeter = context.createAnalyser();
  inputMeter.fftSize = outputMeter.fftSize = 256;
  const inputSamples = new Float32Array(256);
  const outputSamples = new Float32Array(256);
  const abort = new AbortController();
  let microphone: MediaStream | null = null;
  let pcm: WebSocket | null = null;
  let unsubscribePcm: (() => void) | null = null;
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let closing = false;
  let failed = false;
  let enabled = true;
  const fail = (error?: unknown, kind?: AudioFailure) => {
    if (disposed || closing || failed) return;
    failed = true;
    report('error', error);
    silence();
    onFailure(
      kind ?? (deviceErrors.has((error as Error | undefined)?.name ?? '') ? 'device' : 'transport'),
    );
    reportMediaFailure(scope);
  };
  const silence = () => {
    closing = true;
    abort.abort();
    if (disconnectTimer) clearTimeout(disconnectTimer);
    disconnectTimer = null;
    connection.dispose();
    window.removeEventListener('pointerdown', playOutput);
    window.removeEventListener('keydown', playOutput);
    microphone?.getTracks().forEach((track) => {
      track.enabled = false;
    });
    audio.pause();
  };
  const status = (type: 'connected' | 'started') =>
    request('/api/media/status', {
      method: 'POST',
      body: JSON.stringify({ scope, type }),
      signal: abort.signal,
    });
  // The advanced buffer replays the opening speech once OpenAI has started the session.
  const replayBuffer = () => {
    if (enabled && advancedBuffer && !closing && !disposed) connection.playAudio();
  };
  // Chrome keeps an AudioContext suspended until the page receives a user gesture, so
  // resume() can stay pending forever. Wait for the gesture instead of failing the session.
  const resumeOnGesture = () =>
    new Promise<void>((resolve) => {
      if (disposed || closing || context.state === 'running') return resolve();
      // The page needs one interaction before this browser starts any audio.
      onLocked?.(true);
      const settle = () => {
        cleanup();
        onLocked?.(false);
        resolve();
      };
      const attempt = () => {
        if (disposed || closing) return settle();
        if (context.state === 'running') return settle();
        void context.resume().then(
          () => {
            if (context.state === 'running') settle();
          },
          () => {},
        );
      };
      const cleanup = () => {
        window.removeEventListener('pointerdown', attempt);
        window.removeEventListener('keydown', attempt);
        window.removeEventListener('touchstart', attempt);
        context.removeEventListener('statechange', attempt);
        abort.signal.removeEventListener('abort', settle);
      };
      window.addEventListener('pointerdown', attempt, { passive: true });
      window.addEventListener('keydown', attempt);
      window.addEventListener('touchstart', attempt, { passive: true });
      context.addEventListener('statechange', attempt);
      abort.signal.addEventListener('abort', settle, { once: true });
      attempt();
    });
  // Playback is also gated by the autoplay policy; retry on the next interaction.
  const playOutput = () => {
    if (disposed || closing || !enabled || !audio.srcObject) return;
    audio.play().then(
      () => {
        onLocked?.(false);
        window.removeEventListener('pointerdown', playOutput);
        window.removeEventListener('keydown', playOutput);
      },
      () => {
        if (disposed || closing || !enabled) return;
        onLocked?.(true);
        window.addEventListener('pointerdown', playOutput, { once: true });
        window.addEventListener('keydown', playOutput, { once: true });
      },
    );
  };
  peer.onconnectionstatechange = () => {
    reportDiagnostic(
      'state',
      'WebRTC : ' + peer.connectionState,
      undefined,
      scope.interactionId ?? undefined,
    );
    if (peer.connectionState === 'connected') {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      disconnectTimer = null;
      if (!mediaReported) {
        // L’audio circule : le serveur n’attend plus le canal de données pour annoncer l’écoute.
        mediaReported = true;
        measure('audio_webrtc_connecte', performance.now() - beganAt);
        void status('connected').catch(fail);
      }
    } else if (peer.connectionState === 'failed') {
      fail(new Error('Connexion WebRTC : failed'));
    } else if (peer.connectionState === 'disconnected' && !disconnectTimer) {
      disconnectTimer = setTimeout(() => {
        disconnectTimer = null;
        if (peer.connectionState !== 'connected')
          fail(new Error('Connexion WebRTC : ' + peer.connectionState));
      }, disconnectGraceMs);
    }
  };
  peer.ontrack = (event) => {
    if (disposed || closing) return;
    const stream = new MediaStream([event.track]);
    audio.srcObject = stream;
    const source = context.createMediaStreamSource(stream);
    sources.push(source);
    source.connect(outputMeter);
    if (enabled) playOutput();
  };
  events.onmessage = ({ data }) => {
    if (disposed || closing) return;
    try {
      const event = JSON.parse(String(data));
      if (event.type === 'session.started' && !started) {
        started = true;
        replayBuffer();
        measure('audio_demarrage', performance.now() - beganAt);
        if (remoteBeganAt !== null) measure('audio_openai', performance.now() - remoteBeganAt);
        reportDiagnostic(
          'connected',
          'session OpenAI démarrée',
          undefined,
          scope.interactionId ?? undefined,
        );
        // Secours si le canal de contrôle du serveur n’a pas déjà confirmé le démarrage.
        void status('started').catch(fail);
      }
      if (event.type === 'error') fail(new Error(event.error?.message ?? 'Erreur du canal OpenAI'));
      if (event.type === 'session.closed') silence();
    } catch (error) {
      fail(error);
    }
  };
  events.onclose = () => fail(new Error('Canal de données OpenAI fermé'));

  /** Micro, compteur d’entrée et flux VAD local, en parallèle de la négociation OpenAI. */
  async function capture() {
    const microphoneAt = performance.now();
    const stream = await connection.microphone();
    if (disposed || closing) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    reportDiagnostic(
      'success',
      'autorisation du microphone',
      undefined,
      scope.interactionId ?? undefined,
    );
    measure('audio_microphone', performance.now() - microphoneAt);
    microphone = stream;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    const lookbackSeconds =
      advancedBuffer && openedAt !== null
        ? 1 + Math.max(0, (Date.now() - openedAt) / 1000)
        : undefined;
    if (advancedBuffer) connection.triggerAudio(true, lookbackSeconds);
    const source = context.createMediaStreamSource(stream);
    sources.push(source);
    source.connect(inputMeter);
    pcm = new WebSocket(
      (location.protocol === 'https:' ? 'wss://' : 'ws://') +
        location.host +
        '/audio?interactionId=' +
        encodeURIComponent(scope.interactionId!),
    );
    pcm.onopen = () =>
      reportDiagnostic(
        'connected',
        'flux audio local VAD',
        undefined,
        scope.interactionId ?? undefined,
      );
    pcm.onclose = ({ code }) => {
      // 1008 : le serveur a déjà clos cette session, ce n’est pas une panne du navigateur.
      if (code === 1008) silence();
      else fail(new Error('Flux audio local VAD fermé'));
    };
    pcm.onmessage = ({ data }) => {
      if (!advancedBuffer || typeof data !== 'string') return;
      try {
        if (JSON.parse(data)?.type === 'audio_catchup') {
          connection.catchUpAudio();
          report('audio_buffer_catchup');
        }
      } catch {
        // Ignore non-alignment messages on the local diagnostics channel.
      }
    };
    unsubscribePcm = connection.subscribePcm((data) => {
      if (enabled && !closing && pcm?.readyState === WebSocket.OPEN && pcm.bufferedAmount < 4096)
        pcm.send(data);
    });
    for (const track of stream.getAudioTracks()) {
      track.onended = () => fail(new Error('Piste microphone arrêtée'), 'device');
    }
  }

  async function start() {
    try {
      stage = 'activation de la sortie audio';
      await resumeOnGesture();
      if (disposed || closing) return;
      const { speaker } = audioPreferences();
      // Une sortie choisie mais refusée garde la sortie par défaut au lieu d’échouer.
      if (speaker && 'setSinkId' in audio)
        void audio.setSinkId(speaker).catch((error: unknown) => report('warn', error));
      stage = 'autorisation du microphone';
      const captured = capture();
      void captured.catch(fail);
      stage = 'négociation WebRTC';
      const sdp = await connection.offer();
      if (disposed || closing) return;
      measure('audio_preparation_locale', performance.now() - beganAt);
      stage = 'création de session OpenAI via le serveur';
      report('start');
      remoteBeganAt = performance.now();
      const answer = await request<{ transport: { sdp: string } }>('/api/media/offer', {
        method: 'POST',
        body: JSON.stringify({ scope, sdp }),
        signal: abort.signal,
      });
      measure('audio_reponse_serveur', performance.now() - remoteBeganAt);
      stage = 'application de la réponse WebRTC OpenAI';
      if (!disposed && !closing)
        await peer.setRemoteDescription({ type: 'answer', sdp: answer.transport.sdp });
    } catch (error) {
      fail(error);
    }
  }
  void start();
  function rms(meter: AnalyserNode, buffer: Float32Array<ArrayBuffer>) {
    meter.getFloatTimeDomainData(buffer);
    return Math.min(
      1,
      Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length) * 5,
    );
  }
  return {
    silence,
    /** Le serveur annonce l’écoute : OpenAI a démarré, le tampon avancé peut être rejoué. */
    ready() {
      serverReady = true;
      replayBuffer();
    },
    enable(value: boolean) {
      if (disposed || closing || enabled === value) return;
      enabled = value;
      microphone?.getAudioTracks().forEach((track) => {
        track.enabled = value;
      });
      if (!value) {
        if (advancedBuffer) connection.pauseAudio();
        audio.pause();
      } else {
        if (started || serverReady) replayBuffer();
        playOutput();
      }
    },
    levels(): AudioLevels {
      return disposed || closing || !enabled
        ? { input: 0, output: 0 }
        : { input: rms(inputMeter, inputSamples), output: rms(outputMeter, outputSamples) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      silence();
      unsubscribePcm?.();
      pcm?.close();
      connection.dispose();
      microphone?.getTracks().forEach((track) => track.stop());
      audio.srcObject = null;
      sources.forEach((source) => source.disconnect());
      inputMeter.disconnect?.();
      outputMeter.disconnect?.();
    },
  };
}
