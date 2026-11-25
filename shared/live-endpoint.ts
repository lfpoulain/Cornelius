/** API Live d’OpenAI, remplacée par un serveur compatible choisi dans l’administration ou .env. */
export const DEFAULT_LIVE_BASE_URL = 'https://api.openai.com/v1';

/**
 * Nature du serveur Live : OpenAI (adresse par défaut), Localive (reconnu à sa liste de
 * modèles) ou un autre serveur compatible. Elle décide de ce que l’administration propose
 * pour la voix et la délégation.
 */
export type LiveServerKind = 'openai' | 'localive' | 'compatible';

/** Serveur Live tel que vu par l’administration ; la clé n’y figure jamais. */
export interface LiveEndpointView {
  /** Adresse saisie dans l’administration ; vide : celle de .env, sinon OpenAI. */
  baseUrl: string;
  /** CORNELIUS_LIVE_BASE_URL, lue au démarrage ; vide si absente. */
  envBaseUrl: string;
  /** Adresse réellement utilisée par la prochaine conversation. */
  effectiveBaseUrl: string;
  source: 'admin' | 'env' | 'default';
  /** Modèles lus sur le serveur avec « Charger la liste » ; vide tant qu’ils ne l’ont pas été. */
  models: string[];
  kind: LiveServerKind;
}

/** Modèles de conversation (gpt-live-1…) : ils ne servent pas à la délégation. */
export function isLiveConversationModel(id: string): boolean {
  return /^gpt-live/iu.test(id);
}

/** Modèles d’un serveur Live utilisables pour la délégation. */
export function delegationModelsOf(models: readonly string[]): string[] {
  return models.filter((id) => !isLiveConversationModel(id));
}

/**
 * Erreur d’une adresse de base Live, ou null si elle convient : http ou https, sans
 * identifiant, requête ni fragment. Une chaîne vide est valide (retour à la valeur par défaut).
 */
export function liveBaseUrlError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Adresse invalide.';
  const text = value.trim();
  if (!text) return null;
  if (text.length > 512) return 'Adresse trop longue : 512 caractères au plus.';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'Adresse invalide : adresse complète attendue, par exemple http://192.168.1.50:8000/v1.';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return 'Adresse invalide : http ou https.';
  if (url.username || url.password || url.search || url.hash)
    return 'Adresse invalide : sans identifiant, requête ni fragment.';
  return null;
}

/** Adresse sans espace ni barre finale. */
export function normalizeLiveBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '');
}

/**
 * Modèle de délégation imposé à un serveur Live personnalisé (OpenAI suit toujours le mode) :
 * vide pour suivre le mode (Luna ou Astra), sinon un identifiant
 * de modèle tel que le serveur le donne (lettres, chiffres, . _ : / -).
 */
export function isDelegationModel(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^[\w.:/-]{1,128}$/u.test(value));
}
