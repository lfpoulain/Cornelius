import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_ALARM_SETTINGS,
  isAlarmSoundId,
  type Alarm,
  type AlarmKind,
  type AlarmSettings,
  type AlarmState,
} from '../shared/alarms.js';

/**
 * Alarmes, minuteurs et rappels. Tout l'état du planificateur est dans `next_at` et `state` :
 * un redémarrage ne perd rien. Une échéance personnelle part avec son profil.
 */
export const alarmsMigration = `CREATE TABLE IF NOT EXISTS alarm_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  ring_minutes INTEGER NOT NULL DEFAULT 5 CHECK (ring_minutes BETWEEN 1 AND 30),
  sound TEXT NOT NULL DEFAULT 'bips'
) STRICT;
INSERT OR IGNORE INTO alarm_settings (id) VALUES (1);
CREATE TABLE IF NOT EXISTS alarms (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('alarm', 'timer', 'reminder')),
  profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  time_local TEXT,
  days INTEGER NOT NULL DEFAULT 0 CHECK (days BETWEEN 0 AND 127),
  duration_ms INTEGER,
  target TEXT NOT NULL DEFAULT 'mirror',
  next_at INTEGER,
  state TEXT NOT NULL CHECK (state IN ('scheduled', 'ringing', 'snoozed', 'done', 'missed')),
  fired_at INTEGER,
  missed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS alarms_due ON alarms (state, next_at);`;

/** États où l'échéance compte encore : elle attend, sonne ou est repoussée. */
export const ACTIVE_STATES: readonly AlarmState[] = ['scheduled', 'ringing', 'snoozed'];

const alarmOf = (row: Record<string, unknown>): Alarm => ({
  id: String(row.id),
  kind: row.kind as AlarmKind,
  profileId: row.profile_id === null ? null : String(row.profile_id),
  label: String(row.label),
  time: row.time_local === null ? null : String(row.time_local),
  days: Number(row.days),
  durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
  target: String(row.target),
  nextAt: row.next_at === null ? null : Number(row.next_at),
  state: row.state as AlarmState,
  firedAt: row.fired_at === null ? null : Number(row.fired_at),
  missedAt: row.missed_at === null ? null : Number(row.missed_at),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

export type NewAlarm = Pick<
  Alarm,
  'kind' | 'profileId' | 'label' | 'time' | 'days' | 'durationMs' | 'target' | 'nextAt'
>;
export type AlarmChange = Partial<Pick<Alarm, 'nextAt' | 'state' | 'firedAt' | 'missedAt'>>;

export class AlarmsRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  settings(): AlarmSettings {
    const row = this.db.prepare('SELECT * FROM alarm_settings WHERE id = 1').get();
    if (!row) return { ...DEFAULT_ALARM_SETTINGS };
    return {
      enabled: row.enabled === 1,
      ringMinutes: Number(row.ring_minutes),
      sound: isAlarmSoundId(row.sound) ? row.sound : DEFAULT_ALARM_SETTINGS.sound,
    };
  }

  saveSettings(settings: AlarmSettings): AlarmSettings {
    this.db
      .prepare('UPDATE alarm_settings SET enabled = ?, ring_minutes = ?, sound = ? WHERE id = 1')
      .run(settings.enabled ? 1 : 0, settings.ringMinutes, settings.sound);
    return this.settings();
  }

  /** Toutes les échéances, la plus proche d'abord ; celles sans échéance à la fin. */
  list(): Alarm[] {
    return this.db
      .prepare(
        'SELECT * FROM alarms ORDER BY next_at IS NULL, next_at, COALESCE(missed_at, updated_at) DESC, rowid',
      )
      .all()
      .map(alarmOf);
  }

  get(id: string): Alarm | null {
    const row = this.db.prepare('SELECT * FROM alarms WHERE id = ?').get(id);
    return row ? alarmOf(row) : null;
  }

  /** Échéances actives d'une personne, ou du foyer avec `null`. */
  activeCount(profileId: string | null): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM alarms WHERE profile_id IS ? AND state IN (${ACTIVE_STATES.map(() => '?').join(', ')})`,
      )
      .get(profileId, ...ACTIVE_STATES);
    return Number(row?.count ?? 0);
  }

  /** Échéances arrivées : en attente ou repoussées, dont l'heure est passée. */
  due(at: number): Alarm[] {
    return this.db
      .prepare(
        "SELECT * FROM alarms WHERE state IN ('scheduled', 'snoozed') AND next_at <= ? ORDER BY next_at, rowid",
      )
      .all(at)
      .map(alarmOf);
  }

  ringing(): Alarm[] {
    return this.db
      .prepare("SELECT * FROM alarms WHERE state = 'ringing' ORDER BY fired_at, rowid")
      .all()
      .map(alarmOf);
  }

  /** Prochain instant où le planificateur a quelque chose à faire, hors sonneries. */
  nextDue(): number | null {
    const row = this.db
      .prepare(
        "SELECT MIN(next_at) AS next FROM alarms WHERE state IN ('scheduled', 'snoozed') AND next_at IS NOT NULL",
      )
      .get();
    return row?.next === null || row?.next === undefined ? null : Number(row.next);
  }

  create(input: NewAlarm): Alarm {
    const id = randomUUID();
    const at = this.now();
    this.db
      .prepare(
        `INSERT INTO alarms (id, kind, profile_id, label, time_local, days, duration_ms, target, next_at, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      )
      .run(
        id,
        input.kind,
        input.profileId,
        input.label,
        input.time,
        input.days,
        input.durationMs,
        input.target,
        input.nextAt,
        at,
        at,
      );
    return this.get(id)!;
  }

  update(id: string, change: AlarmChange): Alarm | null {
    const columns: [string, unknown][] = [];
    if ('nextAt' in change) columns.push(['next_at', change.nextAt]);
    if ('state' in change) columns.push(['state', change.state]);
    if ('firedAt' in change) columns.push(['fired_at', change.firedAt]);
    if ('missedAt' in change) columns.push(['missed_at', change.missedAt]);
    columns.push(['updated_at', this.now()]);
    this.db
      .prepare(
        `UPDATE alarms SET ${columns.map(([name]) => `${name} = ?`).join(', ')} WHERE id = ?`,
      )
      .run(...(columns.map(([, value]) => value) as (number | string | null)[]), id);
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM alarms WHERE id = ?').run(id).changes > 0;
  }

  /** Efface les échéances terminées ou manquées depuis plus longtemps que `before`. */
  purge(before: number): number {
    return Number(
      this.db
        .prepare("DELETE FROM alarms WHERE state IN ('done', 'missed') AND updated_at < ?")
        .run(before).changes,
    );
  }
}
