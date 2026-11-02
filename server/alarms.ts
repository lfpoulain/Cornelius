import {
  ALARM_CATCH_UP_MS,
  ALARM_HORIZON_MS,
  ALARM_LABEL_MAX,
  ALARM_RETENTION_MS,
  ALARMS_ACTIVE_MAX,
  TIMER_MAX_MS,
  TIMER_MIN_MS,
  type Alarm,
  type AlarmRequest,
  type AlarmSettings,
  type AlarmsView,
  type AlarmView,
} from '../shared/alarms.js';
import type { AlarmChange, AlarmsRepository } from './alarms-store.js';
import type { DiagnosticLog } from './logs.js';

/** Une date du calendrier local, sans heure. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Date et heure murales d'un instant dans le fuseau donné. */
export function localParts(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(at)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return parts;
}

/** Écart entre l'heure murale et l'heure UTC à cet instant (+1 h à Paris en hiver). */
function offsetAt(at: number, timeZone: string): number {
  const p = localParts(at, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (at - (at % 1000));
}

/**
 * Instant d'une heure murale. Une heure sautée au passage à l'heure d'été (2 h 30) tombe une
 * heure plus tard ; une heure vécue deux fois (automne) prend la seconde.
 */
export function zonedTime(date: LocalDate, time: string, timeZone: string): number {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

/** Jour de la semaine, lundi = 0. */
export function weekday(date: LocalDate): number {
  return (new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7;
}

export function today(at: number, timeZone: string): LocalDate {
  const { year, month, day } = localParts(at, timeZone);
  return { year, month, day };
}

/** Prochaine fois, après `after`, que l'heure murale arrive un des jours du masque (0 : tous). */
export function nextOccurrence(time: string, days: number, after: number, timeZone: string) {
  const start = today(after, timeZone);
  for (let index = 0; index <= 7; index++) {
    const date = addDays(start, index);
    if (days && !(days & (1 << weekday(date)))) continue;
    const at = zonedTime(date, time, timeZone);
    if (at > after) return at;
  }
  // Un masque non vide trouve toujours un jour dans la semaine.
  throw new Error('Aucun jour de répétition.');
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/u;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function parseDate(value: string): LocalDate | null {
  const match = datePattern.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = addDays(date, 0);
  return check.year === date.year && check.month === date.month && check.day === date.day
    ? date
    : null;
}

const localFormatters = new Map<string, Intl.DateTimeFormat>();
/** « mardi 3 novembre à 07:00 », dans le fuseau du foyer. */
export function formatLocal(at: number, timeZone: string): string {
  let formatter = localFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    localFormatters.set(timeZone, formatter);
  }
  return formatter.format(at);
}

/** Demande refusée, avec le message à afficher et le champ en cause. */
export class AlarmError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

const purgeIntervalMs = 3_600_000;

/**
 * Planificateur des alarmes, minuteurs et rappels. Il ne dépend ni de l'IA ni d'une
 * conversation : `tick()`, appelé par l'horloge du serveur, fait sonner ce qui arrive et
 * arrête ce qui sonne sans réponse. Une échéance passée pendant un arrêt sonne encore si son
 * retard reste sous `ALARM_CATCH_UP_MS`, sinon elle est notée manquée.
 */
export class Alarms {
  private listeners = new Set<() => void>();
  /** Prochain instant utile ; undefined : à relire dans la base. */
  private wake: number | null | undefined;
  private lastPurge = 0;

  constructor(
    private readonly store: AlarmsRepository,
    private readonly timeZone: string,
    private readonly logs?: DiagnosticLog,
    private readonly now: () => number = Date.now,
  ) {}

  /** Une échéance a changé (créée, sonnée, arrêtée…) : l'affichage suivra. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.wake = undefined;
    for (const listener of this.listeners) listener();
  }

  settings(): AlarmSettings {
    return this.store.settings();
  }

  saveSettings(patch: Partial<AlarmSettings>): AlarmSettings {
    const settings = this.store.saveSettings({ ...this.store.settings(), ...patch });
    this.changed();
    return settings;
  }

  private present(alarm: Alarm): AlarmView {
    return {
      ...alarm,
      atLocal: alarm.nextAt === null ? null : formatLocal(alarm.nextAt, this.timeZone),
      missedAtLocal: alarm.missedAt === null ? null : formatLocal(alarm.missedAt, this.timeZone),
    };
  }

  view(): AlarmsView {
    return {
      settings: this.store.settings(),
      alarms: this.store.list().map((alarm) => this.present(alarm)),
      timeZone: this.timeZone,
    };
  }

  get(id: string): AlarmView | null {
    const alarm = this.store.get(id);
    return alarm ? this.present(alarm) : null;
  }

  /** Vérifie la demande, calcule la première échéance et l'enregistre. */
  create(request: AlarmRequest): AlarmView {
    const now = this.now();
    const label = request.label.replace(/\s+/gu, ' ').trim();
    if (label.length > ALARM_LABEL_MAX)
      throw new AlarmError(`${ALARM_LABEL_MAX} caractères au plus.`, 'label');
    if (this.store.activeCount(request.profileId) >= ALARMS_ACTIVE_MAX)
      throw new AlarmError(`${ALARMS_ACTIVE_MAX} échéances en cours au plus par personne.`);
    if (!Number.isInteger(request.days) || request.days < 0 || request.days > 127)
      throw new AlarmError('Jours de répétition invalides.', 'days');
    let nextAt: number;
    let time: string | null = null;
    let durationMs: number | null = null;
    if (request.kind === 'timer') {
      const duration = request.durationMs;
      if (duration === null || !Number.isInteger(duration))
        throw new AlarmError('Durée du minuteur attendue.', 'durationMs');
      if (duration < TIMER_MIN_MS || duration > TIMER_MAX_MS)
        throw new AlarmError('Un minuteur dure de 5 secondes à 24 heures.', 'durationMs');
      if (request.time || request.date || request.days || request.inMinutes !== null)
        throw new AlarmError('Un minuteur n’a qu’une durée.');
      durationMs = duration;
      nextAt = now + duration;
    } else {
      if (request.kind === 'reminder' && !label)
        throw new AlarmError('Texte du rappel attendu.', 'label');
      if (request.inMinutes !== null) {
        if (!Number.isInteger(request.inMinutes) || request.inMinutes < 1)
          throw new AlarmError('Délai en minutes attendu.', 'inMinutes');
        if (request.time || request.date || request.days)
          throw new AlarmError('Un délai, ou une heure : pas les deux.');
        nextAt = now + request.inMinutes * 60_000;
      } else {
        if (!request.time || !timePattern.test(request.time))
          throw new AlarmError('Heure attendue, au format HH:MM.', 'time');
        time = request.time;
        if (request.date !== null) {
          if (request.days)
            throw new AlarmError('Une date, ou des jours de répétition : pas les deux.', 'date');
          const date = parseDate(request.date);
          if (!date) throw new AlarmError('Date invalide.', 'date');
          nextAt = zonedTime(date, time, this.timeZone);
        } else nextAt = nextOccurrence(time, request.days, now, this.timeZone);
      }
    }
    if (nextAt <= now) throw new AlarmError('Cette heure est déjà passée.', 'date');
    if (nextAt > now + ALARM_HORIZON_MS)
      throw new AlarmError('Une échéance se donne au plus un an à l’avance.', 'date');
    const alarm = this.store.create({
      kind: request.kind,
      profileId: request.profileId,
      label,
      time,
      days: time ? request.days : 0,
      durationMs,
      target: request.target ?? 'mirror',
      nextAt,
    });
    this.logs?.write('info', 'alarms', 'Échéance créée', {
      id: alarm.id,
      kind: alarm.kind,
      nextAt: new Date(nextAt).toISOString(),
    });
    this.changed();
    return this.present(alarm);
  }

  /** Arrête une sonnerie (ou un « répète ») : une échéance répétée repart pour la suivante. */
  stop(id: string): AlarmView | null {
    const alarm = this.store.get(id);
    if (!alarm || (alarm.state !== 'ringing' && alarm.state !== 'snoozed')) return null;
    const updated = this.store.update(id, this.finish(alarm, { firedAt: null }));
    this.changed();
    return updated && this.present(updated);
  }

  /** « Répète dans dix minutes » : seulement ce qui sonne. */
  snooze(id: string, delayMs: number): AlarmView | null {
    const alarm = this.store.get(id);
    if (!alarm || alarm.state !== 'ringing') return null;
    const updated = this.store.update(id, { state: 'snoozed', nextAt: this.now() + delayMs });
    this.changed();
    return updated && this.present(updated);
  }

  remove(id: string): boolean {
    const removed = this.store.delete(id);
    if (removed) this.changed();
    return removed;
  }

  ringing(): AlarmView[] {
    return this.store.ringing().map((alarm) => this.present(alarm));
  }

  /** Fin d'une occurrence : la suivante pour une échéance répétée, sinon terminée. */
  private finish(alarm: Alarm, change: AlarmChange, state: 'done' | 'missed' = 'done') {
    if (alarm.time && alarm.days)
      return {
        ...change,
        state: 'scheduled' as const,
        nextAt: nextOccurrence(alarm.time, alarm.days, this.now(), this.timeZone),
      };
    return { ...change, state, nextAt: null };
  }

  private miss(alarm: Alarm, at: number) {
    this.store.update(alarm.id, this.finish(alarm, { firedAt: null, missedAt: at }, 'missed'));
    this.logs?.write('warn', 'alarms', 'Échéance manquée', {
      id: alarm.id,
      kind: alarm.kind,
      at: new Date(at).toISOString(),
    });
  }

  private nextWake(ringMs: number): number | null {
    const times = this.store.ringing().map((alarm) => (alarm.firedAt ?? 0) + ringMs);
    const due = this.store.nextDue();
    if (due !== null) times.push(due);
    return times.length ? Math.min(...times) : null;
  }

  tick(): void {
    const now = this.now();
    if (now - this.lastPurge >= purgeIntervalMs) {
      this.lastPurge = now;
      if (this.store.purge(now - ALARM_RETENTION_MS)) this.changed();
    }
    const settings = this.store.settings();
    // Désactivé : rien ne sonne ; au retour, ce qui est trop en retard est noté manqué.
    if (!settings.enabled) return;
    const ringMs = settings.ringMinutes * 60_000;
    if (this.wake === undefined) this.wake = this.nextWake(ringMs);
    if (this.wake === null || this.wake > now) return;
    for (const alarm of this.store.ringing())
      if ((alarm.firedAt ?? 0) + ringMs <= now) this.miss(alarm, alarm.nextAt ?? now);
    for (const alarm of this.store.due(now)) {
      const scheduled = alarm.nextAt ?? now;
      if (now - scheduled > ALARM_CATCH_UP_MS) {
        this.miss(alarm, scheduled);
        continue;
      }
      this.store.update(alarm.id, { state: 'ringing', firedAt: now });
      this.logs?.write('info', 'alarms', 'Échéance arrivée', { id: alarm.id, kind: alarm.kind });
    }
    this.changed();
  }
}
