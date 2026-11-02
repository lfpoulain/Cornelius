import { isAdmissionSoundId } from '../../shared/admission-sound';
import type { AlarmSoundId } from '../../shared/alarms';
import { playAdmissionSound, useSpeaker } from './admission-sound';

// Sonneries synthétisées localement, comme les sons d'ouverture : aucun fichier audio.

/** Un bip carré bref ; renvoie sa fin. */
function beep(
  context: BaseAudioContext,
  output: AudioNode,
  start: number,
  frequency: number,
  length: number,
  type: OscillatorType = 'square',
) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(0.18, start + 0.006);
  envelope.gain.setValueAtTime(0.18, start + length - 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(envelope).connect(output);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
  return start + length;
}

const insistent: Record<
  'bips' | 'alerte',
  (c: BaseAudioContext, o: AudioNode, t: number) => number
> = {
  bips: (context, output, t) =>
    Math.max(...[0, 1, 2, 3].map((index) => beep(context, output, t + index * 0.16, 1046.5, 0.09))),
  alerte: (context, output, t) =>
    Math.max(
      ...[0, 1, 2, 3].map((index) =>
        beep(context, output, t + index * 0.22, index % 2 ? 880 : 660, 0.2, 'triangle'),
      ),
    ),
};

/**
 * Joue une fois la sonnerie à ce volume (0 à 1) ; renvoie sa durée en secondes. Les sons
 * d'ouverture passent par leur propre synthèse.
 */
export function playAlarmSound(context: BaseAudioContext, sound: AlarmSoundId, volume: number) {
  if (isAdmissionSoundId(sound)) {
    const master = context.createGain();
    master.gain.value = volume;
    master.connect(context.destination);
    const duration = playAdmissionSound(context, sound, master);
    setTimeout(() => master.disconnect(), Math.ceil(duration * 1000) + 200);
    return duration;
  }
  const master = context.createGain();
  master.gain.value = volume;
  master.connect(context.destination);
  const start = context.currentTime + 0.02;
  const end = insistent[sound](context, master, start);
  setTimeout(() => master.disconnect(), Math.ceil((end - context.currentTime) * 1000) + 200);
  return end - start;
}

/** Sortie choisie pour la voix, puis la sonnerie. */
export async function ringAlarm(context: AudioContext, sound: AlarmSoundId, volume: number) {
  await useSpeaker(context);
  if (context.state === 'running') playAlarmSound(context, sound, volume);
}

/** Aperçu dans l'administration : un contexte dédié, ouvert par le clic puis fermé. */
export async function previewAlarmSound(sound: AlarmSoundId) {
  const context = new AudioContext();
  await context.resume().catch(() => {});
  await useSpeaker(context);
  const duration = playAlarmSound(context, sound, 0.8);
  setTimeout(() => void context.close(), Math.ceil(duration * 1000) + 300);
}
