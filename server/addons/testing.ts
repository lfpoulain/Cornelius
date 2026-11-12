/**
 * Ce dont les tests d'un module ont besoin, exposé par l'alias `#cornelius/testing` :
 * la validation du contrat, une base en mémoire et l'exécution réelle du cœur. Un
 * module externe s'y teste donc comme un module livré, sans chemin vers `server/`.
 *
 * `createTestModule` réunit le tout : une source créée, une horloge réglable, un client HTTP
 * simulé par une table d'adresses, et le contrôle du contrat en une ligne.
 */
import type {
  AddonArgumentValue,
  AddonDefinition,
  AddonHttpClient,
  AddonHttpRequest,
  AddonInstance,
  AmbientDisplay,
} from '../../shared/addons.js';
import { validators } from '../../shared/validation.js';
import { AddonRepository, openDatabase } from '../storage.js';
import { AddonRuntime, type AddonReadOutcome } from './runtime.js';
import { validateAddonDefinition } from './registry.js';

export { AddonRuntime } from './runtime.js';
export { validateAddonDefinition } from './registry.js';
export { AddonRepository, openDatabase } from '../storage.js';

/** Réponse détaillée : statut, corps, en-têtes, et corps coupé à `maxBytes` (`truncated`). */
export interface TestResponse {
  status: number;
  /** Un `Uint8Array` est rendu tel quel par `bytes()` (format binaire, protobuf GTFS-RT…). */
  body?: string | Uint8Array | Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
  truncated?: boolean;
}

/** Réponse simulée : un objet est envoyé en JSON, une chaîne ou des octets tels quels. */
export type TestReply = string | Uint8Array | Record<string, unknown> | unknown[] | TestResponse;

/**
 * Table des réponses : chaque clé est cherchée dans l'adresse demandée, la première qui y
 * figure répond ; une fonction reçoit la requête. Sans correspondance : 404.
 */
export type TestRoutes =
  | Record<string, TestReply | ((request: AddonHttpRequest) => TestReply)>
  | ((request: AddonHttpRequest) => TestReply);

export interface TestModuleOptions {
  /** Réglages de la source, par-dessus `configDefaults`. */
  config?: Record<string, unknown>;
  /** Instant de départ, ISO 8601 ou millisecondes (le 20 octobre 2026, 10 h, par défaut). */
  at?: string | number;
  /** Fuseau du foyer (« Europe/Paris » par défaut). */
  timeZone?: string;
  /** Réponses du réseau. */
  routes?: TestRoutes;
  /** Jetons déclarés par le module, par nom. */
  secrets?: Record<string, string>;
  /** Identifiant vocal de la source (« test » par défaut). */
  ref?: string;
}

function isReplyObject(reply: TestReply): reply is TestResponse {
  return (
    typeof reply === 'object' &&
    reply !== null &&
    !Array.isArray(reply) &&
    !(reply instanceof Uint8Array) &&
    typeof (reply as { status?: unknown }).status === 'number'
  );
}

function asResponse(reply: TestReply) {
  const { status, body, headers, truncated } = isReplyObject(reply)
    ? reply
    : { status: 200, body: reply, headers: {}, truncated: false };
  const bytes =
    body instanceof Uint8Array
      ? body
      : new TextEncoder().encode(
          body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
        );
  const text = new TextDecoder().decode(bytes);
  return {
    status,
    headers: headers ?? {},
    text: () => text,
    json: () => JSON.parse(text) as unknown,
    bytes: () => bytes.slice(),
    // Une réponse coupée à maxBytes par le client du cœur, simulée.
    truncated: truncated === true,
  };
}

/**
 * Prépare un module comme Cornelius le ferait : base en mémoire (fermée à la fin du test),
 * une source du foyer, l'exécution réelle du cœur. Les appels réseau sont relevés dans
 * `calls` et servis par `routes`.
 */
export function createTestModule(
  t: { after(fn: () => void): void },
  // Un module typé (réglages et données propres) se teste tel quel.
  addon: AddonDefinition<any, any>,
  options: TestModuleOptions = {},
) {
  const definition = addon as AddonDefinition;
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const ref = options.ref ?? 'test';
  let instance: AddonInstance = instances.createInstance({
    addonId: definition.id,
    profileId: null,
    ref,
    label: `Source ${ref}`,
    displayEnabled: !!definition.ambient,
    config: { ...definition.configDefaults, ...options.config },
    configVersion: definition.configVersion,
  });
  let now =
    typeof options.at === 'number' ? options.at : Date.parse(options.at ?? '2026-10-20T08:00:00Z');
  let routes: TestRoutes = options.routes ?? {};
  const calls: AddonHttpRequest[] = [];
  const http: AddonHttpClient = {
    async fetch(request) {
      calls.push(request);
      if (typeof routes === 'function') return asResponse(routes(request));
      const match = Object.entries(routes).find(([key]) => request.url.includes(key));
      if (!match) return asResponse({ status: 404, body: '' });
      const [, reply] = match;
      return asResponse(typeof reply === 'function' ? reply(request) : reply);
    },
  };
  const runtime = new AddonRuntime({
    addons: [definition],
    instances,
    http,
    now: () => now,
    timeZone: options.timeZone,
    secrets: options.secrets,
  });
  const signal = () => new AbortController().signal;
  return {
    runtime,
    instances,
    get instance() {
      return instance;
    },
    calls,
    /** Lecture ordinaire, comme l'outil `read` sans argument (cache compris). */
    read: () => runtime.read(definition.id, null, ref, signal()),
    /** Appel d'outil tel que le modèle le ferait : question et arguments typés contrôlés. */
    invoke: async (tool = 'read', args: Record<string, AddonArgumentValue | null> = {}) =>
      (await runtime.invoke(`${definition.id}__${tool}`, null, ref, signal(), {
        instanceRef: ref,
        ...args,
      }))!,
    /** Présentation permanente du dernier relevé. */
    ambient: (): AmbientDisplay => runtime.ambientDisplay(instance),
    /** Réglages modifiés : nouvelle version de la source, relevé effacé. */
    configure: (config: Record<string, unknown>) => {
      instance = instances.updateInstance(instance.id, {
        config: { ...instance.config, ...config },
      })!;
      instances.clearState(instance.id);
    },
    now: () => now,
    at: (time: string | number) => {
      now = typeof time === 'number' ? time : Date.parse(time);
    },
    advance: (ms: number) => {
      now += ms;
    },
    /** Remplace tout ou partie des réponses du réseau. */
    route: (next: TestRoutes) => {
      routes =
        typeof next === 'function' || typeof routes === 'function'
          ? next
          : { ...next, ...routes, ...next };
    },
    /**
     * Écarts au contrat d'une lecture réussie (définition, relevé, carte, affichage permanent,
     * résultat d'outil) ; une liste vide si tout est conforme.
     */
    contract: (outcome: AddonReadOutcome): string[] => {
      const problems: string[] = [];
      const definitionError = validateAddonDefinition(definition);
      if (definitionError) problems.push(`définition : ${definitionError}`);
      if (!outcome.ok) return [...problems, `lecture en échec : ${outcome.error.message}`];
      const check = (name: string, valid: boolean, errors: unknown) => {
        if (!valid) problems.push(`${name} : ${JSON.stringify(errors)}`);
      };
      check(
        'relevé',
        validators.moduleSnapshot(outcome.snapshot),
        validators.moduleSnapshot.errors,
      );
      check('carte', validators.moduleCard(outcome.card), validators.moduleCard.errors);
      const result = runtime.toolResult(outcome);
      check('résultat d’outil', validators.toolResult(result), validators.toolResult.errors);
      if (definition.ambient) {
        const display = runtime.ambientDisplay(instance);
        if (display.status === 'error') problems.push('affichage permanent : présentation refusée');
        else if (display.content)
          check(
            'affichage permanent',
            validators.ambientPresentation(display.content),
            validators.ambientPresentation.errors,
          );
      }
      return problems;
    },
  };
}
