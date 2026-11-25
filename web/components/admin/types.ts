import type { AddonDisplay } from '../../../shared/addons';

export interface RunOptions {
  /** Demandes d’un même réglage, regroupées ; le libellé par défaut. */
  key?: string;
  /**
   * Contenu de la demande. Absent : le contrôle qui l’a déclenchée (bouton, case, choix) et sa
   * valeur en tiennent lieu, ce qui distingue deux choix d’un double clic.
   */
  payload?: unknown;
  /**
   * Erreur affichée par l’appelant, sous le formulaire ou le champ concerné : elle ne passe
   * pas en plus par le message en bas à droite (voir la règle des retours, shared.tsx).
   */
  onError?: (error: unknown) => void;
}

/**
 * Enregistre une modification et affiche `label` quand elle réussit. Résout `true` si l’action
 * a abouti, `false` si elle a échoué ou a été ignorée (même demande déjà en cours).
 */
export type RunAction = (
  label: string,
  action: () => Promise<unknown>,
  options?: RunOptions,
) => Promise<boolean>;

export interface AddonConfigField {
  type?: string | string[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  /** Libellé du champ, tiré du config.schema.json du module. */
  title?: string;
  description?: string;
  examples?: unknown[];
  /** Choix proposés : une liste déroulante, valeurs affichées telles quelles. */
  enum?: unknown[];
  /** Choix proposés avec leur libellé : `{ const, title }`. */
  oneOf?: { const?: unknown; title?: string }[];
  /** Liste répétée : le schéma d’un élément (texte, choix, ou petit objet). */
  items?: AddonConfigField;
  minItems?: number;
  maxItems?: number;
  /** Propriétés d’un élément objet d’une liste, une colonne chacune. */
  properties?: Record<string, AddonConfigField>;
  required?: string[];
}

/** Erreur de réglage rattachée à un champ (`path` vide : le réglage entier). */
export interface AddonConfigError {
  path: string;
  message: string;
}

export interface AddonConfigSchema {
  properties?: Record<string, AddonConfigField>;
  required?: string[];
}

export interface AddonSearchFieldView {
  kind: string;
  label: string;
  target: string;
  labelTarget?: string;
  dependsOn?: string;
  placeholder?: string;
  clearLabel?: string;
}

export interface AddonSearchResultView {
  id: string;
  label: string;
  detail?: string;
}

/** Jeton déclaré par un module : sa présence seulement, jamais sa valeur. */
export interface AddonSecretView {
  env: string;
  label: string;
  url: string | null;
  note: string | null;
  /** Le module fonctionne sans : il est proposé sans bloquer l’ajout d’une source. */
  optional?: boolean;
  configured: boolean;
}

export interface AddonDefinitionView {
  id: string;
  version: string;
  sourceLabel: string;
  /** Présentation déclarée par le module ; null ou absente : son sourceLabel et la prise. */
  display?: AddonDisplay | null;
  configVersion: number;
  configSchema: AddonConfigSchema;
  configDefaults: Record<string, unknown>;
  dataVersion: number;
  tools: { name: string; description: string }[];
  search: AddonSearchFieldView[];
  ambient: boolean;
  /** Absent d’un serveur plus ancien. */
  secrets?: AddonSecretView[];
}

export interface AddonSnapshotView {
  snapshotId: string;
  status: 'ready' | 'empty' | 'stale' | 'error';
  revision: number;
  fetchedAt: string | null;
  validUntil: string | null;
  source: { provider: string; sourceId: string } | null;
  dataVersion: number;
  data: Record<string, unknown> | null;
}

export interface AddonErrorView {
  code: string;
  message: string;
  retryable: boolean;
  at: number;
}

export interface AddonInstanceView {
  id: string;
  addonId: string;
  profileId: string | null;
  ref: string | null;
  label: string;
  enabled: boolean;
  displayEnabled: boolean;
  config: Record<string, unknown>;
  configVersion: number;
  createdAt: number;
  updatedAt: number;
  snapshot: AddonSnapshotView | null;
  error: AddonErrorView | null;
  /** Aperçu du dernier relevé, tiré de la carte du module. Absent d'un serveur plus ancien. */
  preview?: string | null;
}

export interface AddonCatalog {
  definitions: AddonDefinitionView[];
  instances: AddonInstanceView[];
  /** Dossiers de modules refusés au démarrage et la raison du refus. */
  rejected?: { name: string; reason: string }[];
}

export interface AddonInstanceInput {
  enabled?: boolean;
  displayEnabled?: boolean;
  addonId: string;
  profileId: string | null;
  ref: string | null;
  label: string;
  config: Record<string, unknown>;
}

export interface AddonInstancePatch {
  profileId?: string | null;
  ref?: string | null;
  label?: string;
  enabled?: boolean;
  displayEnabled?: boolean;
  config?: Record<string, unknown>;
}

export interface AddonTestResult {
  snapshot: AddonSnapshotView;
  error: AddonErrorView | null;
}

export interface HttpActionView {
  id: string;
  ref: string;
  label: string;
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
  /** Secrets `${secret:NOM}` cités par la commande et absents du fichier .env. */
  missingSecrets?: string[];
}

export interface HttpActionInput {
  enabled?: boolean;
  ref: string;
  label: string;
  description: string;
  method: 'GET' | 'POST';
  url: string;
  profileId: string | null;
  headers: Record<string, string>;
  body: string | null;
  confirmation: 'required' | 'none';
}

export type HttpActionPatch = Partial<HttpActionInput> & { enabled?: boolean };

export interface ActionTestResultView {
  status: 'succeeded' | 'failed' | 'unknown';
  responseStatus: number | null;
  summary: string;
}

export interface ActionConfirmationView {
  id: string;
  actionId: string;
  profileId: string | null;
  interactionId: string | null;
  approvedAt: number | null;
  expiresAt: number;
}

export interface ActionRunView {
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
