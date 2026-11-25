/**
 * Lecteur audio du miroir : ce qui joue, tel que le serveur le diffuse, et le volume que le
 * miroir en tire selon la conversation. Le flux lui-même passe par le serveur
 * (`/api/player/<id>/stream`, ou `/api/player/<id>/hls` pour un flux HLS) : le miroir ne
 * contacte jamais l'hôte d'un module.
 */

export const PLAYER_VOLUME_MAX = 10;
export const PLAYER_VOLUME_DEFAULT = 6;
/** Un cran de « plus fort » ou « moins fort ». */
export const PLAYER_VOLUME_STEP = 2;
/** Part du volume gardée par un flux en direct quand Cornelius écoute ou réfléchit. */
export const PLAYER_DUCK_RATIO = 0.15;

export interface PlayerMirrorState {
  /** Lecture en cours ; le flux et le logo se lisent sous `/api/player/<id>/…`. */
  id: string;
  title: string;
  subtitle: string | null;
  /** Logo disponible à `/api/player/<id>/image`. */
  image: boolean;
  kind: 'live' | 'file';
  /**
   * `direct` : flux lu par `/api/player/<id>/stream`. `hls` : liste HLS (`.m3u8`) lue par
   * hls.js sous `/api/player/<id>/hls`, chaque adresse réécrite par le serveur.
   */
  format: 'direct' | 'hls';
  /** `loading` jusqu'à ce que le miroir entende le flux. */
  status: 'loading' | 'playing';
  /** Volume réglé, de 0 à 10. */
  volume: number;
}

export interface PlayerContext {
  /** Conversation tenue par le miroir lui-même (pas par un satellite). */
  conversation: boolean;
  /** Cornelius parle. */
  speaking: boolean;
  /** Une alarme sonne sur le miroir. */
  alarm: boolean;
}

/**
 * Ce que le miroir fait du son, de 0 à 1, et s'il doit mettre en pause. Un flux en direct
 * continue sans son (pas de retard au retour) ; un fichier se met en pause et reprendra.
 */
export function playerOutput(
  kind: PlayerMirrorState['kind'],
  volume: number,
  context: PlayerContext,
): { gain: number; paused: boolean } {
  const base = Math.min(1, Math.max(0, volume / PLAYER_VOLUME_MAX));
  const quiet = context.conversation || context.speaking || context.alarm;
  if (!quiet) return { gain: base, paused: false };
  if (kind === 'file') return { gain: base, paused: true };
  if (context.speaking || context.alarm) return { gain: 0, paused: false };
  return { gain: base * PLAYER_DUCK_RATIO, paused: false };
}
