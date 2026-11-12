import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Mot de passe choisi dans l’administration (empreinte scrypt seulement), rejouable. */
export const adminPasswordMigration = `CREATE TABLE IF NOT EXISTS admin_password (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;`;

export const ADMIN_PASSWORD_MIN_LENGTH = 8;

function digest(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * Compare deux secrets (mot de passe, jeton) sans que le temps de réponse renseigne sur la
 * valeur attendue : les empreintes ont toujours la même longueur.
 */
export function equalSecret(input: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(input).digest(),
    createHash('sha256').update(expected).digest(),
  );
}

/**
 * Mot de passe de l’administration : celui choisi dans l’administration s’il existe (seule son
 * empreinte est gardée), sinon CORNELIUS_ADMIN_PASSWORD du fichier .env.
 */
export class AdminPassword {
  constructor(
    private readonly db: DatabaseSync,
    private readonly envPassword: string,
    private readonly defaultPassword: string,
    private readonly now: () => number = Date.now,
  ) {}
  private stored(): string | null {
    const row = this.db.prepare('SELECT hash FROM admin_password WHERE id = 1').get();
    return row ? String(row.hash) : null;
  }
  /** admin : choisi dans l’administration ; env : celui du fichier .env. */
  source(): 'admin' | 'env' {
    return this.stored() ? 'admin' : 'env';
  }
  verify(input: string): boolean {
    const stored = this.stored();
    if (!stored) return equalSecret(input, this.envPassword);
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = digest(input, Buffer.from(salt, 'base64'));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  isDefault(): boolean {
    return !this.stored() && this.envPassword === this.defaultPassword;
  }
  set(password: string): void {
    const salt = randomBytes(16);
    const value = `scrypt$${salt.toString('base64')}$${digest(password, salt).toString('base64')}`;
    this.db
      .prepare(
        'INSERT INTO admin_password (id, hash, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at',
      )
      .run(value, this.now());
  }
}

/** Nouveau mot de passe acceptable, ou la raison du refus. */
export function newPasswordError(password: unknown, defaultPassword: string): string | null {
  if (typeof password !== 'string') return 'Mot de passe invalide.';
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH)
    return `${ADMIN_PASSWORD_MIN_LENGTH} caractères au moins.`;
  if (password.length > 256) return '256 caractères au plus.';
  if (password.trim() !== password) return 'Pas d’espace au début ni à la fin.';
  if (password === defaultPassword) return 'Choisissez un autre mot de passe que celui de départ.';
  return null;
}
