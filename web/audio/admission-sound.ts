import type { AdmissionSoundId } from '../../shared/admission-sound';
import { audioPreferences } from './preferences';

// Sons synthétisés localement : aucun fichier audio, aucune licence, aucune requête réseau.
type Tone = {
  type?: OscillatorType;
  frequency: number;
  /** Glissement exponentiel vers cette fréquence, sur `glide` secondes. */
  to?: number;
  glide?: number;
  start: number;
  attack?: number;
  decay: number;
  gain: number;
  detune?: number;
};
type Voice = (context: BaseAudioContext, output: AudioNode, start: number) => number;

/** Une note avec attaque courte et extinction exponentielle ; renvoie sa fin. */
function tone(context: BaseAudioContext, output: AudioNode, note: Tone): number {
  const { start, attack = 0.008, decay, gain } = note;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = note.type ?? 'sine';
  oscillator.detune.value = note.detune ?? 0;
  oscillator.frequency.setValueAtTime(note.frequency, start);
  if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, start + note.glide!);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  oscillator.connect(envelope).connect(output);
  const end = start + attack + decay + 0.05;
  oscillator.start(start);
  oscillator.stop(end);
  return end;
}

const voices: Record<AdmissionSoundId, Voice> = {
  carillon: (context, output, t) =>
    Math.max(
      tone(context, output, { frequency: 659.25, start: t, decay: 0.7, gain: 0.34 }),
      tone(context, output, { frequency: 1318.5, start: t, decay: 0.3, gain: 0.05 }),
      tone(context, output, { frequency: 987.77, start: t + 0.13, decay: 0.85, gain: 0.3 }),
      tone(context, output, { frequency: 1975.5, start: t + 0.13, decay: 0.35, gain: 0.04 }),
    ),
  goutte: (context, output, t) =>
    Math.max(
      tone(context, output, {
        frequency: 1400,
        to: 520,
        glide: 0.09,
        start: t,
        attack: 0.004,
        decay: 0.22,
        gain: 0.34,
      }),
      tone(context, output, {
        frequency: 1900,
        to: 800,
        glide: 0.07,
        start: t + 0.11,
        attack: 0.004,
        decay: 0.15,
        gain: 0.1,
      }),
    ),
  cristal: (context, output, t) =>
    Math.max(
      ...[1046.5, 1318.5, 1568].flatMap((frequency, index) => [
        tone(context, output, {
          type: 'triangle',
          frequency,
          start: t + index * 0.075,
          decay: 0.45,
          gain: 0.16,
        }),
        tone(context, output, {
          frequency,
          detune: 7,
          start: t + index * 0.075,
          decay: 0.6,
          gain: 0.05,
        }),
      ]),
    ),
  bulle: (context, output, t) =>
    Math.max(
      tone(context, output, {
        frequency: 280,
        to: 840,
        glide: 0.12,
        start: t,
        attack: 0.01,
        decay: 0.16,
        gain: 0.3,
      }),
      tone(context, output, {
        frequency: 420,
        to: 1260,
        glide: 0.1,
        start: t + 0.14,
        attack: 0.01,
        decay: 0.14,
        gain: 0.22,
      }),
    ),
  cloche: (context, output, t) => {
    // Synthèse FM : un modulateur inharmonique dont la profondeur décroît donne le métal.
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const depth = context.createGain();
    const envelope = context.createGain();
    carrier.frequency.value = 784;
    modulator.frequency.value = 784 * 2.76;
    depth.gain.setValueAtTime(784 * 1.6, t);
    depth.gain.exponentialRampToValueAtTime(1, t + 1);
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    modulator.connect(depth).connect(carrier.frequency);
    carrier.connect(envelope).connect(output);
    const end = t + 1.25;
    for (const oscillator of [carrier, modulator]) {
      oscillator.start(t);
      oscillator.stop(end);
    }
    return Math.max(
      end,
      tone(context, output, { frequency: 1568, start: t, decay: 0.5, gain: 0.04 }),
    );
  },
  souffle: (context, output, t) => {
    const length = Math.ceil(context.sampleRate * 0.7);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index++) samples[index] = Math.random() * 2 - 1;
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    noise.buffer = buffer;
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(350, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + 0.45);
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(0.22, t + 0.2);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    noise.connect(filter).connect(envelope).connect(output);
    noise.start(t);
    noise.stop(t + 0.7);
    return Math.max(
      t + 0.7,
      tone(context, output, {
        frequency: 220,
        start: t + 0.05,
        attack: 0.08,
        decay: 0.6,
        gain: 0.12,
      }),
    );
  },
};

/** Joue le son dans ce contexte ; renvoie sa durée en secondes. */
export function playAdmissionSound(
  context: BaseAudioContext,
  sound: AdmissionSoundId,
  /** Sortie déjà réglée (sonnerie d'alarme) ; sinon un volume fixe vers les haut-parleurs. */
  output?: AudioNode,
): number {
  const master = context.createGain();
  master.gain.value = 0.8;
  master.connect(output ?? context.destination);
  const start = context.currentTime + 0.02;
  const end = voices[sound](context, master, start);
  setTimeout(() => master.disconnect(), Math.ceil((end - context.currentTime) * 1000) + 100);
  return end - start;
}

/** Même sortie que la voix de Cornelius, si le navigateur sait la choisir. */
export async function useSpeaker(context: AudioContext) {
  const { speaker } = audioPreferences();
  const output = context as AudioContext & {
    sinkId?: string;
    setSinkId?: (id: string) => Promise<void>;
  };
  if (!speaker || !output.setSinkId || output.sinkId === speaker) return;
  await output.setSinkId(speaker).catch(() => {});
}

/** Annonce d’une ouverture sur le miroir, dans le contexte audio déjà activé par la voix. */
export async function announceAdmission(context: AudioContext, sound: AdmissionSoundId) {
  await useSpeaker(context);
  if (context.state === 'running') playAdmissionSound(context, sound);
}

/** Aperçu dans l’administration : un contexte dédié, ouvert par le clic puis fermé. */
export async function previewAdmissionSound(sound: AdmissionSoundId) {
  const context = new AudioContext();
  await context.resume().catch(() => {});
  await useSpeaker(context);
  const duration = playAdmissionSound(context, sound);
  setTimeout(() => void context.close(), Math.ceil(duration * 1000) + 300);
}
