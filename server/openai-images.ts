import OpenAI from 'openai';
import type { OpenAIImageModel, OpenAIImageQuality } from '../shared/types.js';

export interface OpenAIImageRequest {
  prompt: string;
  model: OpenAIImageModel;
  quality: OpenAIImageQuality;
  signal: AbortSignal;
}
/** Renvoie l’image WebP produite par OpenAI. */
export type OpenAIImageCreator = (request: OpenAIImageRequest) => Promise<Buffer>;

/** Taille demandée à OpenAI : la plus petite des tailles carrées de l’API d’images. */
export const OPENAI_IMAGE_SIZE = 1024;

export function createOpenAIImageCreator(
  apiKey: string,
  fetch?: typeof globalThis.fetch,
): OpenAIImageCreator {
  const client = new OpenAI({ apiKey, timeout: 170_000, maxRetries: 0, fetch });
  return async ({ prompt, model, quality, signal }) => {
    const response = await client.images.generate(
      {
        model,
        prompt,
        n: 1,
        size: `${OPENAI_IMAGE_SIZE}x${OPENAI_IMAGE_SIZE}`,
        quality,
        output_format: 'webp',
        output_compression: 85,
      },
      { signal },
    );
    const data = response.data?.[0]?.b64_json;
    if (!data) throw new Error('OpenAI n’a renvoyé aucune image.');
    return Buffer.from(data, 'base64');
  };
}

/** Message lisible pour l’administration et pour Cornelius, sans détail de la clé. */
export function openAIImageError(error: unknown): string {
  if (error instanceof OpenAI.APIUserAbortError) return 'Génération annulée.';
  if (error instanceof OpenAI.APIConnectionTimeoutError)
    return 'OpenAI n’a pas répondu à temps pour créer l’image.';
  if (error instanceof OpenAI.APIConnectionError) return 'OpenAI est injoignable pour le moment.';
  if (error instanceof OpenAI.APIError) {
    if (error.code === 'moderation_blocked' || /moderation|safety/iu.test(error.message))
      return 'OpenAI a refusé cette description (filtre de sécurité).';
    if (error.status === 401) return 'Clé OpenAI refusée : vérifiez-la dans Clés et accès.';
    if (error.status === 403)
      return 'OpenAI refuse ce modèle d’image pour ce compte : l’organisation doit peut-être être vérifiée sur platform.openai.com.';
    if (error.status === 429)
      return 'Limite ou crédit OpenAI atteint : réessayez plus tard ou vérifiez la facturation.';
    if (error.status === 404) return 'Modèle d’image inconnu d’OpenAI pour ce compte.';
    return `OpenAI n’a pas pu créer l’image (erreur ${error.status ?? 'inconnue'}).`;
  }
  return error instanceof Error && error.message
    ? error.message.slice(0, 240)
    : 'Génération impossible.';
}
