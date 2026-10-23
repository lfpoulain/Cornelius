import type { Scope } from '../../shared/types';
import { takeAudioConnection } from './connection';
import { reportMediaFailure, type AudioFailure } from './session';
import { reportDiagnostic } from '../diagnostics';

/** Groq comprend et répond ; la voix française installée sur la machine lit le texte. */
export function createGroqAudioSession(
  scope: Scope,
  onFailure: (kind: AudioFailure) => void,
  onLocked?: (locked: boolean) => void,
) {
  const { connection } = takeAudioConnection(false);
  let socket: WebSocket | null = null;
  let microphone: MediaStream | null = null;
  let unsubscribe: (() => void) | null = null;
  let enabled = true;
  let closed = false;
  let speaking = false;
  let voice: SpeechSynthesisVoice | undefined;
  let playbackTimer: ReturnType<typeof setInterval> | null = null;
  let speechTimer: ReturnType<typeof setTimeout> | null = null;
  let input = 0;
  let speechGeneration = 0;
  const synth = window.speechSynthesis;
  const abort = new AbortController();
  const playback = (value: boolean) => {
    speaking = value;
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: 'playback', speaking: value }));
  };
  const stopSpeech = () => {
    speechGeneration++;
    if (playbackTimer) clearInterval(playbackTimer);
    if (speechTimer) clearTimeout(speechTimer);
    playbackTimer = speechTimer = null;
    synth?.cancel();
    playback(false);
  };
  const silence = () => {
    if (closed) return;
    closed = true;
    abort.abort();
    stopSpeech();
    unsubscribe?.();
    socket?.close();
    microphone?.getTracks().forEach((track) => track.stop());
    connection.dispose();
  };
  const fail = (error: unknown, kind: AudioFailure = 'transport') => {
    if (closed) return;
    reportDiagnostic('error', 'conversation Groq', error, scope.interactionId ?? undefined);
    silence();
    onFailure(kind);
    reportMediaFailure(scope);
  };
  async function localVoice() {
    if (!synth) throw new Error('La synthèse vocale du navigateur est indisponible.');
    const choose = () =>
      synth.getVoices().find((item) => item.localService && /^fr(?:[-_]|$)/i.test(item.lang));
    const available = choose();
    if (available) return available;
    return new Promise<SpeechSynthesisVoice>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        synth.removeEventListener('voiceschanged', changed);
        abort.signal.removeEventListener('abort', cancelled);
      };
      const changed = () => {
        const found = choose();
        if (found) {
          cleanup();
          resolve(found);
        }
      };
      const cancelled = () => {
        cleanup();
        reject(new Error('Session fermée.'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error('Installez une voix française locale pour la synthèse vocale du navigateur.'),
        );
      }, 2500);
      synth.addEventListener('voiceschanged', changed);
      abort.signal.addEventListener('abort', cancelled, { once: true });
      changed();
    });
  }
  function speak(text: string) {
    if (!enabled || closed) {
      playback(false);
      return;
    }
    stopSpeech();
    const generation = speechGeneration;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';
    utterance.voice = voice ?? null;
    playback(true);
    playbackTimer = setInterval(() => {
      if (!closed) playback(true);
    }, 1000);
    speechTimer = setTimeout(
      () => fail(new Error('Lecture vocale interrompue ou bloquée.')),
      90_000,
    );
    utterance.onend = () => {
      if (!closed && generation === speechGeneration) stopSpeech();
    };
    utterance.onerror = (event) => {
      if (
        !closed &&
        generation === speechGeneration &&
        enabled &&
        event.error !== 'canceled' &&
        event.error !== 'interrupted'
      )
        fail(new Error('Voix locale indisponible : ' + event.error));
    };
    synth.speak(utterance);
  }
  const resume = () => {
    void connection.context.resume().catch((error) => fail(error));
  };
  window.addEventListener('pointerdown', resume, { signal: abort.signal });
  window.addEventListener('keydown', resume, { signal: abort.signal });
  void (async () => {
    voice = await localVoice();
    if (closed) return;
    if (connection.context.state !== 'running') {
      onLocked?.(true);
      await connection.context.resume();
      if (closed) return;
      onLocked?.(false);
    }
    microphone = await connection.microphone();
    if (closed) {
      microphone.getTracks().forEach((track) => track.stop());
      return;
    }
    microphone.getTracks().forEach((track) => {
      track.enabled = enabled;
      track.onended = () => fail(new Error('Microphone arrêté.'), 'device');
    });
    socket = new WebSocket(
      (location.protocol === 'https:' ? 'wss://' : 'ws://') +
        location.host +
        '/audio?interactionId=' +
        encodeURIComponent(scope.interactionId!),
    );
    socket.onmessage = ({ data }) => {
      if (closed) return;
      try {
        const message = JSON.parse(String(data));
        if (message.type === 'speech' && typeof message.text === 'string') speak(message.text);
      } catch {
        fail(new Error('Réponse audio Groq invalide.'));
      }
    };
    socket.onclose = ({ code }) => {
      if (code === 1008) silence();
      else fail(new Error('Connexion audio Groq fermée.'));
    };
    socket.onerror = () => fail(new Error('Connexion audio Groq impossible.'));
    unsubscribe = connection.subscribePcm((data) => {
      if (closed || !enabled) return;
      const samples = new Int16Array(data);
      input = Math.min(
        1,
        Math.sqrt(
          samples.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / samples.length,
        ) * 5,
      );
      if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 8192)
        socket.send(speaking ? new ArrayBuffer(data.byteLength) : data);
    });
  })().catch((error: unknown) =>
    fail(
      error,
      ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes((error as Error)?.name)
        ? 'device'
        : 'transport',
    ),
  );
  return {
    silence,
    ready() {},
    enable(value: boolean) {
      enabled = value;
      microphone?.getTracks().forEach((track) => {
        track.enabled = value;
      });
      if (!value) stopSpeech();
    },
    levels: () =>
      closed || !enabled ? { input: 0, output: 0 } : { input, output: speaking ? 0.5 : 0 },
    dispose: silence,
  };
}
