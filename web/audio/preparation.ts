import { audioPreferences, captureKey } from './preferences';
import { useSpeaker } from './speaker';

type Preparation = { ready: boolean; busy: boolean; error: string | null };
let state: Preparation = { ready: false, busy: false, error: null };
let context: AudioContext | null = null;
let microphone: MediaStream | null = null;
let pending: Promise<void> | null = null;
let generation = 0;
let permission: PermissionStatus | null = null;
let preparedCapture = '';
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let suspendedTimer: ReturnType<typeof setTimeout> | null = null;
// Au-delà, une suspension n’est plus un changement de sortie ou une mise en veille brève.
const suspensionGraceMs = 3000;
const listeners = new Set<() => void>();
const worklets = new WeakMap<AudioContext, Promise<void>>();
/** One registration per context, shared by permission preparation and every session. */
export function preparePcmWorklet(value: AudioContext): Promise<void> {
  let loading = worklets.get(value);
  if (!loading) {
    loading = value.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
    worklets.set(value, loading);
    void loading.catch(() => worklets.delete(value));
  }
  return loading;
}
export const audioPreparation = () => state;
export function subscribeAudioPreparation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(next: Preparation) {
  state = next;
  listeners.forEach((listener) => listener());
}
export function invalidateAudioPreparation(error: string | null = null) {
  generation++;
  if (suspendedTimer) clearTimeout(suspendedTimer);
  suspendedTimer = null;
  releasePreparedMicrophone();
  publish({ ready: false, busy: false, error });
}
/**
 * Un seul contexte audio pour la page. Une suspension brève n’invalide plus la voix :
 * `setSinkId` (choix de la sortie, son d’ouverture) suspend puis relance le contexte, et
 * invalider exigeait un nouveau clic sur le miroir.
 */
function sharedContext(): AudioContext {
  if (context && context.state !== 'closed') return context;
  const created = new AudioContext();
  context = created;
  created.addEventListener?.('statechange', () => {
    if (context !== created || !state.ready) return;
    if (created.state === 'running') {
      if (suspendedTimer) clearTimeout(suspendedTimer);
      suspendedTimer = null;
      return;
    }
    if (created.state === 'closed') {
      invalidateAudioPreparation(
        'Le son a été coupé par le navigateur. Activez à nouveau la voix.',
      );
      return;
    }
    void created.resume().catch(() => {});
    suspendedTimer ??= setTimeout(() => {
      suspendedTimer = null;
      if (context === created && state.ready && created.state !== 'running')
        invalidateAudioPreparation(
          'Le son a été suspendu par le navigateur. Activez à nouveau la voix.',
        );
    }, suspensionGraceMs);
  });
  return created;
}
/** Sortie choisie dans l’administration, appliquée pendant la préparation et non à l’ouverture. */
async function applySpeaker(value: AudioContext) {
  // Délai borné : un setSinkId qui ne répond pas ne doit pas bloquer « Activer la voix ».
  await Promise.race([
    useSpeaker(value),
    new Promise<void>((resolve) => setTimeout(resolve, 1000)),
  ]);
}
export function releasePreparedMicrophone() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  microphone?.getTracks().forEach((track) => track.stop());
  microphone = null;
}
export function preparedAudioContext() {
  return context ?? new AudioContext();
}
/** Contexte audio déjà activé par l’utilisateur, sans en créer un nouveau. */
export function runningAudioContext(): AudioContext | null {
  return context?.state === 'running' ? context : null;
}
export function releaseAudioContext(value: AudioContext) {
  if (value !== context) void value.close();
}
export function takePreparedMicrophone() {
  if (preparedCapture !== captureKey()) releasePreparedMicrophone();
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  const stream = microphone;
  microphone = null;
  if (stream?.getAudioTracks().some((track) => track.readyState === 'ended')) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
  return stream;
}
export function microphoneConstraints(): MediaStreamConstraints {
  const { microphone: device, noiseSuppression, autoGainControl } = audioPreferences();
  return {
    audio: {
      // Toujours active : GPT-Live écoute pendant qu’il parle et compte sur l’écho retiré ici.
      echoCancellation: true,
      noiseSuppression,
      autoGainControl,
      channelCount: 1,
      ...(device ? { deviceId: { exact: device } } : {}),
    },
  };
}
/** Called by a gesture before any paid session starts; captured tracks remain disabled. */
export function prepareAudio(): Promise<void> {
  if (state.ready) return Promise.resolve();
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error(
      'Micro inaccessible depuis cette adresse : ouvrez le miroir en https, ou sur cet ordinateur.',
    );
    publish({ ready: false, busy: false, error: error.message });
    return Promise.reject(error);
  }
  const audio = sharedContext();
  // Invoke resume synchronously inside the click, never after a permission await.
  const resumed = audio.resume().catch(() => {});
  const workletReady = preparePcmWorklet(audio);
  // Permission may still be pending when loading fails; consume the rejection now.
  void workletReady.catch(() => {});
  if (pending) return pending;
  const revision = generation;
  publish({ ready: false, busy: true, error: null });
  pending = (async () => {
    try {
      if (!microphone) {
        preparedCapture = captureKey();
        const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints());
        if (revision !== generation) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error('Préparation audio annulée.');
        }
        microphone = stream;
      }
      microphone.getTracks().forEach((track) => {
        track.enabled = false;
      });
      await Promise.race([resumed, new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
      await workletReady;
      if (revision !== generation) throw new Error('Préparation audio annulée.');
      if (audio.state === 'running') await applySpeaker(audio);
      if (revision !== generation) throw new Error('Préparation audio annulée.');
      if (audio.state !== 'running')
        throw new Error('Son bloqué par le navigateur. Touchez à nouveau « Activer la voix ».');
      if (releaseTimer) clearTimeout(releaseTimer);
      releaseTimer = setTimeout(releasePreparedMicrophone, 15_000);
      publish({ ready: true, busy: false, error: null });
      void watchPermission();
    } catch (failure) {
      if (revision !== generation) throw failure;
      const name = (failure as Error).name;
      const message =
        name === 'NotAllowedError'
          ? 'Microphone refusé. Autorisez-le pour ce site dans le navigateur, puis réessayez.'
          : name === 'NotFoundError'
            ? 'Aucun micro détecté. Branchez-en un, puis réessayez.'
            : name === 'OverconstrainedError'
              ? 'Le micro choisi dans l’administration est introuvable. Branchez-le, ou choisissez-en un autre.'
              : name === 'NotReadableError'
                ? 'Micro occupé par une autre application. Fermez-la, puis réessayez.'
                : (failure as Error).message;
      releasePreparedMicrophone();
      publish({ ready: false, busy: false, error: message });
      throw new Error(message);
    } finally {
      pending = null;
    }
  })();
  return pending;
}
async function watchPermission() {
  try {
    permission ??= await navigator.permissions.query({ name: 'microphone' as PermissionName });
    permission.onchange = () => {
      if (permission?.state !== 'granted')
        invalidateAudioPreparation('L’autorisation du micro a changé. Activez à nouveau la voix.');
    };
    return permission;
  } catch {
    return null;
  }
}
/**
 * Préparation sans geste : possible quand le micro est déjà autorisé pour ce site et que le
 * navigateur laisse démarrer le son pour ce site. Le son est
 * vérifié avant d’ouvrir le micro, pour ne pas l’allumer et l’éteindre à chaque tentative.
 */
export async function restoreAudioPermission() {
  const permission = await watchPermission();
  if (state.ready || state.busy || permission?.state !== 'granted') return;
  const audio = sharedContext();
  if (audio.state !== 'running')
    await Promise.race([
      audio.resume().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  if (audio.state !== 'running' || state.ready || state.busy) return;
  try {
    await prepareAudio();
  } catch {
    /* A visible button offers another attempt. */
  }
}
