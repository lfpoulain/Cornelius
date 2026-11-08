import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SatelliteSettings } from '../shared/satellites.js';

/**
 * Satellites audio du foyer (rejouable). Le jeton n’est jamais gardé : seulement son empreinte.
 * Les réglages (volume, anneau, écoute attentive) sont ceux de l’administration.
 */
export const satellitesMigration = `CREATE TABLE IF NOT EXISTS satellites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  token_hash TEXT NOT NULL UNIQUE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  volume INTEGER NOT NULL DEFAULT 70 CHECK (volume BETWEEN 0 AND 100),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  led_color TEXT NOT NULL DEFAULT '#00ffb4'
    CHECK (led_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  led_brightness INTEGER NOT NULL DEFAULT 6 CHECK (led_brightness BETWEEN 0 AND 10),
  night_light INTEGER NOT NULL DEFAULT 0 CHECK (night_light IN (0, 1)),
  attentive INTEGER NOT NULL DEFAULT 0 CHECK (attentive IN (0, 1))
) STRICT;`;

export { SATELLITE_NAME_MAX } from '../shared/satellites.js';

export interface Satellite extends SatelliteSettings {
  id: string;
  name: string;
  /** Profil rattaché (mémoire personnelle) ; null : satellite anonyme, le cas par défaut. */
  profileId: string | null;
  createdAt: number;
  lastSeenAt: number | null;
}

export type SatelliteChanges = Partial<SatelliteSettings> & {
  name?: string;
  profileId?: string | null;
};

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
/** Le satellite et sa fin de parole propre, s’il en a une. */
const selectSatellites = `SELECT satellites.*, satellite_silence.delay_ms AS silence_close_ms
  FROM satellites LEFT JOIN satellite_silence ON satellite_silence.satellite_id = satellites.id`;

function satellite(row: Record<string, unknown>): Satellite {
  return {
    id: String(row.id),
    name: String(row.name),
    profileId: row.profile_id === null ? null : String(row.profile_id),
    volume: Number(row.volume),
    ledColor: String(row.led_color),
    ledBrightness: Number(row.led_brightness),
    nightLight: Number(row.night_light) === 1,
    attentive: Number(row.attentive) === 1,
    silenceCloseMs: row.silence_close_ms == null ? null : Number(row.silence_close_ms),
    createdAt: Number(row.created_at),
    lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
  };
}

export class SatelliteStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
  ) {}
  list(): Satellite[] {
    return this.db
      .prepare(selectSatellites + ' ORDER BY created_at, id')
      .all()
      .map((row) => satellite(row));
  }
  get(id: string): Satellite | null {
    const row = this.db.prepare(selectSatellites + ' WHERE satellites.id = ?').get(id);
    return row ? satellite(row) : null;
  }
  /** Le jeton n’est rendu qu’ici : il faut le noter tout de suite dans le satellite. */
  create(name: string): { satellite: Satellite; token: string } {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO satellites (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, tokenHash(token), this.now());
    return { satellite: this.get(id)!, token };
  }
  /** Nouveau jeton : l’ancien cesse aussitôt de fonctionner. */
  renewToken(id: string): string | null {
    const token = randomBytes(32).toString('base64url');
    const changed = this.db
      .prepare('UPDATE satellites SET token_hash = ? WHERE id = ?')
      .run(tokenHash(token), id).changes;
    return changed ? token : null;
  }
  update(id: string, changes: SatelliteChanges): Satellite | null {
    const current = this.get(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    this.db
      .prepare(
        'UPDATE satellites SET name = ?, profile_id = ?, volume = ?, led_color = ?, led_brightness = ?, night_light = ?, attentive = ? WHERE id = ?',
      )
      .run(
        next.name,
        next.profileId,
        next.volume,
        next.ledColor,
        next.ledBrightness,
        next.nightLight ? 1 : 0,
        next.attentive ? 1 : 0,
        id,
      );
    if (changes.silenceCloseMs !== undefined) {
      if (changes.silenceCloseMs === null)
        this.db.prepare('DELETE FROM satellite_silence WHERE satellite_id = ?').run(id);
      else
        this.db
          .prepare(
            `INSERT INTO satellite_silence (satellite_id, delay_ms) VALUES (?, ?)
            ON CONFLICT (satellite_id) DO UPDATE SET delay_ms = excluded.delay_ms`,
          )
          .run(id, changes.silenceCloseMs);
    }
    return this.get(id);
  }
  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM satellites WHERE id = ?').run(id).changes > 0;
  }
  /** Satellite du jeton présenté, ou null. Le jeton est comparé par son empreinte. */
  authenticate(token: string): Satellite | null {
    if (!token || token.length > 256) return null;
    const row = this.db
      .prepare(selectSatellites + ' WHERE satellites.token_hash = ?')
      .get(tokenHash(token));
    return row ? satellite(row) : null;
  }
  seen(id: string): void {
    this.db.prepare('UPDATE satellites SET last_seen_at = ? WHERE id = ?').run(this.now(), id);
  }
}
