import { randomBytes } from 'node:crypto';
import {
  closeQuietly,
  header,
  openGuarded,
  PlayerStreamError,
  USER_AGENT,
  type Connect,
  type UpstreamResponse,
} from './player-stream.js';

/**
 * Flux HLS du miroir. Le serveur lit la liste rendue par le module et réécrit chaque adresse
 * qu'elle contient (variantes, morceaux, `EXT-X-MAP`, `URI=` de `EXT-X-MEDIA`) en
 * `/api/player/<id>/hls/<jeton>` : le miroir ne voit jamais une adresse d'origine et ne lit
 * que ce que la liste a nommé. Chaque lecture passe par la voie gardée du relais.
 */

/** Taille maximale d'une liste HLS (maîtresse ou de variante). */
export const HLS_PLAYLIST_MAX_BYTES = 512 * 1024;
/** Taille maximale d'un morceau. */
export const HLS_SEGMENT_MAX_BYTES = 8 * 1024 * 1024;
/** Jetons gardés pour une lecture : les plus anciens (morceaux déjà lus) partent d'abord. */
export const HLS_MAX_TOKENS = 512;

export type HlsRole = 'playlist' | 'segment';

interface HlsEntry {
  url: string;
  role: HlsRole;
}

/**
 * Jetons d'une lecture : opaques, en nombre borné. Une adresse déjà vue garde son jeton (une
 * liste en direct relue ne crée de jetons que pour ses nouveaux morceaux).
 */
export class HlsTokens {
  private readonly byToken = new Map<string, HlsEntry>();
  private readonly byAddress = new Map<string, string>();
  /** Un échec de morceau n'est noté qu'une fois au journal par lecture. */
  segmentFailureLogged = false;

  constructor(private readonly max = HLS_MAX_TOKENS) {}

  get size(): number {
    return this.byToken.size;
  }

  issue(url: string, role: HlsRole): string {
    const key = `${role} ${url}`;
    const known = this.byAddress.get(key);
    if (known) {
      // Remis en fin de file : une liste relue n'est pas oubliée avant ses vieux morceaux.
      const entry = this.byToken.get(known)!;
      this.byToken.delete(known);
      this.byToken.set(known, entry);
      return known;
    }
    while (this.byToken.size >= this.max) {
      const [oldest, entry] = this.byToken.entries().next().value as [string, HlsEntry];
      this.byToken.delete(oldest);
      this.byAddress.delete(`${entry.role} ${entry.url}`);
    }
    const token = randomBytes(16).toString('base64url');
    this.byToken.set(token, { url, role });
    this.byAddress.set(key, token);
    return token;
  }

  get(token: string): HlsEntry | undefined {
    return this.byToken.get(token);
  }
}

/** Jetons de la lecture en cours ; ceux d'une lecture arrêtée ou remplacée sont oubliés. */
export class HlsSessions {
  private readonly sessions = new Map<string, HlsTokens>();

  constructor(private readonly max = HLS_MAX_TOKENS) {}

  tokens(id: string): HlsTokens {
    let tokens = this.sessions.get(id);
    if (!tokens) {
      tokens = new HlsTokens(this.max);
      this.sessions.set(id, tokens);
    }
    return tokens;
  }

  find(id: string): HlsTokens | undefined {
    return this.sessions.get(id);
  }

  /** Oublie toute lecture qui ne joue plus. */
  keepOnly(playing: (id: string) => boolean) {
    for (const id of this.sessions.keys()) if (!playing(id)) this.sessions.delete(id);
  }

  get count(): number {
    return this.sessions.size;
  }
}

// --- Réécriture de la liste --------------------------------------------------------------

/** Balises retirées : faible latence, images, données de session, contrôle du serveur. */
const droppedTags = [
  '#EXT-X-PART',
  '#EXT-X-PART-INF',
  '#EXT-X-PRELOAD-HINT',
  '#EXT-X-RENDITION-REPORT',
  '#EXT-X-SERVER-CONTROL',
  '#EXT-X-SKIP',
  '#EXT-X-I-FRAME-STREAM-INF',
  '#EXT-X-IMAGE-STREAM-INF',
  '#EXT-X-SESSION-DATA',
];

/** Codecs vidéo : une variante qui en porte un est retirée s'il reste une variante audio. */
const VIDEO_CODECS = /\b(avc1|avc3|hvc1|hev1|dvh1|dvhe|vp08|vp09|vp8|vp9|av01)\b/iu;

function tagName(line: string): string {
  const colon = line.indexOf(':');
  return colon < 0 ? line : line.slice(0, colon);
}

/** Attributs d'une balise (`NOM=valeur` ou `NOM="valeur"`), noms en majuscules. */
export function attributes(line: string): Map<string, string> {
  const out = new Map<string, string>();
  const colon = line.indexOf(':');
  if (colon < 0) return out;
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gu;
  for (const match of line.slice(colon + 1).matchAll(pattern))
    out.set(match[1]!, match[2]!.replace(/^"|"$/gu, ''));
  return out;
}

function isVideoVariant(line: string): boolean {
  const attrs = attributes(line);
  return VIDEO_CODECS.test(attrs.get('CODECS') ?? '') || attrs.has('RESOLUTION');
}

/**
 * Adresse absolue d'une entrée de la liste. Une liste lue en https qui nomme une adresse http
 * (CBC Music : variantes en http dans une maîtresse https) est lue en https, comme un
 * navigateur le fait pour un média http dans une page https ; si l'hôte ne répond pas en
 * https, la voie gardée échoue comme pour toute adresse.
 */
function resolve(address: string, base: URL): string {
  try {
    const url = new URL(address.trim(), base);
    if (url.protocol === 'http:' && base.protocol === 'https:') {
      url.protocol = 'https:';
      if (url.port === '80') url.port = '';
    }
    return url.href;
  } catch {
    throw new PlayerStreamError('Liste HLS illisible.', 415);
  }
}

/**
 * Réécrit une liste HLS : chaque adresse, résolue sur l'adresse finale de la liste, devient
 * `link(adresse, rôle)`. Refuse une liste chiffrée ; retire les variantes vidéo (s'il reste
 * une variante audio), les images, la faible latence et les sous-titres ; ajoute `BANDWIDTH`
 * à une variante qui n'en a pas (hls.js l'exige).
 */
export function rewritePlaylist(
  text: string,
  base: URL,
  link: (url: string, role: HlsRole) => string,
): string {
  const lines = text.replace(/^﻿/u, '').split(/\r?\n/u);
  if (!lines[0]?.trim().startsWith('#EXTM3U'))
    throw new PlayerStreamError('Ce n’est pas une liste HLS.', 415);
  const variants = lines.filter((line) => line.startsWith('#EXT-X-STREAM-INF'));
  const audioOnly = variants.some((line) => !isVideoVariant(line));
  const out: string[] = [];
  let variantPending = false;
  let skipNextUri = false;
  const rewriteUri = (line: string, role: HlsRole) =>
    line.replace(
      /URI="([^"]*)"/u,
      (_all, uri: string) => `URI="${link(resolve(uri, base), role)}"`,
    );

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith('#')) {
      if (skipNextUri) {
        skipNextUri = false;
        continue;
      }
      out.push(link(resolve(line, base), variantPending ? 'playlist' : 'segment'));
      variantPending = false;
      continue;
    }
    if (!line.startsWith('#EXT')) continue; // commentaire
    const name = tagName(line);
    if (droppedTags.includes(name)) continue;
    if (name === '#EXT-X-KEY' || name === '#EXT-X-SESSION-KEY') {
      const method = (attributes(line).get('METHOD') ?? 'NONE').toUpperCase();
      if (method !== 'NONE')
        throw new PlayerStreamError('Flux chiffré (EXT-X-KEY) non pris en charge.', 415);
      out.push(line);
      continue;
    }
    if (name === '#EXT-X-MAP') {
      out.push(rewriteUri(line, 'segment'));
      continue;
    }
    if (name === '#EXT-X-MEDIA') {
      const type = (attributes(line).get('TYPE') ?? '').toUpperCase();
      if (type === 'SUBTITLES' || type === 'VIDEO') continue;
      out.push(rewriteUri(line, 'playlist'));
      continue;
    }
    if (name === '#EXT-X-STREAM-INF') {
      if (audioOnly && isVideoVariant(line)) {
        skipNextUri = true;
        continue;
      }
      variantPending = true;
      out.push(attributes(line).has('BANDWIDTH') ? line : line.replace(':', ':BANDWIDTH=1,'));
      continue;
    }
    out.push(line);
  }
  return out.join('\n') + '\n';
}

// --- Lecture des listes et des morceaux ---------------------------------------------------

const PLAYLIST_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/x-mpegurl',
  'audio/mpegurl',
  // Beaucoup de services servent la liste sans type précis : le contenu tranche (#EXTM3U).
  'text/plain',
  'application/octet-stream',
  'binary/octet-stream',
  '',
];

/** Types de morceaux acceptés tels quels, sur cette route seulement. */
const SEGMENT_TYPES = [
  'video/mp2t',
  'audio/aac',
  'audio/aacp',
  'audio/x-aac',
  'audio/mp4',
  'video/mp4',
  'video/iso.segment',
  'audio/mpeg',
];

function mediaType(response: UpstreamResponse): string {
  return (header(response, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
}

async function readLimited(
  response: UpstreamResponse,
  max: number,
  tooBig: string,
): Promise<Buffer> {
  const declared = Number(header(response, 'content-length'));
  if (Number.isFinite(declared) && declared > max) {
    closeQuietly(response);
    throw new PlayerStreamError(tooBig, 413);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += (chunk as Buffer).length;
    if (size > max) {
      closeQuietly(response);
      throw new PlayerStreamError(tooBig, 413);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Liste HLS lue par la voie gardée, avec son adresse finale (base des adresses relatives). */
export async function fetchPlaylist(
  address: string,
  options: { signal: AbortSignal; connect?: Connect; max?: number },
): Promise<{ text: string; url: URL }> {
  const response = await openGuarded(address, {
    signal: options.signal,
    connect: options.connect,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.apple.mpegurl, application/x-mpegurl;q=0.9, */*;q=0.5',
    },
  });
  if (!PLAYLIST_TYPES.includes(mediaType(response))) {
    closeQuietly(response);
    throw new PlayerStreamError('Ce n’est pas une liste HLS.', 415);
  }
  const body = await readLimited(
    response,
    options.max ?? HLS_PLAYLIST_MAX_BYTES,
    'Liste HLS trop lourde.',
  );
  return { text: body.toString('utf8'), url: response.url };
}

/** Saute une étiquette ID3 en tête (audio « empaqueté » : AAC, MP3). */
function afterId3(bytes: Buffer): number {
  if (bytes.length < 10 || bytes.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7);
  const footer = bytes[5]! & 0x10 ? 10 : 0;
  return 10 + size + (bytes[9]! & 0x7f) + footer;
}

/** Type d'un morceau reconnu à ses octets : TS, ADTS, MP3, MP4 fragmenté ; null sinon. */
export function sniffSegment(bytes: Buffer): string | null {
  const at = afterId3(bytes);
  if (at >= bytes.length) return null;
  const b0 = bytes[at]!;
  const b1 = bytes[at + 1] ?? 0;
  if (b0 === 0x47) {
    // Synchronisation tous les 188 octets ; un paquet seul doit faire 188 octets tout juste.
    const following = [188, 376].filter((step) => at + step < bytes.length);
    if (
      following.length
        ? following.every((step) => bytes[at + step] === 0x47)
        : bytes.length - at === 188
    )
      return 'video/mp2t';
  }
  if (b0 === 0xff && (b1 & 0xf6) === 0xf0) return 'audio/aac';
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0 && ((b1 >> 1) & 3) !== 0) return 'audio/mpeg';
  const box = bytes.toString('latin1', at + 4, at + 8);
  if (['ftyp', 'styp', 'moof', 'moov', 'sidx', 'emsg', 'prft'].includes(box)) return 'audio/mp4';
  return null;
}

/** Type servi pour un morceau : celui des octets d'abord, sinon un type déclaré accepté. */
export function segmentType(declared: string, bytes: Buffer): string | null {
  if (declared.startsWith('text/')) return null;
  return sniffSegment(bytes) ?? (SEGMENT_TYPES.includes(declared) ? declared : null);
}

/** Plage `bytes=début-fin` d'une requête, ou null (plages multiples non prises en charge). */
function parseRange(range: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return { start, end };
}

/**
 * Morceau HLS lu en entier par la voie gardée (taille bornée), puis servi avec son type réel.
 * `Range` est transmis (`EXT-X-BYTERANGE`) ; un service qui l'ignore rend le morceau entier,
 * dont la plage demandée est extraite ici.
 */
export async function fetchSegment(
  address: string,
  options: { range?: string; signal: AbortSignal; connect?: Connect; max?: number },
): Promise<{ status: 200 | 206; type: string; body: Buffer; contentRange?: string }> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*' };
  if (options.range) headers.Range = options.range;
  const response = await openGuarded(address, {
    signal: options.signal,
    connect: options.connect,
    headers,
  });
  const declared = mediaType(response);
  if (declared.startsWith('text/') || PLAYLIST_TYPES.slice(0, 4).includes(declared)) {
    closeQuietly(response);
    throw new PlayerStreamError('Ce morceau HLS n’est pas de l’audio.', 415);
  }
  let body = await readLimited(
    response,
    options.max ?? HLS_SEGMENT_MAX_BYTES,
    'Morceau HLS trop lourd.',
  );
  let status: 200 | 206 = 200;
  let contentRange: string | undefined;
  if (response.status === 206) {
    status = 206;
    contentRange = header(response, 'content-range');
  } else if (options.range) {
    const range = parseRange(options.range, body.length);
    if (!range || range.start > range.end)
      throw new PlayerStreamError('Plage demandée hors du morceau.', 416);
    contentRange = `bytes ${range.start}-${range.end}/${body.length}`;
    body = body.subarray(range.start, range.end + 1);
    status = 206;
  }
  const type = segmentType(declared, body);
  if (!type) throw new PlayerStreamError('Ce morceau HLS n’est pas de l’audio.', 415);
  return { status, type, body, contentRange };
}
