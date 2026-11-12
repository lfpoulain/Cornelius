import {
  AddonCollectError,
  type AddonHttpClient,
  type AddonHttpRequest,
  type AddonHttpResponse,
} from '../../shared/addons.js';
import { coreVersion } from './registry.js';

const defaultTimeoutMs = 4000;
const defaultMaxBytes = 256 * 1024;
/** Certains services (Wikimedia) exigent qu'un programme se présente. */
export const defaultUserAgent = `Cornelius/${coreVersion} (+https://github.com/lfpoulain/Cornelius)`;
const maxRedirects = 3;
const maxCacheMs = 10 * 60_000;
const cacheEntries = 32;
const cacheBytes = 16 * 1024 * 1024;
/** En-têtes renvoyés à un autre domaine après une redirection : jamais un jeton. */
const portableHeaders = new Set(['accept', 'accept-language', 'user-agent']);

/** Seules les destinations http(s) sans identifiants embarqués sont utilisables. */
export function safeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AddonCollectError('invalid_params', 'Adresse invalide.', false);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new AddonCollectError(
      'invalid_params',
      'Seules les adresses http(s) sont autorisées.',
      false,
    );
  if (url.username || url.password)
    throw new AddonCollectError('invalid_params', 'Adresse avec identifiants refusée.', false);
  return url;
}

/**
 * Encodage du corps : celui de l'en-tête Content-Type, sinon celui déclaré par un document
 * XML (`<?xml … encoding="ISO-8859-1"?>`), sinon UTF-8. Un nom inconnu retombe sur UTF-8.
 */
export function charsetOf(contentType: string | null, head: Uint8Array): string {
  const declared =
    /charset\s*=\s*"?([\w-]+)/iu.exec(contentType ?? '')?.[1] ??
    /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([\w-]+)["']/iu.exec(
      new TextDecoder('latin1').decode(head.subarray(0, 200)),
    )?.[1];
  if (!declared) return 'utf-8';
  try {
    return new TextDecoder(declared).encoding;
  } catch {
    return 'utf-8';
  }
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const body = response.body;
  if (!body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    chunks.push(value);
    if (size > maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const buffer = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.max(0, buffer.byteLength - offset));
    buffer.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= buffer.byteLength) break;
  }
  return { bytes: buffer, truncated };
}

// Échecs de connexion : la requête n'a jamais quitté le serveur.
const connectFailures = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

/** Raison d'une requête refusée avant tout envoi (en-tête mal formé, corps interdit…). */
function invalidRequest(message: string): string {
  const header = /"([^"]*)" is an invalid header name/u.exec(message);
  if (header) return `Requête invalide : nom d’en-tête « ${header[1]} » refusé.`;
  if (/invalid header value/u.test(message))
    return 'Requête invalide : valeur d’en-tête refusée (retour à la ligne ou caractère interdit).';
  if (/cannot have body/u.test(message))
    return 'Requête invalide : une requête GET ne peut pas avoir de corps.';
  return 'Requête invalide : elle a été refusée avant l’envoi.';
}

/**
 * Distingue trois échecs : requête invalide (rien n'est parti), destination injoignable
 * (connexion impossible, rien n'est parti) et connexion coupée en route (résultat incertain).
 */
export function networkFailure(error: unknown): AddonCollectError {
  if (error instanceof TypeError && error.message !== 'fetch failed')
    return new AddonCollectError('invalid_params', invalidRequest(error.message), false);
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  // Redirections refusées : l'adresse réglée n'est pas la bonne, réessayer n'y changera rien.
  if (cause?.message === 'unexpected redirect')
    return new AddonCollectError(
      'upstream',
      'La source renvoie vers une autre adresse : utiliser son adresse finale.',
      false,
    );
  if (connectFailures.has(code) || code.startsWith('ERR_TLS') || cause?.message === 'bad port')
    return new AddonCollectError('unavailable', 'Source réseau injoignable.', true);
  return new AddonCollectError('upstream', 'Connexion interrompue avant la réponse.', true);
}

/**
 * Réponse lue, gardée en octets : le texte n'est décodé qu'à la demande, avec l'encodage
 * déclaré. Un format binaire (`bytes()`) n'est donc jamais abîmé par un décodage, et le cache
 * compte la taille réelle du corps.
 */
type Fetched = {
  status: number;
  headers: Record<string, string>;
  bytes: Uint8Array;
  truncated: boolean;
  url: string;
};

function textOf(fetched: Fetched): string {
  const charset = charsetOf(fetched.headers['content-type'] ?? null, fetched.bytes);
  return new TextDecoder(charset).decode(fetched.bytes);
}

function respond(fetched: Fetched): AddonHttpResponse {
  return {
    status: fetched.status,
    headers: fetched.headers,
    text: () => textOf(fetched),
    json: () => JSON.parse(textOf(fetched)) as unknown,
    bytes: () => fetched.bytes.slice(),
    truncated: fetched.truncated,
    url: fetched.url,
  };
}

/** Un User-Agent par défaut, sauf si le module donne le sien. */
function withUserAgent(headers: Record<string, string> | undefined): Record<string, string> {
  const result = { ...(headers ?? {}) };
  if (!Object.keys(result).some((name) => name.toLowerCase() === 'user-agent'))
    result['User-Agent'] = defaultUserAgent;
  return result;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/**
 * Une requête, redirections GET comprises : trois au plus, chaque adresse revalidée, jamais
 * de https vers http, et seuls les en-têtes anodins suivent un changement de domaine. Un POST
 * n'est jamais redirigé : le renvoyer ailleurs pourrait doubler son effet.
 */
async function send(request: AddonHttpRequest, signal: AbortSignal): Promise<Fetched> {
  const method = request.method ?? 'GET';
  let target = safeUrl(request.url);
  let headers = withUserAgent(request.headers);
  for (let hop = 0; ; hop += 1) {
    const response = await fetch(target, {
      method,
      headers,
      body: request.body,
      redirect: 'manual',
      signal,
    });
    const location = response.headers.get('location');
    if (redirectStatuses.has(response.status) && location) {
      await response.body?.cancel().catch(() => {});
      if (method !== 'GET' || hop >= maxRedirects)
        throw new AddonCollectError(
          'upstream',
          method !== 'GET'
            ? 'La source renvoie vers une autre adresse : utiliser son adresse finale.'
            : 'Trop de redirections : utiliser l’adresse finale de la source.',
          false,
        );
      const next = safeUrl(new URL(location, target).href);
      if (target.protocol === 'https:' && next.protocol === 'http:')
        throw new AddonCollectError(
          'upstream',
          'La source renvoie vers une adresse non chiffrée : redirection refusée.',
          false,
        );
      if (next.origin !== target.origin)
        headers = Object.fromEntries(
          Object.entries(headers).filter(([name]) => portableHeaders.has(name.toLowerCase())),
        );
      target = next;
      continue;
    }
    const { bytes, truncated } = await readBounded(response, request.maxBytes ?? defaultMaxBytes);
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      bytes,
      truncated,
      url: target.href,
    };
  }
}

/**
 * Cache partagé des GET qui le demandent (`cacheMs`) : réponses 200 seulement, 32 au plus et
 * 16 Mo en tout, les plus anciennes sorties d'abord. Deux demandes identiques en vol n'en
 * font qu'une.
 */
class SharedCache {
  private entries = new Map<string, { fetched: Fetched; expires: number; size: number }>();
  private inflight = new Map<string, Promise<Fetched>>();
  private size = 0;

  constructor(private readonly now: () => number) {}

  key(request: AddonHttpRequest): string {
    const headers = Object.entries(request.headers ?? {})
      .map(([name, value]) => [name.toLowerCase(), value])
      .sort(([a], [b]) => (a! < b! ? -1 : 1));
    return JSON.stringify([request.url, headers, request.maxBytes ?? defaultMaxBytes]);
  }

  get(key: string): Fetched | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expires <= this.now()) {
      this.drop(key);
      return null;
    }
    // Remis en fin de liste : le plus récemment servi sort en dernier.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.fetched;
  }

  put(key: string, fetched: Fetched, ms: number): void {
    if (fetched.status !== 200) return;
    const size = fetched.bytes.byteLength;
    if (size > cacheBytes / 4) return;
    this.drop(key);
    this.entries.set(key, { fetched, expires: this.now() + ms, size });
    this.size += size;
    for (const [oldest] of this.entries) {
      if (this.entries.size <= cacheEntries && this.size <= cacheBytes) break;
      this.drop(oldest);
    }
  }

  share(key: string, load: () => Promise<Fetched>): Promise<Fetched> {
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = load().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.size -= entry.size;
    this.entries.delete(key);
  }
}

/**
 * Client réseau unique du cœur : délai borné, taille bornée, redirections contrôlées,
 * encodage respecté, cache partagé sur demande.
 */
export function createHttpClient(options: { now?: () => number } = {}): AddonHttpClient {
  const cache = new SharedCache(options.now ?? Date.now);

  async function once(request: AddonHttpRequest, signal?: AbortSignal): Promise<Fetched> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? defaultTimeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await send(request, controller.signal);
    } catch (error) {
      if (error instanceof AddonCollectError) throw error;
      if ((error as Error).name === 'AbortError') {
        if (signal?.aborted) throw new AddonCollectError('unavailable', 'Collecte annulée.', true);
        throw new AddonCollectError('timeout', 'La source n’a pas répondu à temps.', true);
      }
      throw networkFailure(error);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    async fetch(request: AddonHttpRequest): Promise<AddonHttpResponse> {
      if (request.signal?.aborted)
        throw new AddonCollectError('unavailable', 'Collecte annulée.', true);
      const cacheMs = Math.min(maxCacheMs, Math.max(0, request.cacheMs ?? 0));
      if (!cacheMs || (request.method ?? 'GET') !== 'GET')
        return respond(await once(request, request.signal));
      safeUrl(request.url);
      const key = cache.key(request);
      const cached = cache.get(key);
      if (cached) return respond(cached);
      // La lecture partagée n'est pas annulée par un seul demandeur : elle sert les autres.
      const shared = cache.share(key, async () => {
        const fetched = await once(request);
        cache.put(key, fetched, cacheMs);
        return fetched;
      });
      if (!request.signal) return respond(await shared);
      const signal = request.signal;
      return respond(
        await new Promise<Fetched>((resolve, reject) => {
          const onAbort = () =>
            reject(new AddonCollectError('unavailable', 'Collecte annulée.', true));
          signal.addEventListener('abort', onAbort, { once: true });
          shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
        }),
      );
    },
  };
}
