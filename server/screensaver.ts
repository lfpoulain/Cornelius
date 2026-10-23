import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  SCREENSAVER_IMAGE_MAX_BYTES,
  type ScreensaverImage,
  type ScreensaverImageType,
  type ScreensaverView,
} from '../shared/screensaver.js';
import type { DiagnosticLog } from './logs.js';
import { collectionUrl, screensaverCollection } from './screensaver-collection.js';

/** Réglages de l’écran de veille et images ajoutées (les fichiers sont dans data/screensaver). */
export const screensaverMigration = `CREATE TABLE IF NOT EXISTS screensaver_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  interval_ms INTEGER NOT NULL DEFAULT 300000 CHECK (interval_ms BETWEEN 10000 AND 86400000),
  return_delay_ms INTEGER NOT NULL DEFAULT 30000 CHECK (return_delay_ms BETWEEN 0 AND 3600000)
) STRICT;
INSERT OR IGNORE INTO screensaver_preferences (id) VALUES (1);
CREATE TABLE IF NOT EXISTS screensaver_images (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('image/jpeg', 'image/png', 'image/webp')),
  title TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  collection_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;`;

/** Transition et réveil de l’orbe, validés par le code : une valeur ajoutée plus tard n’exige pas de migration. */
export const screensaverChoicesMigration = `CREATE TABLE IF NOT EXISTS screensaver_choices (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  transition TEXT NOT NULL DEFAULT 'vortex',
  wake TEXT NOT NULL DEFAULT 'presence'
) STRICT;
INSERT OR IGNORE INTO screensaver_choices (id) VALUES (1);`;

/** Durée de l’effet de transition, réglée dans l’administration. */
export const screensaverDurationMigration = `CREATE TABLE IF NOT EXISTS screensaver_duration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  duration_ms INTEGER NOT NULL DEFAULT 1000 CHECK (duration_ms BETWEEN 300 AND 5000)
) STRICT;
INSERT OR IGNORE INTO screensaver_duration (id) VALUES (1);`;

/** Place des images à l’écran, validée par le code. */
export const screensaverLayoutMigration = `CREATE TABLE IF NOT EXISTS screensaver_layout (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fit TEXT NOT NULL DEFAULT 'canvas'
) STRICT;
INSERT OR IGNORE INTO screensaver_layout (id) VALUES (1);`;

/** Dimensions affichées de chaque image (rotation des photos comprise), pour trier par sens. */
export const screensaverSizesMigration = `CREATE TABLE IF NOT EXISTS screensaver_image_sizes (
  id TEXT PRIMARY KEY REFERENCES screensaver_images(id) ON DELETE CASCADE,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0)
) STRICT;`;

const extensions: Record<ScreensaverImageType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const idPattern = /^[0-9a-f-]{36}$/u;
const userAgent = 'Cornelius/0.2 (https://github.com/lfpoulain/Cornelius)';

/** Format reconnu aux premiers octets du fichier, quel que soit le type annoncé. */
export function imageType(data: Uint8Array): ScreensaverImageType | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a
  )
    return 'image/png';
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Largeur et hauteur telles que l’image s’affiche, lues dans l’en-tête du fichier. Une photo
 * de téléphone tournée par son orientation EXIF (5 à 8) échange les deux. null si illisible.
 */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  const sized = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;
  try {
    switch (imageType(data)) {
      case 'image/png':
        return sized(view.getUint32(16), view.getUint32(20));
      case 'image/webp': {
        const chunk = ascii(12, 16);
        if (chunk === 'VP8 ')
          return sized(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
        if (chunk === 'VP8L') {
          const bits = view.getUint32(21, true);
          return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
        }
        if (chunk === 'VP8X')
          return sized(
            (view.getUint32(24, true) & 0xffffff) + 1,
            (view.getUint32(27, true) & 0xffffff) + 1,
          );
        return null;
      }
      case 'image/jpeg': {
        let orientation = 1;
        for (let offset = 2; offset + 9 < data.length;) {
          if (data[offset] !== 0xff) return null;
          const marker = data[offset + 1]!;
          const length = view.getUint16(offset + 2);
          if (marker === 0xe1 && ascii(offset + 4, offset + 10) === 'Exif\0\0') {
            const tiff = offset + 10;
            const little = ascii(tiff, tiff + 2) === 'II';
            const directory = tiff + view.getUint32(tiff + 4, little);
            const entries = view.getUint16(directory, little);
            for (let index = 0; index < entries; index++) {
              const entry = directory + 2 + index * 12;
              if (view.getUint16(entry, little) === 0x0112)
                orientation = view.getUint16(entry + 8, little);
            }
          }
          // Images de départ (SOF), sauf DHT, JPG et DAC qui partagent la plage.
          if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            const height = view.getUint16(offset + 5);
            const width = view.getUint16(offset + 7);
            return orientation >= 5 && orientation <= 8
              ? sized(height, width)
              : sized(width, height);
          }
          offset += 2 + length;
        }
        return null;
      }
      default:
        return null;
    }
  } catch {
    // En-tête tronqué ou incohérent : le sens de l’image reste inconnu.
    return null;
  }
}

/** « vacances-2024_plage.jpg » devient « vacances 2024 plage ». */
export function titleFromName(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,5}$/iu, '')
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120);
}

interface Row {
  id: string;
  type: ScreensaverImageType;
  title: string;
  credit: string;
  collection_key: string | null;
  width: number | null;
  height: number | null;
}

export class ScreensaverLibrary {
  private downloading = false;
  private downloadError: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly db: DatabaseSync,
    readonly root: string,
    private readonly logs: DiagnosticLog,
    private readonly now: () => number = Date.now,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private rows(): Row[] {
    return this.db
      .prepare(
        `SELECT id, type, title, credit, collection_key, width, height
         FROM screensaver_images LEFT JOIN screensaver_image_sizes USING (id)
         ORDER BY created_at, id`,
      )
      .all() as unknown as Row[];
  }

  list(): ScreensaverImage[] {
    return this.rows().flatMap((row) => {
      const file = this.file(row.id);
      if (!file) return [];
      // Image ajoutée avant que Cornelius ne note les dimensions : lues une fois, puis gardées.
      const size =
        row.width && row.height
          ? { width: row.width, height: row.height }
          : this.rememberSize(row.id, readFileSync(file.path));
      return [
        {
          id: row.id,
          url: `/api/screensaver/images/${row.id}`,
          title: row.title,
          credit: row.credit,
          origin: row.collection_key ? ('collection' as const) : ('upload' as const),
          width: size?.width ?? null,
          height: size?.height ?? null,
        },
      ];
    });
  }

  private rememberSize(id: string, data: Uint8Array) {
    const size = imageSize(data);
    if (size)
      this.db
        .prepare(
          'INSERT OR REPLACE INTO screensaver_image_sizes (id, width, height) VALUES (?, ?, ?)',
        )
        .run(id, size.width, size.height);
    return size;
  }

  /** Empreinte de la liste : le miroir la relit quand elle change. */
  revision(): string {
    const ids = this.list().map((image) => image.id);
    return ids.length
      ? createHash('sha256').update(ids.join('\n')).digest('base64url').slice(0, 16)
      : '';
  }

  view(): ScreensaverView {
    const installed = new Set(this.rows().map((row) => row.collection_key));
    return {
      images: this.list(),
      collection: {
        total: screensaverCollection.length,
        installed: screensaverCollection.filter((painting) => installed.has(painting.key)).length,
        downloading: this.downloading,
        error: this.downloadError,
      },
    };
  }

  file(id: string): { path: string; type: ScreensaverImageType } | null {
    if (!idPattern.test(id)) return null;
    const row = this.db.prepare('SELECT type FROM screensaver_images WHERE id = ?').get(id) as
      { type: ScreensaverImageType } | undefined;
    if (!row) return null;
    const path = join(this.root, id + extensions[row.type]);
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    return stat.isFile() && stat.size <= SCREENSAVER_IMAGE_MAX_BYTES
      ? { path, type: row.type }
      : null;
  }

  /** Ajoute une image envoyée depuis l’administration ; null si ce n’est pas une image reconnue. */
  add(
    data: Uint8Array,
    details: { title: string; credit?: string; collectionKey?: string },
  ): ScreensaverImage | null {
    const type = imageType(data);
    if (!type || data.length > SCREENSAVER_IMAGE_MAX_BYTES) return null;
    const id = randomUUID();
    writeFileSync(join(this.root, id + extensions[type]), data, { mode: 0o600 });
    this.db
      .prepare(
        'INSERT INTO screensaver_images (id, type, title, credit, collection_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        type,
        details.title.trim().slice(0, 120) || 'Image',
        details.credit ?? '',
        details.collectionKey ?? null,
        this.now(),
      );
    this.rememberSize(id, data);
    this.changed();
    return this.list().find((image) => image.id === id) ?? null;
  }

  remove(id: string): boolean {
    return this.removeMany([id]) > 0;
  }

  /** Retire plusieurs images d’un coup ; rend le nombre d’images effectivement retirées. */
  removeMany(ids: readonly string[]): number {
    let removed = 0;
    for (const id of new Set(ids)) {
      const file = this.file(id);
      const result = this.db.prepare('DELETE FROM screensaver_images WHERE id = ?').run(id);
      if (file) rmSync(file.path, { force: true });
      removed += Number(result.changes);
    }
    // Un seul avis au miroir, même pour vingt images.
    if (removed) this.changed();
    return removed;
  }

  /**
   * Télécharge les peintures de la collection qui manquent, une à une. Rend la main tout de
   * suite ; l’administration suit l’avancement par view().
   */
  installCollection(): Promise<void> {
    if (this.downloading) return Promise.resolve();
    this.downloading = true;
    this.downloadError = null;
    this.changed();
    return this.download().finally(() => {
      this.downloading = false;
      this.changed();
    });
  }

  private async download() {
    const installed = new Set(this.rows().map((row) => row.collection_key));
    let failures = 0;
    for (const painting of screensaverCollection) {
      if (installed.has(painting.key)) continue;
      try {
        const response = await this.fetcher(collectionUrl(painting), {
          headers: { 'User-Agent': userAgent },
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (!this.add(data, { ...painting, collectionKey: painting.key }))
          throw new Error('Fichier reçu illisible.');
      } catch (error) {
        failures++;
        this.logs.write('warn', 'local', 'Peinture de l’écran de veille non téléchargée', {
          painting: painting.key,
          error,
        });
      }
    }
    if (failures)
      this.downloadError =
        failures === 1
          ? 'Une peinture n’a pas pu être téléchargée. Réessayez plus tard.'
          : `${failures} peintures n’ont pas pu être téléchargées. Vérifiez la connexion à Internet, puis réessayez.`;
    else this.logs.write('info', 'local', 'Collection de peintures installée');
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }
}
