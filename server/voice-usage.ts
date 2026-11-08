import type { DatabaseSync } from 'node:sqlite';
import type { VoiceUsagePeriod, VoiceUsageView } from '../shared/voice-usage.js';

/** Temps de conversation par jour, dans le fuseau du foyer (rejouable). */
export const voiceUsageMigration = `CREATE TABLE IF NOT EXISTS voice_usage (
    day TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    seconds INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
    sessions INTEGER NOT NULL DEFAULT 0 CHECK (sessions >= 0)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS voice_usage_price (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    per_minute REAL CHECK (per_minute IS NULL OR (per_minute >= 0 AND per_minute <= 10)),
    currency TEXT NOT NULL DEFAULT '$' CHECK (currency IN ('$', '€'))
  ) STRICT;
  INSERT OR IGNORE INTO voice_usage_price (id) VALUES (1);`;

/** Jours gardés : le mois précédent doit rester complet. */
const KEEP_DAYS = 70;

function dayIn(ms: number, timeZone: string): string {
  // en-CA écrit AAAA-MM-JJ.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Minutes de conversation : la voix temps réel est facturée à la durée de la session, pas au
 * nombre de questions. Le coût n’est estimé qu’avec un prix saisi dans l’administration.
 */
export class VoiceUsage {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
    private readonly timeZone: () => string,
  ) {}

  /** Une conversation fermée, comptée le jour de sa fermeture. */
  add(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const day = dayIn(this.now(), this.timeZone());
    this.db
      .prepare(
        `INSERT INTO voice_usage (day, seconds, sessions) VALUES (?, ?, 1)
        ON CONFLICT (day) DO UPDATE SET seconds = seconds + excluded.seconds, sessions = sessions + 1`,
      )
      .run(day, Math.ceil(seconds));
    const oldest = dayIn(this.now() - KEEP_DAYS * 86_400_000, this.timeZone());
    this.db.prepare('DELETE FROM voice_usage WHERE day < ?').run(oldest);
  }

  setPrice(perMinute: number | null, currency: '$' | '€'): void {
    this.db
      .prepare('UPDATE voice_usage_price SET per_minute = ?, currency = ? WHERE id = 1')
      .run(perMinute, currency);
  }

  view(): VoiceUsageView {
    const today = dayIn(this.now(), this.timeZone());
    const month = today.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const previous =
      monthNumber === 1 ? `${year - 1}-12` : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
    const price = this.db
      .prepare('SELECT per_minute, currency FROM voice_usage_price WHERE id = 1')
      .get();
    const perMinute = price?.per_minute == null ? null : Number(price.per_minute);
    const currency = price?.currency === '€' ? '€' : '$';
    const period = (where: string, value: string): VoiceUsagePeriod => {
      const row = this.db
        .prepare(
          `SELECT COALESCE(SUM(seconds), 0) AS seconds, COALESCE(SUM(sessions), 0) AS sessions
          FROM voice_usage WHERE ${where}`,
        )
        .get(value);
      const seconds = Number(row?.seconds ?? 0);
      return {
        seconds,
        sessions: Number(row?.sessions ?? 0),
        cost: perMinute === null ? null : Math.round((seconds / 60) * perMinute * 100) / 100,
      };
    };
    return {
      today: period('day = ?', today),
      month: period('substr(day, 1, 7) = ?', month),
      previousMonth: period('substr(day, 1, 7) = ?', previous),
      perMinute,
      currency,
    };
  }
}
