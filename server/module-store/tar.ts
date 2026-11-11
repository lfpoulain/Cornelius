import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Lecture d'une archive .tar.gz de forge (GitHub, Gitea, Forgejo, GitLab), sans dépendance :
 * Node n'a pas de lecteur tar. Seuls les fichiers et dossiers ordinaires sont extraits ; les
 * liens, les chemins absolus ou remontants et les archives démesurées sont refusés. Le
 * premier dossier (« depot-<commit>/ ») est retiré : la racine de l'archive devient celle
 * du dépôt.
 */

export interface TarLimits {
  /** Taille décompressée maximale, en octets. */
  maxBytes: number;
  /** Nombre maximal de fichiers. */
  maxFiles: number;
}

export const defaultTarLimits: TarLimits = { maxBytes: 200 * 1024 * 1024, maxFiles: 5000 };

export class TarError extends Error {}

interface Entry {
  path: string;
  type: 'file' | 'directory';
  data: Buffer;
}

function text(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function octal(block: Buffer, offset: number, length: number): number {
  // Taille en base 256 (bit de poids fort) : jamais utile ici, et trop grande de toute façon.
  if ((block[offset]! & 0x80) !== 0) throw new TarError('Fichier trop volumineux dans l’archive.');
  const value = text(block, offset, length).trim();
  return value ? Number.parseInt(value, 8) : 0;
}

/** En-têtes PAX : « <longueur> clé=valeur\n », seul `path` nous intéresse. */
function paxPath(data: Buffer): string | null {
  let rest = data.toString('utf8');
  let path: string | null = null;
  while (rest.length > 0) {
    const space = rest.indexOf(' ');
    const length = Number.parseInt(rest.slice(0, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = rest.slice(space + 1, length - 1);
    const equals = record.indexOf('=');
    if (record.slice(0, equals) === 'path') path = record.slice(equals + 1);
    rest = rest.slice(length);
  }
  return path;
}

/** Entrées de l'archive décompressée, chemins relatifs à la racine du dépôt. */
export function readTarGz(archive: Buffer, limits: TarLimits = defaultTarLimits): Entry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: limits.maxBytes + 1024 * 1024 });
  } catch (error) {
    throw new TarError(
      (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE'
        ? 'Archive trop volumineuse.'
        : 'Archive illisible (gzip attendu).',
    );
  }
  const entries: Entry[] = [];
  let offset = 0;
  let longName: string | null = null;
  let total = 0;
  let fileCount = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    const flag = String.fromCharCode(header[156]!);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    if (data.length !== size) throw new TarError('Archive tronquée.');
    offset = dataStart + Math.ceil(size / 512) * 512;
    if (flag === 'g') continue;
    if (flag === 'x') {
      longName = paxPath(data);
      continue;
    }
    if (flag === 'L') {
      longName = text(data, 0, data.length);
      continue;
    }
    const prefix = text(header, 345, 155);
    const name = text(header, 0, 100);
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    const type = flag === '5' ? 'directory' : flag === '0' || flag === '\0' ? 'file' : null;
    // Liens, périphériques : ignorés, un module n'en a pas besoin.
    if (!type) continue;
    const parts = path.split('/').filter((part) => part.length > 0 && part !== '.');
    if (path.startsWith('/') || parts.some((part) => part === '..' || part.includes('\\')))
      throw new TarError(`Chemin interdit dans l’archive : ${path}`);
    // Le premier dossier est celui que la forge ajoute autour du dépôt.
    const relative = parts.slice(1).join('/');
    if (!relative) continue;
    if (type === 'file') {
      total += size;
      fileCount += 1;
      if (total > limits.maxBytes) throw new TarError('Archive trop volumineuse.');
      if (fileCount > limits.maxFiles) throw new TarError('Archive contenant trop de fichiers.');
    }
    entries.push({ path: relative, type, data: Buffer.from(data) });
  }
  return entries;
}

/** Écrit les entrées sous `target`, sans jamais sortir de ce dossier. */
export function extractTarGz(
  archive: Buffer,
  target: string,
  limits: TarLimits = defaultTarLimits,
): number {
  const root = resolve(target);
  const entries = readTarGz(archive, limits);
  mkdirSync(root, { recursive: true });
  let files = 0;
  for (const entry of entries) {
    const destination = resolve(root, entry.path);
    if (destination !== root && !destination.startsWith(root + sep))
      throw new TarError(`Chemin interdit dans l’archive : ${entry.path}`);
    if (entry.type === 'directory') {
      mkdirSync(destination, { recursive: true });
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, entry.data);
    files += 1;
  }
  return files;
}
