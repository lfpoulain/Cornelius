import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { isPrivateAddress } from './network.js';

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

/**
 * Adresse que le relais ne contacte jamais : réseau local, la machine, adresses non
 * routables. Un flux vient d'Internet ; un module ne doit pas faire lire un appareil de la
 * maison au serveur.
 */
export function blockedAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:/iu, '');
  if (isPrivateAddress(ip)) return true;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    // 0.0.0.0/8, 100.64.0.0/10 (partage d'adresses), 224.0.0.0 et au-delà (multidiffusion).
    return a === 0 || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(ip) === 6) return ip === '::' || ip.toLowerCase().startsWith('ff');
  return true;
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
      (response) =>
        resolve({ status: response.statusCode ?? 502, headers: response.headers, body: response }),
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

function header(response: UpstreamResponse, name: string): string | undefined {
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
    return { ok: false, reason: 'Liste de lecture (m3u, pls, HLS) non prise en charge.' };
  if (
    type.startsWith('audio/') ||
    type === 'application/ogg' ||
    type === 'application/octet-stream'
  )
    return { ok: true, type: type === 'application/octet-stream' ? 'audio/mpeg' : type };
  if (!type) return { ok: true, type: 'audio/mpeg' };
  return { ok: false, reason: 'Ce n’est pas un flux audio.' };
}

function closeQuietly(response: UpstreamResponse) {
  response.body.on('error', () => {});
  response.body.destroy();
}

/**
 * Ouvre le flux : https seulement, trois redirections au plus (jamais vers http), type
 * audio. `range` est transmis tel quel (fichier : avancer dans un podcast).
 */
export async function openStream(
  address: string,
  options: { range?: string; signal: AbortSignal; connect?: Connect },
): Promise<{ response: UpstreamResponse; type: string }> {
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
    if (
      isIP(url.hostname.replace(/^\[|\]$/gu, '')) &&
      blockedAddress(url.hostname.replace(/^\[|\]$/gu, ''))
    )
      throw new PlayerStreamError('Adresse du réseau local refusée.', 403);
    const headers: Record<string, string> = {
      'User-Agent': 'Cornelius (+https://github.com/lfpoulain/Cornelius)',
      Accept: 'audio/*, application/ogg;q=0.9, */*;q=0.5',
      // Les métadonnées ICY se mêleraient au son : jamais demandées.
      'Icy-MetaData': '0',
    };
    if (options.range) headers.Range = options.range;
    let response: UpstreamResponse;
    try {
      response = await connect(url, headers, options.signal);
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
    const type = audioType(header(response, 'content-type'));
    if (!type.ok) {
      closeQuietly(response);
      throw new PlayerStreamError(type.reason, 415);
    }
    return { response, type: type.type };
  }
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
