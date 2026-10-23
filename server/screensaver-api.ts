import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  SCREENSAVER_IMAGE_MAX_BYTES,
  SCREENSAVER_IMAGE_TYPES,
  isScreensaverSettings,
} from '../shared/screensaver.js';
import type { SessionController } from './controller.js';
import { titleFromName, type ScreensaverLibrary } from './screensaver.js';

export function registerScreensaver(
  app: FastifyInstance,
  library: ScreensaverLibrary,
  controller: SessionController,
  requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>,
) {
  const admin = { preHandler: requireAdmin };
  const publish = () => controller.setScreensaverImages(library.list().length, library.revision());
  library.onChange(publish);
  publish();

  // Lu par le miroir, comme ses autres données : réservé à la machine et aux appareils autorisés.
  app.get('/api/screensaver', async () => ({ images: library.list() }));
  app.get<{ Params: { id: string } }>('/api/screensaver/images/:id', async (request, reply) => {
    const file = library.file(request.params.id);
    if (!file) return reply.code(404).send({ error: 'Image introuvable.' });
    // Un identifiant ne désigne jamais qu’un seul fichier : le navigateur peut le garder.
    return reply
      .type(file.type)
      .header('Cache-Control', 'private, max-age=604800, immutable')
      .send(readFileSync(file.path));
  });

  app.get('/api/admin/screensaver', admin, async () => library.view());
  app.patch('/api/admin/screensaver', admin, async (request, reply) => {
    if (!isScreensaverSettings(request.body))
      return reply.code(400).send({ error: 'Réglages de l’écran de veille invalides.' });
    controller.setScreensaver(request.body);
    return controller.snapshot();
  });
  app.delete<{ Params: { id: string } }>(
    '/api/admin/screensaver/images/:id',
    admin,
    async (request, reply) => {
      if (!library.remove(request.params.id))
        return reply.code(404).send({ error: 'Image introuvable.' });
      return library.view();
    },
  );
  app.post<{ Body: { ids?: unknown } }>(
    '/api/admin/screensaver/images/remove',
    admin,
    async (request, reply) => {
      const ids = request.body?.ids;
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.length > 300 ||
        !ids.every((id) => typeof id === 'string')
      )
        return reply.code(400).send({ error: 'Images à retirer invalides.' });
      library.removeMany(ids);
      return library.view();
    },
  );
  app.post('/api/admin/screensaver/collection', admin, async () => {
    void library.installCollection();
    return library.view();
  });

  // Envoi d’une image : le fichier brut, sans formulaire ; son nom passe par un en-tête.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      [...SCREENSAVER_IMAGE_TYPES],
      { parseAs: 'buffer', bodyLimit: SCREENSAVER_IMAGE_MAX_BYTES },
      (_request, body, done) => done(null, body),
    );
    scope.post(
      '/api/admin/screensaver/images',
      { ...admin, bodyLimit: SCREENSAVER_IMAGE_MAX_BYTES },
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body))
          return reply.code(415).send({ error: 'Envoyez une image JPEG, PNG ou WebP.' });
        let name = 'Image';
        try {
          name = decodeURIComponent(String(request.headers['x-file-name'] ?? 'Image'));
        } catch {
          // Nom mal encodé : l’image reste acceptée, sous un nom générique.
        }
        const image = library.add(request.body, { title: titleFromName(name) });
        if (!image)
          return reply
            .code(415)
            .send({ error: 'Ce fichier n’est pas une image JPEG, PNG ou WebP lisible.' });
        return library.view();
      },
    );
  });
}
