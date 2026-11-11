import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LogEntry, LogLevel } from '../shared/logs.js';

/** Only pass technical metadata. Never pass request bodies, media or provider event payloads. */
export class DiagnosticLog {
  private entries: LogEntry[] = [];
  private sequence = 0;
  private diskFailed = false;
  /** Taille du fichier courant, suivie en mémoire ; null tant qu’il n’a pas été préparé. */
  private fileBytes: number | null = null;
  constructor(
    private options: {
      file?: string;
      secrets?: string[];
      console?: boolean;
      maxBytes?: number;
    } = {},
  ) {}

  /** Masque aussi cette valeur (clé saisie dans l’administration après le démarrage). */
  addSecret(value: string | undefined) {
    if (!value) return;
    const secrets = (this.options.secrets ??= []);
    if (!secrets.includes(value)) secrets.push(value);
  }

  private clean(value: unknown, depth = 0): unknown {
    if (depth > 6) return '[truncated]';
    if (typeof value === 'string') {
      let text = value;
      for (const secret of this.options.secrets ?? [])
        if (secret) text = text.split(secret).join('[redacted]');
      return text
        .replace(/\bsk-[\w-]+/g, '[redacted]')
        .replace(/Bearer\s+[^\s,"']+/gi, 'Bearer [redacted]')
        .slice(0, 2000);
    }
    if (value instanceof Error) {
      const error = value as Error & {
        status?: number;
        code?: string;
        request_id?: string;
        cause?: unknown;
      };
      return this.clean(
        {
          name: error.name,
          message: error.message,
          stack: error.stack,
          status: error.status,
          code: error.code,
          requestId: error.request_id,
          cause: error.cause,
        },
        depth + 1,
      );
    }
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => this.clean(item, depth + 1));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 40)
          .map(([key, item]) => [
            key,
            /token|secret|password|authorization|cookie|api.?key|sdp|transcript|audio|image|arguments|embedding/i.test(
              key,
            )
              ? '[redacted]'
              : this.clean(item, depth + 1),
          ]),
      );
    return value;
  }

  write(level: LogLevel, source: string, event: string, details: Record<string, unknown> = {}) {
    const entry: LogEntry = {
      id: ++this.sequence,
      time: new Date().toISOString(),
      level,
      source,
      event,
      details: this.clean(details) as Record<string, unknown>,
    };
    this.entries.push(entry);
    if (this.entries.length > 1000) this.entries.shift();
    const line = JSON.stringify(entry) + '\n';
    if (this.options.console)
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](line.trimEnd());
    const file = this.options.file;
    if (!file || this.diskFailed) return;
    try {
      try {
        this.append(file, line);
      } catch {
        // Dossier ou fichier retiré pendant que le serveur tourne : on repart du disque, une fois.
        this.fileBytes = null;
        this.append(file, line);
      }
    } catch (error) {
      this.diskFailed = true;
      this.write(
        'error',
        'local',
        'Écriture du journal impossible ; journal en mémoire disponible',
        { error },
      );
    }
  }
  /**
   * Une ligne de journal ne coûte qu’un ajout au fichier : le dossier est créé et la taille
   * lue une seule fois, puis la taille est suivie en mémoire pour décider de la rotation.
   */
  private append(file: string, line: string) {
    const bytes = Buffer.byteLength(line);
    if (this.fileBytes === null) {
      mkdirSync(dirname(file), { recursive: true });
      this.fileBytes = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    }
    if (this.fileBytes > 0 && this.fileBytes + bytes > (this.options.maxBytes ?? 5 * 1024 * 1024)) {
      rmSync(file + '.3', { force: true });
      for (let i = 2; i >= 1; i--)
        if (statSync(file + '.' + i, { throwIfNoEntry: false }))
          renameSync(file + '.' + i, file + '.' + (i + 1));
      renameSync(file, file + '.1');
      this.fileBytes = 0;
    }
    appendFileSync(file, line, { mode: 0o600 });
    this.fileBytes += bytes;
  }
  snapshot() {
    return {
      entries: structuredClone(this.entries),
      diskAvailable: !!this.options.file && !this.diskFailed,
    };
  }
}
