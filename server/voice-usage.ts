import type { DatabaseSync } from 'node:sqlite';
import type { VoiceProvider, VoiceUsagePeriod, VoiceUsageView } from '../shared/voice-usage.js';

/**
 * Temps de conversation par jour du foyer et par fournisseur vocal (rejouable). Le fournisseur
 * est gardé pour ne jamais mélanger deux facturations dans l’historique.
 */
export const voiceUsageMigration = `CREATE TABLE IF NOT EXISTS voice_usage_days (
    day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    provider TEXT NOT NULL CHECK (provider IN ('openai', 'mistral')),
    seconds INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
    sessions INTEGER NOT NULL DEFAULT 0 CHECK (sessions >= 0),
    PRIMARY KEY (day, provider)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS voice_usage_price (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    per_minute REAL CHECK (per_minute IS NULL OR (per_minute >= 0 AND per_minute <= 10)),
    currency TEXT NOT NULL DEFAULT '$' CHECK (currency IN ('$', '€'))
  ) STRICT;
  INSERT OR IGNORE INTO voice_usage_price (id) VALUES (1);`;

/** Jours gardés : le mois précédent doit rester complet. */
const KEEP_DAYS = 70;

/**
 * Seul fournisseur dont la documentation de Cornelius décrit une facturation à la minute de
 * session. OpenAI facture aux jetons (audio, texte, délégation, recherche) : pas d’estimation.
 */
export const METERED_PROVIDER: VoiceProvider = 'mistral';

/**
 * Mesures du contrôleur → temps de conversation : chaque conversation devenue prête chez le
 * fournisseur, à sa clôture. Une écriture qui échoue est signalée sans rien interrompre.
 */
export function voiceUsageMeasure(
  usage: Pick<VoiceUsage, 'add'>,
  provider: () => VoiceProvider,
  onError: (error: unknown) => void,
): (name: string, details: Record<string, unknown>) => void {
  return (name, details) => {
    if (name !== 'cloture' || details.ready !== true || typeof details.seconds !== 'number') return;
    try {
      usage.add(details.seconds, provider());
    } catch (error) {
      onError(error);
    }
  };
}

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
 * Minutes de conversation par fournisseur. Le coût n’est estimé que pour le temps passé avec le
 * fournisseur facturé à la durée, et seulement avec un prix saisi dans l’administration.
 */
export class VoiceUsage {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
    private readonly timeZone: () => string,
    private readonly provider: () => VoiceProvider = () => 'openai',
  ) {}

  /** Une conversation fermée, comptée le jour de sa fermeture, chez son fournisseur. */
  add(seconds: number, provider: VoiceProvider): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    if (provider !== 'openai' && provider !== 'mistral') return;
    const day = dayIn(this.now(), this.timeZone());
    this.db
      .prepare(
        `INSERT INTO voice_usage_days (day, provider, seconds, sessions) VALUES (?, ?, ?, 1)
        ON CONFLICT (day, provider) DO UPDATE SET seconds = seconds + excluded.seconds,
        sessions = sessions + 1`,
      )
      .run(day, provider, Math.ceil(seconds));
    const oldest = dayIn(this.now() - KEEP_DAYS * 86_400_000, this.timeZone());
    this.db.prepare('DELETE FROM voice_usage_days WHERE day < ?').run(oldest);
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
          `SELECT COALESCE(SUM(seconds), 0) AS seconds, COALESCE(SUM(sessions), 0) AS sessions,
          COALESCE(SUM(CASE WHEN provider = ? THEN seconds END), 0) AS metered
          FROM voice_usage_days WHERE ${where}`,
        )
        .get(METERED_PROVIDER, value);
      const meteredSeconds = Number(row?.metered ?? 0);
      return {
        seconds: Number(row?.seconds ?? 0),
        sessions: Number(row?.sessions ?? 0),
        meteredSeconds,
        cost: perMinute === null ? null : Math.round((meteredSeconds / 60) * perMinute * 100) / 100,
      };
    };
    return {
      today: period('day = ?', today),
      month: period('substr(day, 1, 7) = ?', month),
      previousMonth: period('substr(day, 1, 7) = ?', previous),
      perMinute,
      currency,
      provider: this.provider(),
      meteredProvider: METERED_PROVIDER,
    };
  }
}
