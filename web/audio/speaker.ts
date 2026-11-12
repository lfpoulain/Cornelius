import { audioPreferences } from './preferences';

/**
 * Sortie choisie dans l’administration, si le navigateur sait la choisir. Un seul endroit pour
 * la voix, les sons d’ouverture et les sonneries : tous sortent du même haut-parleur.
 */
export async function useSpeaker(context: AudioContext) {
  const { speaker } = audioPreferences();
  const output = context as AudioContext & {
    sinkId?: unknown;
    setSinkId?: (id: string) => Promise<void>;
  };
  if (!speaker || !output.setSinkId || output.sinkId === speaker) return;
  await output.setSinkId(speaker).catch(() => {});
}

/**
 * Aperçu d’un son dans l’administration : un contexte dédié, ouvert par le clic puis fermé.
 * `play` joue le son et renvoie sa durée en secondes.
 */
export async function previewSound(play: (context: AudioContext) => number) {
  const context = new AudioContext();
  await context.resume().catch(() => {});
  await useSpeaker(context);
  const duration = play(context);
  setTimeout(() => void context.close(), Math.ceil(duration * 1000) + 300);
}
