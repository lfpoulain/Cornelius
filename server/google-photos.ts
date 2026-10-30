import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  isGooglePhotosSettings,
  type GooglePhotosSettings,
  type GooglePhotosView,
} from '../shared/google-photos.js';
import { SCREENSAVER_IMAGE_MAX_BYTES, type ScreensaverImage } from '../shared/screensaver.js';

export const googlePhotosMigration = `CREATE TABLE IF NOT EXISTS screensaver_google_photos (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'google-photos')),
  album_url TEXT NOT NULL DEFAULT '',
  refresh_minutes INTEGER NOT NULL DEFAULT 30 CHECK (refresh_minutes BETWEEN 5 AND 1440)
) STRICT;
INSERT OR IGNORE INTO screensaver_google_photos (id) VALUES (1);`;

const MAX_PAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 500;
const unavailable =
  'Album inaccessible ou format Google Photos non reconnu. Vérifiez le partage par lien, puis réessayez.';

/** Liste fermée, y compris après chaque redirection : jamais de requête vers une URL libre. */
export function albumUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
      return null;
    if (
      url.hostname === 'photos.app.goo.gl' &&
      /^\/[A-Za-z0-9_-]+$/u.test(url.pathname) &&
      !url.search
    )
      return url.href;
    if (url.hostname !== 'photos.google.com' || !/^\/share\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname))
      return null;
    if ([...url.searchParams.keys()].some((key) => key !== 'key')) return null;
    const keys = url.searchParams.getAll('key');
    return keys.length === 1 && /^[A-Za-z0-9_-]+$/u.test(keys[0]!) ? url.href : null;
  } catch {
    return null;
  }
}

export function photoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      /^lh[3-6]\.googleusercontent\.com$/u.test(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/(?:pw\/)?[A-Za-z0-9_/-]+(?:=w2560-h2560)?$/u.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export interface AlbumPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
}

/** Lit uniquement les tableaux JSON de Google, sans exécuter de JavaScript distant. */
export function parseAlbum(html: string): AlbumPhoto[] {
  const photos = new Map<string, AlbumPhoto>();
  const visit = (root: unknown) => {
    const pending = [root];
    while (pending.length) {
      const value = pending.pop();
      if (!Array.isArray(value)) continue;
      const [id, media] = value;
      if (
        typeof id === 'string' &&
        id.length <= 256 &&
        Array.isArray(media) &&
        typeof media[0] === 'string' &&
        Number.isInteger(media[1]) &&
        Number.isInteger(media[2]) &&
        media[1] > 0 &&
        media[1] <= 50000 &&
        media[2] > 0 &&
        media[2] <= 50000
      ) {
        const url = photoUrl(media[0]);
        if (url && photos.size < MAX_IMAGES)
          photos.set(id, { id, url, width: media[1], height: media[2] });
      }
      for (let i = value.length - 1; i >= 0; i--)
        if (Array.isArray(value[i])) pending.push(value[i]);
    }
  };
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)) {
    const body = script[1]!;
    if (!body.includes('AF_initDataCallback')) continue;
    const start = /\bdata\s*:\s*(\[)/gu;
    for (const match of body.matchAll(start)) {
      const from = match.index! + match[0].length - 1;
      let depth = 0,
        quoted = false,
        escaped = false;
      for (let i = from; i < body.length; i++) {
        const char = body[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '[') depth++;
        else if (char === ']' && --depth === 0) {
          try {
            visit(JSON.parse(body.slice(from, i + 1)));
          } catch {
            /* Autre format : ignoré. */
          }
          break;
        }
      }
    }
  }
  return [...photos.values()];
}

async function boundedBody(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Réponse vide.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Réponse trop volumineuse.');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export class GooglePhotosAlbum {
  private photos: AlbumPhoto[] = [];
  private checked: number | null = null;
  private error: string | null = null;
  private pending: Promise<void> | null = null;
  private generation = 0;
  private activeImages = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private abort = new AbortController();

  constructor(
    private readonly db: DatabaseSync,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  settings(): GooglePhotosSettings {
    const row = this.db
      .prepare(
        'SELECT source, album_url, refresh_minutes FROM screensaver_google_photos WHERE id = 1',
      )
      .get()!;
    return {
      source: row.source as GooglePhotosSettings['source'],
      albumUrl: String(row.album_url),
      refreshMinutes: Number(row.refresh_minutes),
    };
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
  }
  private changed() {
    for (const listener of this.listeners) listener();
  }

  start() {
    if (this.timer || this.disposed) return;
    void this.refresh();
    this.timer = setInterval(() => {
      if (this.now() - (this.checked ?? 0) >= this.settings().refreshMinutes * 60000)
        void this.refresh();
    }, 60000);
    this.timer.unref();
  }

  configure(settings: GooglePhotosSettings) {
    if (!isGooglePhotosSettings(settings)) throw new Error('Réglages de l’album invalides.');
    const normalized = settings.albumUrl.trim();
    if (
      (normalized && !albumUrl(normalized)) ||
      (settings.source === 'google-photos' && !normalized)
    )
      throw new Error(
        'Indiquez un lien de partage Google Photos valide (photos.app.goo.gl ou photos.google.com/share).',
      );
    this.abort.abort();
    this.abort = new AbortController();
    this.generation++;
    this.pending = null;
    this.photos = [];
    this.checked = null;
    this.error = null;
    this.db
      .prepare(
        'UPDATE screensaver_google_photos SET source = ?, album_url = ?, refresh_minutes = ? WHERE id = 1',
      )
      .run(settings.source, normalized, settings.refreshMinutes);
    this.changed();
  }

  list(): ScreensaverImage[] {
    if (this.settings().source !== 'google-photos') return [];
    return this.photos.map((photo, index) => ({
      id: createHash('sha256').update(photo.id).digest('hex'),
      url:
        '/api/screensaver/google-photos/images/' +
        createHash('sha256').update(photo.id).digest('hex'),
      title: `Photo ${index + 1}`,
      credit: '',
      origin: 'google-photos',
      width: photo.width,
      height: photo.height,
    }));
  }

  revision(): string {
    return createHash('sha256').update(JSON.stringify(this.photos)).digest('hex').slice(0, 16);
  }

  view(): GooglePhotosView {
    return {
      ...this.settings(),
      count: this.photos.length,
      refreshing: !!this.pending,
      lastCheckedAt: this.checked,
      error: this.error,
      images: this.list().slice(0, 4),
    };
  }

  private async get(url: string, kind: 'album' | 'photo'): Promise<Response> {
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]);
    for (let hop = 0; hop < 5; hop++) {
      if (!(kind === 'album' ? albumUrl(url) : photoUrl(url))) throw new Error(unavailable);
      const response = await this.fetcher(url, {
        redirect: 'manual',
        credentials: 'omit',
        signal,
        headers: { 'User-Agent': 'Cornelius (https://github.com/lfpoulain/Cornelius)' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const target = response.headers.get('location');
        if (!target) throw new Error(unavailable);
        url = new URL(target, url).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(unavailable);
      }
      return response;
    }
    throw new Error(unavailable);
  }

  refresh(): Promise<void> {
    if (this.disposed || this.settings().source !== 'google-photos') return Promise.resolve();
    if (this.pending) return this.pending;
    // Une relance manuelle ne doit pas devenir une boucle de requêtes vers Google.
    if (this.checked !== null && this.now() - this.checked < 60000) return Promise.resolve();
    const generation = this.generation;
    const url = this.settings().albumUrl;
    const task = (async () => {
      try {
        const response = await this.get(url, 'album');
        const html = new TextDecoder().decode(await boundedBody(response, MAX_PAGE_BYTES));
        const photos = parseAlbum(html);
        if (!photos.length) throw new Error(unavailable);
        if (generation !== this.generation || this.disposed) return;
        this.photos = photos;
        this.error = null;
      } catch {
        if (generation !== this.generation || this.disposed) return;
        // Ne garde pas les photos d'un album dont le partage a pu être révoqué.
        this.photos = [];
        this.error = unavailable;
      } finally {
        if (generation === this.generation && !this.disposed) {
          this.checked = this.now();
          this.pending = null;
          this.changed();
        }
      }
    })();
    this.pending = task;
    this.changed();
    return task;
  }

  async image(id: string): Promise<Uint8Array | null> {
    if (this.disposed || this.settings().source !== 'google-photos' || this.activeImages >= 8)
      return null;
    const generation = this.generation;
    const photo = this.photos.find(
      (entry) => createHash('sha256').update(entry.id).digest('hex') === id,
    );
    if (!photo) return null;
    this.activeImages++;
    try {
      // Dimensions plafonnées pour le miroir ; aucune image écrite sur disque.
      const response = await this.get(photo.url + '=w2560-h2560', 'photo');
      const bytes = await boundedBody(response, SCREENSAVER_IMAGE_MAX_BYTES);
      return generation === this.generation &&
        !this.disposed &&
        this.photos.some((entry) => entry.id === photo.id && entry.url === photo.url)
        ? bytes
        : null;
    } catch {
      return null;
    } finally {
      this.activeImages--;
    }
  }

  async dispose() {
    this.disposed = true;
    this.abort.abort();
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    this.listeners.clear();
  }
}
