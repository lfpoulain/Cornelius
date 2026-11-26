import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { Readable } from 'node:stream';

/**
 * Relais d'un flux audio vers le miroir. Le serveur ouvre le flux https d'un module et le
 * recopie : la page du miroir ne contacte jamais l'hôte d'un module, sa CSP reste `'self'`.
 */

const MAX_REDIRECTS = 3;
const HEADERS_TIMEOUT_MS = 8_000;

/** Échec d'ouverture, avec une raison courte et sans adresse, pour le miroir et le journal. */
export class PlayerStreamError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

/** Sous-réseaux IPv4 jamais contactés : réseau local, machine, partagés, réservés. */
const blockedV4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // partage d'adresses (CGNAT)
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // affectations du protocole
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // bancs d'essai
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3], // multidiffusion et réservé, jusqu'à 255.255.255.255
];
/** Sous-réseaux IPv6 jamais contactés (une adresse qui porte une IPv4 est lue à part). */
const blockedV6: [string, number][] = [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // locales uniques
  ['fe80::', 10], // lien local
  ['fec0::', 10], // site local, abandonnées
  ['ff00::', 8], // multidiffusion
  ['2001:db8::', 32], // documentation
  ['100::', 64], // à jeter
];
const blockList = new BlockList();
for (const [network, prefix] of blockedV4) blockList.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of blockedV6) blockList.addSubnet(network, prefix, 'ipv6');

/** Les seize octets d'une adresse IPv6, forme courte et IPv4 finale comprises. */
function ipv6Bytes(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/u.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text =
      text.slice(0, -dotted[0].length) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const short = text.includes('::');
  const [head, tail] = short ? text.split('::') : [text, ''];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!short && missing !== 0)) return null;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right].map((group) =>
    parseInt(group || '0', 16),
  );
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

/** IPv4 portée par une adresse IPv6 (mappée, compatible, NAT64, 6to4), ou null. */
function embeddedV4(bytes: number[]): string | null {
  const zero = (from: number, to: number) => bytes.slice(from, to).every((byte) => byte === 0);
  const last = bytes.slice(12).join('.');
  // ::ffff:a.b.c.d (mappée) et ::a.b.c.d (compatible)
  if (zero(0, 10) && ((bytes[10] === 0xff && bytes[11] === 0xff) || zero(10, 12))) return last;
  // 64:ff9b::/96 (NAT64) et 64:ff9b:1::/48 (NAT64 local)
  if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) return last;
  // 2002::/16 (6to4) : l'IPv4 suit les deux premiers octets.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6).join('.');
  return null;
}

/**
 * Adresse que le relais ne contacte jamais : réseau local, la machine, adresses non
 * routables, y compris sous une forme IPv6 qui porte une IPv4. Un flux vient d'Internet ;
 * un module ne doit pas faire lire un appareil de la maison au serveur.
 */
export function blockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/gu, '').replace(/%.*$/u, '');
  if (isIP(ip) === 4) return blockList.check(ip, 'ipv4');
  if (isIP(ip) !== 6) return true;
  const bytes = ipv6Bytes(ip);
  if (!bytes) return true;
  const v4 = embeddedV4(bytes);
  if (v4) return blockList.check(v4, 'ipv4');
  return blockList.check(ip, 'ipv6');
}

/**
 * Hôte refusé sans résolution : une adresse IP bloquée écrite telle quelle, ou un nom de la
 * machine (`localhost`). Les autres noms sont contrôlés à la résolution.
 */
export function blockedHost(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/gu, '')
    .toLowerCase()
    .replace(/\.$/u, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return isIP(host) !== 0 && blockedAddress(host);
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Résolution de nom qui refuse toute adresse bloquée (y compris après un changement de DNS). */
export function guardedLookup(
  hostname: string,
  options: { all?: boolean } & Record<string, unknown>,
  callback: LookupCallback,
  resolve: typeof dnsLookup = dnsLookup,
) {
  resolve(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '');
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((entry) => blockedAddress(entry.address))) {
      const refused = Object.assign(new Error('Adresse du réseau local refusée.'), {
        code: 'EBLOCKED',
      });
      return callback(refused, '');
    }
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

/** Réponse ouverte par la voie gardée, avec l'adresse finale (après redirections). */
export interface GuardedResponse extends UpstreamResponse {
  url: URL;
}

/** Ouvre une adresse https ; remplaçable en test. */
export type Connect = (
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<UpstreamResponse>;

export const connectHttps: Connect = (url, headers, signal) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      { method: 'GET', headers, lookup: guardedLookup as never, signal },
      (response) => {
        // Le délai ne vaut que pour les en-têtes : un flux en pause ou qui cale n'est pas coupé.
        request.setTimeout(0);
        resolve({ status: response.statusCode ?? 502, headers: response.headers, body: response });
      },
    );
    request.setTimeout(HEADERS_TIMEOUT_MS, () =>
      request.destroy(new PlayerStreamError('Le flux met trop de temps à répondre.', 504)),
    );
    request.on('error', reject);
    request.end();
  });

/** Listes de lecture : le module doit les résoudre, le miroir ne lit qu'un flux direct. */
const playlistTypes = [
  'audio/x-mpegurl',
  'audio/mpegurl',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'audio/x-scpls',
  'application/pls+xml',
  'audio/x-ms-asx',
  'video/x-ms-asf',
];

export function header(response: UpstreamResponse, name: string): string | undefined {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Type d'un flux audio accepté, ou la raison du refus. */
export function audioType(contentType: string | undefined):
  | { ok: true; type: string }
  | {
      ok: false;
      reason: string;
    } {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (playlistTypes.includes(type))
    return { ok: false, reason: 'Liste de lecture (m3u, pls) non prise en charge.' };
  if (
    type.startsWith('audio/') ||
    type === 'application/ogg' ||
    type === 'application/octet-stream'
  )
    return { ok: true, type: type === 'application/octet-stream' ? 'audio/mpeg' : type };
  if (!type) return { ok: true, type: 'audio/mpeg' };
  return { ok: false, reason: 'Ce n’est pas un flux audio.' };
}

export function closeQuietly(response: UpstreamResponse) {
  response.body.on('error', () => {});
  response.body.destroy();
}

/**
 * Ouvre une adresse du lecteur (flux, logo, liste ou morceau HLS) : https seulement, sans identifiants, trois
 * redirections au plus (jamais vers http), jamais vers le réseau local, à chaque étape.
 */
export async function openGuarded(
  address: string,
  options: { headers: Record<string, string>; signal: AbortSignal; connect?: Connect },
): Promise<GuardedResponse> {
  const connect = options.connect ?? connectHttps;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new PlayerStreamError('Adresse du flux illisible.', 400);
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new PlayerStreamError('Seul un flux https sans identifiants est lu.', 400);
    if (blockedHost(url.hostname))
      throw new PlayerStreamError('Adresse du réseau local refusée.', 403);
    let response: UpstreamResponse;
    try {
      response = await connect(url, options.headers, options.signal);
    } catch (error) {
      if (error instanceof PlayerStreamError) throw error;
      const code = (error as { code?: string }).code;
      if (code === 'EBLOCKED') throw new PlayerStreamError('Adresse du réseau local refusée.', 403);
      throw new PlayerStreamError('Le flux est injoignable.');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      closeQuietly(response);
      const location = header(response, 'location');
      if (!location || hop >= MAX_REDIRECTS)
        throw new PlayerStreamError('Trop de redirections pour ce flux.');
      url = new URL(location, url);
      continue;
    }
    if (response.status !== 200 && response.status !== 206) {
      closeQuietly(response);
      throw new PlayerStreamError(
        response.status === 404 ? 'Flux introuvable.' : `Le flux répond ${response.status}.`,
        response.status === 416 ? 416 : 502,
      );
    }
    return { ...response, url };
  }
}

export const USER_AGENT = 'Cornelius (+https://github.com/lfpoulain/Cornelius)';

/** Ouvre le flux audio. `range` est transmis tel quel (fichier : avancer dans un podcast). */
export async function openStream(
  address: string,
  options: { range?: string; signal: AbortSignal; connect?: Connect },
): Promise<{ response: UpstreamResponse; type: string }> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'audio/*, application/ogg;q=0.9, */*;q=0.5',
    // Les métadonnées ICY se mêleraient au son : jamais demandées.
    'Icy-MetaData': '0',
  };
  if (options.range) headers.Range = options.range;
  const response = await openGuarded(address, {
    signal: options.signal,
    connect: options.connect,
    headers,
  });
  const type = audioType(header(response, 'content-type'));
  if (!type.ok) {
    closeQuietly(response);
    throw new PlayerStreamError(type.reason, 415);
  }
  return { response, type: type.type };
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const IMAGE_MAX_BYTES = 512 * 1024;

/**
 * Logo d'une lecture, par la même voie gardée que le flux : PNG, JPEG, WebP ou GIF de
 * 512 Kio au plus (SVG refusé), lu en entier avant d'être servi.
 */
export async function fetchImage(
  address: string,
  options: { signal: AbortSignal; connect?: Connect },
): Promise<{ type: string; body: Buffer }> {
  const response = await openGuarded(address, {
    ...options,
    headers: { 'User-Agent': USER_AGENT, Accept: IMAGE_TYPES.join(', ') },
  });
  const type = (header(response, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (response.status !== 200 || !IMAGE_TYPES.includes(type)) {
    closeQuietly(response);
    throw new PlayerStreamError('Logo illisible.', 415);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += (chunk as Buffer).length;
    if (size > IMAGE_MAX_BYTES) {
      closeQuietly(response);
      throw new PlayerStreamError('Logo trop lourd.', 413);
    }
    chunks.push(chunk as Buffer);
  }
  return { type, body: Buffer.concat(chunks) };
}

/** En-têtes recopiés vers le miroir : taille et plage, pour avancer dans un fichier. */
export function forwardedHeaders(response: UpstreamResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['content-length', 'content-range', 'accept-ranges']) {
    const value = header(response, name);
    if (value) out[name] = value;
  }
  return out;
}
