import type { DatabaseSync } from 'node:sqlite';

/** Clés saisies dans l’administration (rejouable). Elles passent avant celles du fichier .env. */
export const secretsMigration = `CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;`;

export type SecretSource = 'admin' | 'env';

/**
 * Clés OpenAI/Groq et jetons des modules, nommés par leur variable du fichier .env. Une valeur saisie
 * dans l’administration (base locale) passe avant celle de .env ; l’effacer fait revenir celle
 * de .env. Aucune valeur ne quitte le serveur : l’administration n’en voit que la fin.
 */
export class SecretStore {
  private readonly listeners = new Set<(name: string) => void>();
  constructor(
    private readonly db: DatabaseSync,
    private readonly env: (name: string) => string | undefined,
    private readonly now: () => number = Date.now,
  ) {}
  private stored(name: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM secrets WHERE name = ?').get(name);
    return row ? String(row.value) : undefined;
  }
  get(name: string): string | undefined {
    const value = this.stored(name) ?? this.env(name);
    return value && value.trim() ? value.trim() : undefined;
  }
  source(name: string): SecretSource | null {
    if (this.stored(name)?.trim()) return 'admin';
    return this.env(name)?.trim() ? 'env' : null;
  }
  /** Les quatre derniers caractères, pour reconnaître la clé sans la dévoiler. */
  hint(name: string): string | null {
    const value = this.get(name);
    return value && value.length >= 12 ? value.slice(-4) : null;
  }
  set(name: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO secrets (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(name, value.trim(), this.now());
    this.changed(name);
  }
  delete(name: string): void {
    this.db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
    this.changed(name);
  }
  /** Toutes les valeurs connues, pour les masquer dans le journal. */
  values(): string[] {
    return this.db
      .prepare('SELECT value FROM secrets')
      .all()
      .map((row) => String(row.value));
  }
  onChange(listener: (name: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(name: string) {
    for (const listener of this.listeners) listener(name);
  }
}

/** Valeur acceptée : une ligne, sans espace, de 8 à 512 caractères. */
export function secretValueError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Valeur invalide.';
  const text = value.trim();
  if (text.length < 8) return 'Trop court : collez la clé complète.';
  if (text.length > 512) return 'Trop long : 512 caractères au plus.';
  if (/\s/.test(text)) return 'La clé ne doit contenir ni espace ni retour à la ligne.';
  return null;
}
