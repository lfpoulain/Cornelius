import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { compile } from '../shared/validation.js';
import type { DiagnosticLog } from './logs.js';
import type { Player } from './player.js';
import { hostOf } from './player.js';
import {
  fetchImage,
  forwardedHeaders,
  openStream,
  PlayerStreamError,
  type Connect,
} from './player-stream.js';
import { fetchPlaylist, fetchSegment, HlsSessions, rewritePlaylist } from './player-hls.js';

const statusSchema = compile<{
  id: string;
  status: 'playing' | 'error' | 'ended';
  reason?: string;
}>({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64 },
    status: { enum: ['playing', 'error', 'ended'] },
    reason: { type: 'string', maxLength: 300 },
  },
});

/**
 * Routes du lecteur. Le flux et le logo sont relayés par le serveur, sous `/api/` : réservés
 * au miroir et à l'administration sur le réseau local, comme le reste de l'état.
 */
export function registerPlayer(
  app: FastifyInstance,
  services: {
    player: Player;
    logs?: DiagnosticLog;
    /** Onglet courant du miroir (409 sinon). */
    kiosk(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** Remplacé en test : ouverture d'une adresse https. */
    connect?: Connect;
  },
) {
  const { player } = services;
  // Jetons HLS de la lecture en cours : oubliés dès qu'elle s'arrête ou est remplacée.
  const hls = new HlsSessions();
  player.onChange(() => hls.keepOnly((id) => player.playing(id) !== null));

  /** Coupe la lecture amont quand le miroir abandonne la requête, ou après `timeoutMs`. */
  const upstreamSignal = (request: FastifyRequest, timeoutMs: number) => {
    const abort = new AbortController();
    request.raw.on('close', () => abort.abort());
    return AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
  };

  const hlsFailure = (
    reply: FastifyReply,
    playing: { addonId: string; url: string },
    error: unknown,
    what: 'liste' | 'morceau',
    log: boolean,
  ) => {
    const failure =
      error instanceof PlayerStreamError
        ? error
        : new PlayerStreamError('Le flux est injoignable.');
    if (log)
      services.logs?.write(
        'warn',
        'player',
        what === 'liste' ? 'Liste HLS refusée ou injoignable' : 'Morceau HLS refusé ou injoignable',
        { addonId: playing.addonId, host: hostOf(playing.url), reason: failure.message },
      );
    return reply.code(failure.status).send({ error: failure.message });
  };

  /** Liste HLS (maîtresse ou variante), réécrite : chaque adresse devient un jeton. */
  const servePlaylist = async (
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    address: string,
  ) => {
    const playing = player.playing(id)!;
    try {
      const list = await fetchPlaylist(address, {
        signal: upstreamSignal(request, 10_000),
        connect: services.connect,
      });
      // Arrêtée pendant la lecture de la liste : aucun jeton n'est créé.
      if (!player.playing(id)) return reply.code(404).send({ error: 'Lecture arrêtée.' });
      const tokens = hls.tokens(id);
      const body = rewritePlaylist(
        list.text,
        list.url,
        (url, role) => `/api/player/${encodeURIComponent(id)}/hls/${tokens.issue(url, role)}`,
      );
      return reply.header('Content-Type', 'application/vnd.apple.mpegurl').send(body);
    } catch (error) {
      return hlsFailure(reply, playing, error, 'liste', !request.raw.destroyed);
    }
  };

  // Entrée d'un flux HLS : la liste rendue par le module.
  app.get<{ Params: { id: string } }>(
    '/api/player/:id/hls',
    { preHandler: services.kiosk },
    async (request, reply) => {
      const playing = player.playing(request.params.id);
      if (!playing) return reply.code(404).send({ error: 'Rien ne joue sous ce nom.' });
      return servePlaylist(request, reply, request.params.id, playing.url);
    },
  );

  // Adresse nommée par une liste déjà servie : variante, rendu audio ou morceau.
  app.get<{ Params: { id: string; token: string } }>(
    '/api/player/:id/hls/:token',
    { preHandler: services.kiosk },
    async (request, reply) => {
      const { id, token } = request.params;
      const playing = player.playing(id);
      const tokens = hls.find(id);
      const entry = tokens?.get(token);
      if (!playing || !tokens || !entry)
        return reply.code(404).send({ error: 'Adresse inconnue ou lecture arrêtée.' });
      if (entry.role === 'playlist') return servePlaylist(request, reply, id, entry.url);
      const range = request.headers.range;
      try {
        const segment = await fetchSegment(entry.url, {
          range: typeof range === 'string' ? range : undefined,
          signal: upstreamSignal(request, 20_000),
          connect: services.connect,
        });
        if (!player.playing(id)) return reply.code(404).send({ error: 'Lecture arrêtée.' });
        reply.code(segment.status).header('Content-Type', segment.type);
        if (segment.contentRange) reply.header('Content-Range', segment.contentRange);
        return reply.send(segment.body);
      } catch (error) {
        const log = !tokens.segmentFailureLogged && !request.raw.destroyed;
        if (log) tokens.segmentFailureLogged = true;
        return hlsFailure(reply, playing, error, 'morceau', log);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/player/:id/stream',
    { preHandler: services.kiosk },
    async (request, reply) => {
      const playing = player.playing(request.params.id);
      if (!playing) return reply.code(404).send({ error: 'Rien ne joue sous ce nom.' });
      const abort = new AbortController();
      // Le miroir coupe (arrêt, nouvelle lecture, page fermée) : le flux amont aussi.
      request.raw.on('close', () => abort.abort());
      const range = request.headers.range;
      try {
        const { response, type } = await openStream(playing.url, {
          range: typeof range === 'string' ? range : undefined,
          signal: abort.signal,
          connect: services.connect,
        });
        // Une lecture arrêtée pendant l'ouverture ne part pas vers le miroir.
        const stopped = () => !player.playing(request.params.id);
        const unsubscribe = player.onChange(() => {
          if (stopped()) abort.abort();
        });
        response.body.on('close', unsubscribe);
        abort.signal.addEventListener('abort', () => response.body.destroy(), { once: true });
        response.body.on('error', () => {});
        if (stopped()) {
          response.body.destroy();
          return reply.code(404).send({ error: 'Lecture arrêtée.' });
        }
        reply
          .code(response.status)
          .headers({ ...forwardedHeaders(response), 'Content-Type': type })
          .header('Cache-Control', 'no-store');
        return reply.send(response.body);
      } catch (error) {
        const failure =
          error instanceof PlayerStreamError
            ? error
            : new PlayerStreamError('Le flux est injoignable.');
        if (!abort.signal.aborted)
          services.logs?.write('warn', 'player', 'Flux refusé ou injoignable', {
            addonId: playing.addonId,
            host: hostOf(playing.url),
            reason: failure.message,
          });
        return reply.code(failure.status).send({ error: failure.message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/player/:id/image',
    { preHandler: services.kiosk },
    async (request, reply) => {
      const playing = player.playing(request.params.id);
      if (!playing?.imageUrl) return reply.code(404).send({ error: 'Aucun logo.' });
      try {
        // Même voie gardée que le flux : https, jamais le réseau local, même après redirection.
        const image = await fetchImage(playing.imageUrl, {
          signal: AbortSignal.timeout(6_000),
          connect: services.connect,
        });
        return reply
          .header('Content-Type', image.type)
          .header('Content-Security-Policy', "default-src 'none'")
          .send(image.body);
      } catch (error) {
        const reason = error instanceof PlayerStreamError ? error.message : 'Logo injoignable.';
        services.logs?.write('warn', 'player', 'Logo refusé ou injoignable', {
          addonId: playing.addonId,
          host: hostOf(playing.imageUrl),
          reason,
        });
        return reply.code(404).send({ error: reason });
      }
    },
  );

  app.post('/api/player/status', { preHandler: services.kiosk }, async (request, reply) => {
    if (!statusSchema(request.body)) return reply.code(400).send({ error: 'État invalide.' });
    const { id, status, reason } = request.body;
    return { ok: player.report(id, status, reason) };
  });

  app.post('/api/player/stop', { preHandler: services.kiosk }, async () => ({
    ok: player.stop('miroir'),
  }));

  app.post('/api/admin/player/stop', { preHandler: services.requireAdmin }, async () => ({
    ok: player.stop('administration'),
  }));

  app.get('/api/admin/player', { preHandler: services.requireAdmin }, async () => ({
    player: player.mirrorView(),
  }));
}
