/**
 * Contrat addon v1 : le cœur possède l'enveloppe (ModuleSnapshot), l'instance,
 * les droits et le cache ; le module ne fournit que la collecte et la présentation.
 * Aucun module ne choisit son propriétaire ni ne prolonge sa propre validité.
 * Contrat gelé : toute évolution incompatible incrémente `apiVersion`.
 */

import { stripAccents } from './text.js';

export type AddonScope = { kind: 'household'; userId: null } | { kind: 'user'; userId: string };

export interface AddonInstance {
  id: string;
  addonId: string;
  profileId: string | null;
  ref: string | null;
  label: string;
  enabled: boolean;
  /** Affichage permanent choisi par l'administrateur, désactivé par défaut. */
  displayEnabled: boolean;
  config: Record<string, unknown>;
  configVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface AddonSource {
  provider: string;
  sourceId: string;
}

export interface ModuleSnapshot<TData extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: 1;
  snapshotId: string;
  cacheKey: string;
  revision: number;
  moduleId: string;
  dataVersion: number;
  scope: AddonScope;
  source: AddonSource | null;
  fetchedAt: string | null;
  observedAt: string | null;
  validUntil: string | null;
  status: 'ready' | 'empty' | 'stale' | 'error';
  data: TData | null;
}

/** Carte spécialisée remplie par le serveur depuis un snapshot valide. */
export interface ModuleCard {
  schemaVersion: 1;
  cardType: 'module';
  addonId: string;
  instanceRef: string | null;
  title: string;
  /** Icône de la valeur principale (`cardIcons`), facultative. */
  icon?: CardIcon;
  primaryValue: string | null;
  subtitle: string | null;
  description: string | null;
  items: CardItem[];
  sources: string[];
  snapshotId: string;
  stale: boolean;
}

export interface AddonHttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /**
   * GET seulement : réponse 200 gardée en mémoire et partagée, entre sources et modules,
   * pendant cette durée (10 minutes au plus). Pour un gros fichier commun (catalogue, état
   * d'un réseau) lu par plusieurs sources.
   */
  cacheMs?: number;
}

export interface AddonHttpResponse {
  status: number;
  headers: Record<string, string>;
  text(): string;
  json(): unknown;
  /** Vrai si le corps a été coupé à `maxBytes` : la fin manque. */
  truncated?: boolean;
  /** Adresse finale, après les redirections suivies. */
  url?: string;
}

/** Fourni par le cœur. Un module ne crée jamais son propre client réseau. */
export interface AddonHttpClient {
  fetch(request: AddonHttpRequest): Promise<AddonHttpResponse>;
}

export class AddonCollectError extends Error {
  constructor(
    readonly code:
      | 'config_invalid'
      | 'auth'
      | 'quota'
      | 'timeout'
      | 'upstream'
      | 'malformed'
      | 'unavailable'
      | 'forbidden'
      | 'not_found'
      | 'invalid_params',
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface AddonCollectContext<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  instance: AddonInstance;
  config: TConfig;
  http: AddonHttpClient;
  now(): number;
  signal: AbortSignal;
  /** Secret nommé, résolu côté serveur et jamais journalisé. */
  secret(name: string): string | undefined;
  /**
   * Question transmise par un outil qui déclare `query` : présente seulement pour cette lecture
   * à la demande, absente pour une lecture ordinaire (outil `read`, **Tester**, affichage).
   */
  query?: string;
  /**
   * Arguments typés d'un outil qui déclare `arguments`, déjà contrôlés par le cœur. Présents
   * seulement quand le modèle en donne au moins un : la lecture est alors à la demande.
   */
  args?: Record<string, AddonArgumentValue>;
  /** Fuseau horaire du foyer (IANA, par exemple « Europe/Paris »). */
  timeZone: string;
}

export interface AddonCollection<TData extends Record<string, unknown> = Record<string, unknown>> {
  data: TData;
  /**
   * Vrai quand la source a répondu sans rien à signaler (aucun passage, rien de prévu). Le
   * cœur appelle quand même `present` : si le module sait le dire, sa carte et sa phrase sont
   * utilisées ; s'il lève une exception, Cornelius dit « aucune donnée utile ».
   */
  empty?: boolean;
  observedAt?: number | null;
  source?: AddonSource | null;
  /** Fraîcheur propre au module, bornée par le cœur (5 secondes à 24 heures). */
  freshMs?: number;
  cacheKey?: string;
}

export interface AddonPresentContext {
  instance: AddonInstance;
  now(): number;
  /** Fuseau horaire du foyer (IANA, par exemple « Europe/Paris »). */
  timeZone: string;
}

export interface AddonPresentation {
  title: string;
  /** Icône de la valeur principale (`cardIcons`), facultative. */
  icon?: CardIcon;
  primaryValue: string | null;
  subtitle: string | null;
  description: string | null;
  items: CardItem[];
  /** Faits courts destinés à l'oral. */
  summary: string;
  sources?: string[];
}

/** Présentation permanente distincte des cartes de conversation. Texte uniquement. */
export interface AddonAmbientPresentation {
  /** Masquer la date de collecte pour un calcul local, sauf données périmées. Vrai par défaut. */
  showCollectedAt?: boolean;
  layout: 'metric' | 'list';
  title: string;
  /** Icône de la valeur (`cardIcons`), facultative. */
  icon?: CardIcon;
  value: string | null;
  subtitle: string | null;
  items: CardItem[];
  /**
   * Instant (ISO 8601) où cette présentation cesse d'être juste sans nouvelle collecte :
   * 17 h pour « ce soir », la fin d'un rendez-vous, minuit. Le cœur la recalcule alors, sans
   * réseau. Absent : recalculée à la prochaine collecte.
   */
  refreshAt?: string;
}

export interface AmbientDisplay {
  instanceId: string;
  profileId: string | null;
  addonId: string;
  label: string;
  status: 'loading' | 'ready' | 'empty' | 'stale' | 'error';
  fetchedAt: string | null;
  validUntil: string | null;
  content: AddonAmbientPresentation | null;
}

export interface AddonToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /**
   * Extension compatible v1 : lecture à la demande. L'argument `query` de l'appel (une chaîne
   * non vide, `maxLength` caractères au plus) est transmis à `collect` ; le résultat ne passe
   * ni par le cache ni par le repli sur le dernier succès, et n'est pas enregistré.
   */
  query?: { maxLength: number };
  /**
   * Extension compatible v1 : arguments typés et bornés que le modèle peut donner
   * (« la semaine prochaine », « le SP98 »). Le cœur les ajoute aux paramètres de l'outil,
   * les contrôle, puis les passe à `collect` dans `context.args`. Un appel avec au moins un
   * argument est une lecture à la demande : ni cache, ni repli, ni enregistrement.
   */
  arguments?: Record<string, AddonToolArgument>;
}

export type AddonArgumentValue = string | number | boolean;

/** Argument d'outil : un entier borné, un choix dans une liste, ou oui-non. */
export type AddonToolArgument =
  | { type: 'integer'; description: string; minimum: number; maximum: number }
  | { type: 'string'; description: string; enum: string[] }
  | { type: 'boolean'; description: string };

/** Icônes proposées aux modules pour l'administration (noms Lucide). */
export const addonIcons = [
  'bell',
  'bike',
  'book-open',
  'bus',
  'calendar',
  'calendar-days',
  'car',
  'clapperboard',
  'clock',
  'cloud-sun',
  'droplets',
  'fuel',
  'gift',
  'graduation-cap',
  'heart',
  'history',
  'house',
  'leaf',
  'map-pin',
  'music',
  'newspaper',
  'package',
  'party-popper',
  'play',
  'plug',
  'scroll-text',
  'shopping-cart',
  'sun',
  'thermometer',
  'train-front',
  'trash-2',
  'tree-palm',
  'tv',
  'utensils',
  'wind',
  'zap',
] as const;

export type AddonIcon = (typeof addonIcons)[number];

/**
 * Icônes des cartes du miroir et de l'affichage permanent (noms Lucide) : météo et alertes.
 * Liste fermée, comme celle de l'administration : un nom inconnu rend la carte non conforme.
 * Un module qui s'en sert déclare le `minCoreVersion` qui l'apporte, ou vérifie que
 * `cardIcons` existe avant d'envoyer une icône.
 */
export const cardIcons = [
  'cloud',
  'cloud-drizzle',
  'cloud-fog',
  'cloud-hail',
  'cloud-lightning',
  'cloud-moon',
  'cloud-moon-rain',
  'cloud-rain',
  'cloud-snow',
  'cloud-sun',
  'cloud-sun-rain',
  'droplets',
  'haze',
  'moon',
  'snowflake',
  'sun',
  'sunrise',
  'sunset',
  'thermometer',
  'thermometer-snowflake',
  'thermometer-sun',
  'tornado',
  'triangle-alert',
  'umbrella',
  'wind',
] as const;

export type CardIcon = (typeof cardIcons)[number];

/** Ligne d'une carte : libellé, valeur et, facultative, une icône devant le libellé. */
export interface CardItem {
  label: string;
  value: string;
  icon?: CardIcon;
}

/**
 * Présentation du module dans l'administration, facultative : sans elle, le module prend
 * son `sourceLabel`, l'icône de prise et la phrase « la source de … ».
 */
export interface AddonDisplay {
  /** Nom du module, 40 caractères au plus (« Météo »). */
  name: string;
  /** Ce que le module apporte, en une phrase de 160 caractères au plus. */
  description: string;
  icon?: AddonIcon;
  /** Groupe du catalogue : « Au quotidien » (par défaut) ou « Maison ». */
  group?: 'daily' | 'home';
  /** Mots qui retrouvent le module dans la recherche du catalogue. */
  keywords?: string[];
  /** Exemple proposé pour une nouvelle source : nom affiché et identifiant. */
  example?: { label: string; ref: string };
  /**
   * Phrase qui désigne une source à la voix : `head` la commence (« la météo »), les mots de
   * `repeats` sont retirés de l'identifiant (« meteo-maison » donne « la météo de maison »).
   */
  spoken?: { head: string; repeats?: string[] };
}

/** Champ de recherche assistée : l'admin propose des choix, l'utilisateur ne saisit pas d'identifiant. */
export interface AddonSearchField {
  kind: string;
  label: string;
  /** Champ de configuration qui reçoit l'identifiant choisi. */
  target: string;
  /** Champ de configuration qui reçoit le libellé lisible du choix. */
  labelTarget?: string;
  /** Champ de configuration qui doit être renseigné avant de chercher. */
  dependsOn?: string;
  placeholder?: string;
  /** Libellé du bouton qui efface un choix facultatif (« Toutes les directions »). */
  clearLabel?: string;
}

export interface AddonSearchInput {
  kind: string;
  query?: string;
  values: Record<string, unknown>;
}

export interface AddonSearchResult {
  id: string;
  label: string;
  detail?: string;
}

export interface AddonSearchContext {
  http: AddonHttpClient;
  signal: AbortSignal;
  secret(name: string): string | undefined;
  /** Fuseau horaire du foyer (IANA). Facultatif pour les recherches écrites avant 0.2.0. */
  timeZone?: string;
}

export interface AddonSearchCapability {
  fields: AddonSearchField[];
  find(input: AddonSearchInput, context: AddonSearchContext): Promise<AddonSearchResult[]>;
}

/**
 * Jeton à renseigner dans le fichier .env. Le module le lit par `context.secret(name)` ;
 * l'administration sait seulement s'il est présent, jamais sa valeur.
 */
export interface AddonSecretRequirement {
  /** Nom passé à `context.secret()`, par exemple `meteoConceptToken`. */
  name: string;
  /** Variable du fichier .env, par exemple `CORNELIUS_METEO_CONCEPT_TOKEN`. */
  env: string;
  /** Jeton précédé de « un » ou « une », repris dans « Ce module a besoin d’un jeton… ». */
  label: string;
  /** Page d'inscription où obtenir le jeton. */
  url?: string;
  /** Précision courte affichée entre parenthèses, par exemple « gratuit ». */
  note?: string;
}

export interface AddonDefinition<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  apiVersion: 1;
  version: string;
  /** Version minimale du cœur (« x.y.z »), facultative : un cœur plus ancien refuse le module. */
  minCoreVersion?: string;
  /** Libellé public de la source, affiché sur les cartes. */
  sourceLabel: string;
  /** Présentation dans l'administration, facultative et compatible v1. */
  display?: AddonDisplay;
  /** Jetons requis, facultatif et compatible v1 : l'administration signale ceux qui manquent. */
  secrets?: AddonSecretRequirement[];
  configVersion: number;
  configSchema: Record<string, unknown>;
  configDefaults: TConfig;
  configMigrate?(fromVersion: number, config: unknown): TConfig;
  dataSchema: Record<string, unknown>;
  dataVersion: number;
  /** Durée de fraîcheur d'une collecte réussie, bornée par le cœur de 5 secondes à 24 heures. */
  freshMs: number;
  tools: AddonToolDefinition[];
  /** Recherche assistée optionnelle (arrêts, directions) pour l'administration. */
  search?: AddonSearchCapability;
  /** Extension optionnelle compatible v1 ; affichage sans voix, réseau ni effets dans present. */
  ambient?: {
    present(
      snapshot: ModuleSnapshot<TData>,
      context: AddonPresentContext,
    ): AddonAmbientPresentation;
  };
  collect(context: AddonCollectContext<TConfig>): Promise<AddonCollection<TData>>;
  present(snapshot: ModuleSnapshot<TData>, context: AddonPresentContext): AddonPresentation;
}

export interface ToolResult {
  schemaVersion: 1;
  status:
    'succeeded' | 'empty' | 'stale' | 'failed' | 'pending_confirmation' | 'unknown' | 'cancelled';
  result: Record<string, unknown> | null;
  snapshotId: string | null;
  actionRunId: string | null;
  summary: string;
  error: { code: string; message: string; retryable: boolean } | null;
}

/** Résultat d'outil complet : seuls l'état et le résumé sont obligatoires. */
export function toolResult(
  status: ToolResult['status'],
  summary: string,
  extra: Partial<ToolResult> = {},
): ToolResult {
  return {
    schemaVersion: 1,
    status,
    result: null,
    snapshotId: null,
    actionRunId: null,
    summary,
    error: null,
    ...extra,
  };
}

/** Échec d'outil ; le message d'erreur reprend le résumé s'il n'est pas précisé. */
export function toolFailure(
  summary: string,
  code = 'unavailable',
  retryable = false,
  message = summary,
): ToolResult {
  return toolResult('failed', summary, { error: { code, message, retryable } });
}

export interface HttpActionDefinition {
  id: string;
  ref: string;
  label: string;
  /** Explication courte montrée au modèle pour choisir la commande. */
  description: string;
  method: 'GET' | 'POST';
  url: string;
  profileId: string | null;
  headers: Record<string, string>;
  body: string | null;
  confirmation: 'required' | 'none';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ActionRun {
  id: string;
  actionId: string;
  profileId: string | null;
  interactionId: string | null;
  idempotencyKey: string;
  status: 'succeeded' | 'failed' | 'unknown' | 'pending_confirmation' | 'cancelled';
  requestSummary: string | null;
  responseStatus: number | null;
  responseSummary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** Identifiant d'une source ou d'une commande, tel que la voix le désigne. */
export const REF_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$';

/** Nom d'en-tête HTTP (RFC 9110, « token ») : lettres, chiffres et quelques signes, sans espace. */
export const HEADER_NAME_PATTERN = "^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$";

const ligatures: Record<string, string> = { œ: 'oe', æ: 'ae', ø: 'o', ß: 'ss', đ: 'd', ł: 'l' };

/**
 * Identifiant complet tiré d'un texte libre : accents retirés, minuscules, tout autre signe
 * remplacé par un tiret. « Entrée principale » devient « entree-principale ».
 */
export function refFromText(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[œæøßđł]/gu, (letter) => ligatures[letter] ?? '-')
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^[-_]+/u, '')
    .slice(0, 64)
    .replace(/[-_]+$/u, '');
}

/**
 * Identifiant libre déduit d'un nom : « maison », puis « maison-2 », « maison-3 »… La base
 * garde la place d'un suffixe ; un nom sans lettre ni chiffre donne « source ».
 */
export function refFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base =
    refFromText(label)
      .slice(0, 60)
      .replace(/[-_]+$/u, '') || 'source';
  if (!taken.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function addonScope(instance: AddonInstance): AddonScope {
  return instance.profileId
    ? { kind: 'user', userId: instance.profileId }
    : { kind: 'household', userId: null };
}
