import { createProviderAudioSession } from './provider-session';
import { reportDiagnostic } from '../diagnostics';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MirrorState } from '../../shared/types';
import {
  invalidateAudioPreparation,
  audioPreparation,
  runningAudioContext,
  subscribeAudioPreparation,
} from './preparation';
import { announceAdmission } from './admission-sound';
import { warmAudioConnection, releaseWarmAudioConnection } from './connection';
import { createAudioSession, reportMediaFailure } from './session';
import { WakeListener } from './wake';

type VoiceSession = { id: string; audio: ReturnType<typeof createAudioSession> };

// Held outside React (and carried across Vite HMR updates) so that remounting the
// mirror after an edit never tears down a live microphone or its paid Live connection.
const registry: Map<string, VoiceSession> =
  (import.meta.hot?.data.registry as Map<string, VoiceSession> | undefined) ?? new Map();
if (import.meta.hot) import.meta.hot.data.registry = registry;

export function useVoice(state: MirrorState | null, fresh: boolean) {
  const preparation = useSyncExternalStore(subscribeAudioPreparation, audioPreparation);
  const active = useRef<VoiceSession | null>(null);
  const recovery = useRef<string | null>(null);
  const [audioLocked, setAudioLocked] = useState(false);
  const [wakeRetry, setWakeRetry] = useState(0);
  // Conversation d’un satellite : elle se tient dans une autre pièce, ce navigateur n’y prend
  // aucune part (ni micro, ni son, ni connexion OpenAI).
  const scope = state?.session.satellite ? undefined : state?.session;
  const advancedBuffer = state?.advancedAudioBuffer ?? false;
  // Un arrêt manuel n’éteint pas la veille : dire « Cornelius » le lève côté serveur.
  const listenForWake = !!(
    fresh &&
    preparation.ready &&
    state?.wakeWord.enabled &&
    state.wakeWord.ready &&
    state.browserAudioReady &&
    !state.openaiBlocked &&
    ['idle', 'blocked'].includes(state.session.phase)
  );
  useEffect(() => {
    if (!listenForWake) return;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const listener = new WakeListener((reason) => {
      listener.stop();
      if (reason === 'microphone') {
        invalidateAudioPreparation('Le microphone de veille a été interrompu. Réactivez la voix.');
      } else {
        retry = setTimeout(() => setWakeRetry((value) => value + 1), 2000);
      }
    }, advancedBuffer);
    void listener.start().catch((error) => {
      reportDiagnostic('error', 'écoute locale du mot d’appel', error);
      invalidateAudioPreparation('Écoute du mot d’appel indisponible. Réactivez la voix.');
    });
    return () => {
      if (retry) clearTimeout(retry);
      listener.stop();
    };
  }, [listenForWake, wakeRetry, advancedBuffer]);
  const id =
    !state?.openaiBlocked && scope && ['connecting', 'ready', 'closing'].includes(scope.phase)
      ? scope.interactionId
      : null;
  useEffect(() => {
    if (active.current && active.current.id !== id) {
      active.current.audio.dispose();
      registry.delete(active.current.id);
      active.current = null;
      setAudioLocked(false);
    }
    if (id && !active.current && scope) {
      const sessionScope = {
        interactionId: id,
        profileEpoch: scope.profileEpoch,
        contextVersion: scope.contextVersion,
      };
      const existing = registry.get(id);
      if (existing) active.current = existing;
      else if (fresh && scope.phase === 'connecting') {
        try {
          const create =
            state?.voiceProvider === 'mistral' ? createProviderAudioSession : createAudioSession;
          const audio = create(
            sessionScope,
            (kind) => {
              // Une coupure réseau ou une clôture serveur ne retire pas l’autorisation audio :
              // seule une perte du micro ou de sa permission exige de réactiver la voix.
              if (kind === 'device')
                invalidateAudioPreparation(
                  'Le microphone a été interrompu. Réactivez la voix pour réessayer.',
                );
            },
            setAudioLocked,
            advancedBuffer,
            scope.startedAt,
          );
          active.current = { id, audio };
          registry.set(id, active.current);
        } catch (error) {
          reportDiagnostic('error', 'initialisation audio navigateur', error, id);
          reportMediaFailure(sessionScope);
        }
      } else if (fresh && scope.phase === 'ready' && recovery.current !== id) {
        // Page chargée ou rechargée pendant une session déjà prête : ce navigateur n'a pas
        // établi le média. Le signaler pour que le serveur libère puis rouvre proprement.
        recovery.current = id;
        reportMediaFailure(sessionScope);
      }
    }
    // A brief state resync mutes audio without creating another paid connection.
    if (scope?.phase === 'closing') active.current?.audio.silence();
    else {
      active.current?.audio.enable(fresh);
      if (scope?.phase === 'ready') active.current?.audio.ready();
    }
  }, [id, fresh, scope?.phase, advancedBuffer]);
  // Un son local signale chaque nouvelle ouverture, une seule fois par interaction.
  const admissionSound = state?.admissionSound;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !fresh || scope?.phase !== 'connecting' || announced.current === id) return;
    announced.current = id;
    const context = runningAudioContext();
    if (admissionSound?.enabled && context)
      void announceAdmission(context, admissionSound.sound).catch((error) =>
        reportDiagnostic('warn', 'son d’ouverture', error, id),
      );
  }, [id, fresh, scope?.phase, admissionSound?.enabled, admissionSound?.sound]);
  // Le mode normal n’a rien à préparer : l’offre est immédiate et le micro la rejoint.
  // Le tampon avancé garde la capture active pour rejouer le début de la phrase.
  const canWarm = !!(
    fresh &&
    advancedBuffer &&
    preparation.ready &&
    state &&
    !state.wakeWord.enabled &&
    !state.openaiBlocked &&
    !scope?.manualStop &&
    scope?.phase === 'idle' &&
    state.presence.health === 'ok' &&
    (!state.privacyMode || state.presence.peopleCount <= 1)
  );
  const peopleKey =
    state?.presence.people
      .map((person) => person.trackId)
      .sort()
      .join('|') ?? '';
  const warmedPeople = useRef(peopleKey);
  const warmedMode = useRef(advancedBuffer);
  const warmingInitialized = useRef(false);
  useEffect(() => {
    const firstWarm = !warmingInitialized.current;
    warmingInitialized.current = true;
    const peopleChanged = warmedPeople.current !== peopleKey;
    const modeChanged = warmedMode.current !== advancedBuffer;
    warmedPeople.current = peopleKey;
    warmedMode.current = advancedBuffer;
    if (!listenForWake && modeChanged) releaseWarmAudioConnection();
    if (canWarm || listenForWake) {
      try {
        const connection = warmAudioConnection(true, advancedBuffer);
        if (
          advancedBuffer &&
          !state?.wakeWord.enabled &&
          connection &&
          (firstWarm || peopleChanged || modeChanged)
        ) {
          connection.resetAudio();
          if (state && state.presence.peopleCount > 0) connection.triggerAudio(true);
        }
      } catch (error) {
        reportDiagnostic('error', 'préparation audio locale', error);
      }
    } else releaseWarmAudioConnection();
  }, [
    canWarm,
    listenForWake,
    peopleKey,
    advancedBuffer,
    state?.wakeWord.enabled,
    state?.presence.peopleCount,
  ]);
  useEffect(
    () => () => {
      releaseWarmAudioConnection();
      // A Fast Refresh remount must keep the session; only a real unmount releases it.
      if (import.meta.hot) return;
      if (active.current) {
        active.current.audio.dispose();
        registry.delete(active.current.id);
        active.current = null;
      }
      setAudioLocked(false);
    },
    [],
  );
  const readAudio = useCallback(
    () => active.current?.audio.levels() ?? { input: 0, output: 0 },
    [],
  );
  return { readAudio, audioLocked };
}
