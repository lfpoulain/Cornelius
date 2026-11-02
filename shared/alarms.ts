/** Alarmes, minuteurs et rappels : échéances du foyer ou d'une personne, tenues par le serveur. */

import { ADMISSION_SOUNDS, ADMISSION_SOUND_LABELS } from './admission-sound.js';

export type AlarmKind = 'alarm' | 'timer' | 'reminder';

/**
 * `scheduled` : en attente de `nextAt` ; `ringing` : sonne depuis `firedAt` ; `snoozed` :
 * repoussée à `nextAt` ; `done` : terminée ; `missed` : sonnée sans réponse ou passée pendant
 * un arrêt. Une échéance répétée revient à `scheduled` et garde la trace dans `missedAt`.
 */
export type AlarmState = 'scheduled' | 'ringing' | 'snoozed' | 'done' | 'missed';

/** Jours de la semaine, lundi d'abord ; le masque `days` met le bit `1 << index`. */
export const ALARM_DAYS = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const;
export type AlarmDay = (typeof ALARM_DAYS)[number];
export const ALARM_WEEKDAYS = 0b0011111;
export const ALARM_EVERY_DAY = 0b1111111;

export const ALARM_KIND_LABELS: Readonly<Record<AlarmKind, string>> = {
  alarm: 'Réveil',
  timer: 'Minuteur',
  reminder: 'Rappel',
};

/** Échéances actives au plus pour une même personne (ou pour le foyer). */
export const ALARMS_ACTIVE_MAX = 20;
export const ALARM_LABEL_MAX = 120;
export const TIMER_MIN_MS = 5_000;
export const TIMER_MAX_MS = 24 * 3_600_000;
/** Une échéance se donne au plus un an à l'avance. */
export const ALARM_HORIZON_MS = 366 * 24 * 3_600_000;
/** « Répète » : la sonnerie revient après ce délai. */
export const ALARM_SNOOZE_MS = 10 * 60_000;
/** Une échéance passée de moins que ce délai (serveur arrêté, veille) sonne encore. */
export const ALARM_CATCH_UP_MS = 15 * 60_000;
/** Les échéances terminées ou manquées restent visibles ce temps dans l'administration. */
export const ALARM_RETENTION_MS = 7 * 24 * 3_600_000;
export const ALARM_RING_MINUTES_MIN = 1;
export const ALARM_RING_MINUTES_MAX = 30;

/**
 * Sonneries des réveils et minuteurs : deux insistantes, puis les sons d'ouverture joués en
 * boucle. Un rappel garde un carillon doux, plus espacé.
 */
export const ALARM_SOUNDS = ['bips', 'alerte', ...ADMISSION_SOUNDS] as const;
export type AlarmSoundId = (typeof ALARM_SOUNDS)[number];

export const ALARM_SOUND_LABELS: Readonly<Record<AlarmSoundId, { label: string; detail: string }>> =
  {
    bips: { label: 'Bips', detail: 'Quatre bips rapides, comme un réveil classique.' },
    alerte: { label: 'Alerte', detail: 'Deux tons alternés, montants, difficiles à ignorer.' },
    ...ADMISSION_SOUND_LABELS,
  };

export function isAlarmSoundId(value: unknown): value is AlarmSoundId {
  return typeof value === 'string' && (ALARM_SOUNDS as readonly string[]).includes(value);
}

export interface AlarmSettings {
  /** Désactivé : rien ne sonne, et Cornelius ne propose plus d'en créer. */
  enabled: boolean;
  /** Une sonnerie sans réponse s'arrête seule après ce nombre de minutes. */
  ringMinutes: number;
  /** Sonnerie des réveils et des minuteurs. */
  sound: AlarmSoundId;
}

export const DEFAULT_ALARM_SETTINGS: Readonly<AlarmSettings> = {
  enabled: true,
  ringMinutes: 5,
  sound: 'bips',
};

/** Ce qui sonne, tel que le miroir le montre. */
export interface RingingAlarm {
  id: string;
  kind: AlarmKind;
  /** « Réveil · 07:00 », « Minuteur · pâtes », « Rappel pour Sacha ». */
  title: string;
  /** Texte du rappel ou nom ; null quand il reste privé (propriétaire absent). */
  text: string | null;
  firedAt: number;
  /** Un rappel sonne doucement ; réveils et minuteurs avec la sonnerie choisie. */
  soft: boolean;
}

/** Part de l'état du miroir propre aux alarmes. */
export interface AlarmsMirrorState {
  ringing: RingingAlarm[];
  sound: AlarmSoundId;
}

export interface Alarm {
  id: string;
  kind: AlarmKind;
  /** null : échéance du foyer, visible par tous. */
  profileId: string | null;
  /** Nom d'un minuteur (« pâtes »), d'un réveil, ou texte d'un rappel ; vide : aucun. */
  label: string;
  /** Heure locale « HH:MM » d'un réveil ou d'un rappel ; null pour un minuteur. */
  time: string | null;
  /** Jours de répétition (masque, lundi = 1) ; 0 : une seule fois. */
  days: number;
  /** Durée d'un minuteur ; null sinon. */
  durationMs: number | null;
  /** Où sonner : `mirror`, ou l'identifiant du satellite d'où vient la demande. */
  target: string;
  /** Prochaine échéance (ms UTC) ; null : plus rien à faire. */
  nextAt: number | null;
  state: AlarmState;
  firedAt: number | null;
  /** Dernière échéance manquée, pas encore signalée à la personne. */
  missedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Demande de création, venue de l'administration ou de la voix. */
export interface AlarmRequest {
  kind: AlarmKind;
  profileId: string | null;
  label: string;
  /** « HH:MM » : réveil, ou rappel à heure fixe. */
  time: string | null;
  /** « AAAA-MM-JJ » : une date précise ; null : la prochaine fois que l'heure arrive. */
  date: string | null;
  days: number;
  /** Minuteur. */
  durationMs: number | null;
  /** Rappel relatif : « dans 20 minutes ». */
  inMinutes: number | null;
  target?: string;
}

export interface AlarmView extends Alarm {
  /** Prochaine échéance en clair, dans le fuseau du foyer : « mardi 3 novembre à 07:00 ». */
  atLocal: string | null;
  missedAtLocal: string | null;
}

export interface AlarmsView {
  settings: AlarmSettings;
  alarms: AlarmView[];
  timeZone: string;
}

/** Jours d'un masque, dans l'ordre de la semaine. */
export function alarmDays(mask: number): AlarmDay[] {
  return ALARM_DAYS.filter((_, index) => mask & (1 << index));
}

/** Répétition en clair : « tous les jours », « en semaine », « lundi, jeudi ». */
export function alarmRepeatLabel(mask: number): string | null {
  if (!mask) return null;
  if (mask === ALARM_EVERY_DAY) return 'tous les jours';
  if (mask === ALARM_WEEKDAYS) return 'en semaine';
  if (mask === 0b1100000) return 'le week-end';
  return alarmDays(mask).join(', ');
}
