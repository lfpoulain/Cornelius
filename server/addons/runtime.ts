import {
  AddonCollectError,
  addonScope,
  toolResult,
  type AddonArgumentValue,
  type AddonDefinition,
  type AddonDisplay,
  type AmbientDisplay,
  type AddonHttpClient,
  type AddonInstance,
  type AddonPresentation,
  type AddonSearchField,
  type AddonSearchResult,
  type AddonToolDefinition,
  type ModuleCard,
  type ModuleSnapshot,
  type ToolResult,
} from '../../shared/addons.js';
import { compile, validators } from '../../shared/validation.js';
import type { DiagnosticLog } from '../logs.js';
import type { AddonRepository } from '../storage.js';
import { configFieldErrors, type ConfigFieldError } from './config-errors.js';

/** Un calendrier change rarement : un relevé peut rester valable une journée. */
const maxFreshMs = 24 * 60 * 60_000;
const minFreshMs = 5_000;
export const defaultTimeZone = 'Europe/Paris';

type ToolArgs = Record<string, AddonArgumentValue>;

/** Paramètres annoncés au modèle : ceux du module, plus ses arguments typés, facultatifs. */
function toolParameters(tool: AddonToolDefinition): Record<string, unknown> {
  if (!tool.arguments) return tool.parameters;
  const base = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
  const properties = { ...(base.properties ?? {}) };
  const required = [...(base.required ?? [])];
  for (const [name, arg] of Object.entries(tool.arguments)) {
    properties[name] =
      arg.type === 'integer'
        ? {
            type: ['integer', 'null'],
            minimum: arg.minimum,
            maximum: arg.maximum,
            description: arg.description,
          }
        : arg.type === 'string'
          ? { type: ['string', 'null'], enum: [...arg.enum, null], description: arg.description }
          : { type: ['boolean', 'null'], description: arg.description };
    if (!required.includes(name)) required.push(name);
  }
  return { ...tool.parameters, properties, required };
}

/** Arguments donnés par le modèle, contrôlés un à un ; un argument absent ou nul est omis. */
function readArguments(
  tool: AddonToolDefinition,
  raw: unknown,
): { ok: true; args: ToolArgs } | { ok: false; message: string } {
  const args: ToolArgs = {};
  const given = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const [name, arg] of Object.entries(tool.arguments ?? {})) {
    const value = given[name];
    if (value === null || value === undefined || value === '') continue;
    if (arg.type === 'integer') {
      const number = typeof value === 'string' && /^-?\d+$/u.test(value) ? Number(value) : value;
      if (
        !Number.isInteger(number) ||
        (number as number) < arg.minimum ||
        (number as number) > arg.maximum
      )
        return {
          ok: false,
          message: `Paramètre « ${name} » : entier de ${arg.minimum} à ${arg.maximum} attendu.`,
        };
      args[name] = number as number;
    } else if (arg.type === 'string') {
      if (typeof value !== 'string' || !arg.enum.includes(value))
        return { ok: false, message: `Paramètre « ${name} » : valeur non proposée.` };
      args[name] = value;
    } else {
      if (typeof value !== 'boolean')
        return { ok: false, message: `Paramètre « ${name} » : oui ou non attendu.` };
      args[name] = value;
    }
  }
  return { ok: true, args };
}
/** Séparateur des noms d'outils Live, aligné sur les instructions de configuration.ts. */
const toolSeparator = '__';

export interface AddonReadSuccess {
  ok: true;
  instance: AddonInstance;
  snapshot: ModuleSnapshot;
  presentation: AddonPresentation;
  card: ModuleCard;
  stale: boolean;
  /** Rien à signaler, dit par le module lui-même (« rien de prévu »). */
  empty: boolean;
}

export interface AddonReadFailure {
  ok: false;
  status: Extract<ToolResult['status'], 'empty' | 'failed' | 'stale'>;
  summary: string;
  error: { code: string; message: string; retryable: boolean };
}

export type AddonReadOutcome = AddonReadSuccess | AddonReadFailure;

export interface AddonToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AddonRuntimeOptions {
  addons: AddonDefinition[];
  instances: AddonRepository;
  http: AddonHttpClient;
  logs?: DiagnosticLog;
  now?: () => number;
  secrets?: Record<string, string | undefined>;
  /** Lue à chaque appel, avant `secrets` : une clé changée dans l’administration compte aussitôt. */
  secretSource?: (name: string) => string | undefined;
  /** Fuseau horaire du foyer, transmis aux modules (« Europe/Paris » par défaut). */
  timeZone?: string;
}

function iso(time: number | null): string | null {
  return time === null ? null : new Date(time).toISOString();
}

function instanceKey(instance: AddonInstance): string {
  return JSON.stringify([
    instance.id,
    instance.addonId,
    instance.profileId,
    instance.ref,
    instance.enabled,
    instance.configVersion,
    instance.config,
  ]);
}

function fail(
  summary: string,
  error: AddonReadFailure['error'],
  status: AddonReadFailure['status'] = 'failed',
): AddonReadFailure {
  return { ok: false, status, summary, error };
}

/** Exécute les addons pour le compte du serveur : droits, cache et enveloppe appartiennent au cœur. */
export class AddonRuntime {
  private readonly addons = new Map<string, AddonDefinition>();
  private readonly configValidators = new Map<string, ReturnType<typeof compile>>();
  private readonly dataValidators = new Map<string, ReturnType<typeof compile>>();
  private readonly inflight = new Map<
    string,
    { promise: Promise<ModuleSnapshot>; signal: AbortSignal }
  >();
  private readonly now: () => number;
  /** Fuseau du foyer, commun à tous les modules. */
  readonly timeZone: string;
  /** Numéro des lectures à la demande, pour des snapshotId distincts sans persistance. */
  private querySequence = 0;

  constructor(private readonly options: AddonRuntimeOptions) {
    for (const addon of options.addons) this.addons.set(addon.id, addon);
    this.now = options.now ?? Date.now;
    this.timeZone = options.timeZone ?? defaultTimeZone;
  }

  private presentContext(instance: AddonInstance) {
    return { instance, now: this.now, timeZone: this.timeZone };
  }

  list(): AddonDefinition[] {
    return [...this.addons.values()];
  }

  get(id: string): AddonDefinition | undefined {
    return this.addons.get(id);
  }

  /** Outils exposés à Luna, préfixés par l'identifiant d'addon et limités au profil actif. */
  tools(profileId: string | null = null): AddonToolDescriptor[] {
    const authorized = this.sourcesFor(profileId);
    return this.list().flatMap((addon) => {
      const sources = authorized.filter((source) => source.addonId === addon.id);
      return addon.tools.map((tool) => ({
        name: `${addon.id}${toolSeparator}${tool.name}`,
        description: this.describeTool(addon, tool.description, sources, profileId !== null),
        parameters: toolParameters(tool),
      }));
    });
  }

  /**
   * La description porte les sources autorisées : le modèle tient ses identifiants du
   * tooling seul, jamais d'un contexte livré à l'ouverture. Tant que le propriétaire n'est
   * pas résolu (session anonyme du mode 1), la description reste neutre : l'identité est
   * ajoutée après reconnaissance, et une négation prématurée serait contredite.
   */
  private describeTool(
    addon: AddonDefinition,
    description: string,
    sources: { ref: string | null; label: string }[],
    resolved: boolean,
  ): string {
    if (sources.length === 0)
      return resolved
        ? `${description} Aucune source « ${addon.sourceLabel} » n’est autorisée pour ce profil.`
        : description;
    const list = sources
      .map((source) => (source.ref ? `${source.ref} (${source.label})` : source.label))
      .join(', ');
    if (sources.length === 1)
      return `${description} Source autorisée : ${list}. Laisse instanceRef vide.`;
    return `${description} Sources autorisées : ${list}. Utilise l’identifiant exact dans instanceRef, sans l’inventer.`;
  }

  /** Résout un nom d'outil Live vers un module connu, ou null. */
  parseTool(name: string): { addonId: string; toolName: string } | null {
    const separator = name.indexOf(toolSeparator);
    if (separator <= 0) return null;
    const addonId = name.slice(0, separator);
    const toolName = name.slice(separator + toolSeparator.length);
    const addon = this.addons.get(addonId);
    if (!addon || !addon.tools.some((tool) => tool.name === toolName)) return null;
    return { addonId, toolName };
  }

  sourceLabel(addonId: string): string {
    return this.addons.get(addonId)?.sourceLabel ?? addonId;
  }

  async invoke(
    name: string,
    profileId: string | null,
    instanceRef: string | null,
    signal: AbortSignal,
    args: unknown = {},
  ): Promise<{ outcome: AddonReadOutcome; tool: ToolResult } | null> {
    const parsed = this.parseTool(name);
    if (!parsed) return null;
    const tool = this.addons
      .get(parsed.addonId)!
      .tools.find((candidate) => candidate.name === parsed.toolName)!;
    let query: string | null = null;
    if (tool.query) {
      const raw =
        args && typeof args === 'object' ? (args as Record<string, unknown>).query : undefined;
      query = typeof raw === 'string' ? raw.trim() : '';
      if (!query || query.length > tool.query.maxLength) {
        const outcome = fail(
          query ? 'Question trop longue : reformulez plus court.' : 'Question manquante.',
          { code: 'invalid_params', message: 'Question invalide.', retryable: false },
        );
        return { outcome, tool: this.toolResult(outcome) };
      }
    }
    const checked = readArguments(tool, args);
    if (!checked.ok) {
      const outcome = fail(checked.message, {
        code: 'invalid_params',
        message: checked.message,
        retryable: false,
      });
      return { outcome, tool: this.toolResult(outcome) };
    }
    const outcome = await this.read(
      parsed.addonId,
      profileId,
      instanceRef,
      signal,
      query,
      Object.keys(checked.args).length ? checked.args : null,
    );
    return { outcome, tool: this.toolResult(outcome) };
  }

  secret(name: string): string | undefined {
    const value = this.options.secretSource
      ? this.options.secretSource(name)
      : this.options.secrets?.[name];
    return value && value.trim() ? value : undefined;
  }

  /** Valide une configuration candidate ; les erreurs sont rattachées à leur champ, en français. */
  validateConfig(
    addonId: string,
    config: unknown,
  ): { ok: true } | { ok: false; message: string; errors: ConfigFieldError[] } {
    const addon = this.addons.get(addonId);
    if (!addon) return { ok: false, message: 'Module inconnu.', errors: [] };
    const validate = this.validator(
      this.configValidators,
      `${addon.id}@${addon.configVersion}`,
      addon.configSchema,
    );
    if (validate(config)) return { ok: true };
    const errors = configFieldErrors(addon.configSchema, validate.errors, config);
    return {
      ok: false,
      message: 'Réglage incomplet : vérifiez les champs signalés.',
      errors: errors.length ? errors : [{ path: '', message: 'Réglage invalide pour ce module.' }],
    };
  }

  /** Recherche assistée exécutée par le module, avec le client HTTP du cœur. */
  async search(
    addonId: string,
    input: { kind: string; query?: string; values?: Record<string, unknown> },
    signal: AbortSignal,
  ): Promise<AddonSearchResult[]> {
    const capability = this.addons.get(addonId)?.search;
    if (!capability) throw new Error('Recherche indisponible pour ce module.');
    if (!capability.fields.some((field) => field.kind === input.kind))
      throw new Error('Type de recherche inconnu.');
    return capability.find(
      { kind: input.kind, query: input.query, values: input.values ?? {} },
      {
        http: this.options.http,
        signal,
        secret: (name) => this.secret(name),
        timeZone: this.timeZone,
      },
    );
  }

  /**
   * Aperçu d'une source pour l'administration (« 20 vélos · Mairie - Opéra ») : valeur et
   * sous-titre de la carte du module, calculés sans réseau sur le dernier relevé.
   */
  preview(instance: AddonInstance): string | null {
    const addon = this.addons.get(instance.addonId);
    const snapshot = this.options.instances.getSnapshot(instance);
    if (!addon || !snapshot?.data || snapshot.dataVersion !== addon.dataVersion) return null;
    try {
      const card = addon.present(snapshot, this.presentContext(instance));
      const text = [card.primaryValue, card.subtitle].filter(Boolean).join(' · ');
      return text ? (text.length > 120 ? `${text.slice(0, 119)}…` : text) : null;
    } catch {
      return null;
    }
  }

  definitions(): {
    id: string;
    version: string;
    sourceLabel: string;
    display: AddonDisplay | null;
    configVersion: number;
    configSchema: Record<string, unknown>;
    configDefaults: Record<string, unknown>;
    dataVersion: number;
    tools: { name: string; description: string }[];
    search: AddonSearchField[];
    ambient: boolean;
    secrets: {
      env: string;
      label: string;
      url: string | null;
      note: string | null;
      configured: boolean;
    }[];
  }[] {
    return this.list().map((addon) => ({
      id: addon.id,
      version: addon.version,
      sourceLabel: addon.sourceLabel,
      display: addon.display ?? null,
      configVersion: addon.configVersion,
      configSchema: addon.configSchema,
      configDefaults: addon.configDefaults,
      dataVersion: addon.dataVersion,
      tools: addon.tools.map((tool) => ({
        name: `${addon.id}${toolSeparator}${tool.name}`,
        description: tool.description,
      })),
      search: addon.search?.fields ?? [],
      ambient: !!addon.ambient,
      // Présence seulement : la valeur d'un jeton ne quitte jamais le serveur.
      secrets: (addon.secrets ?? []).map((secret) => ({
        env: secret.env,
        label: secret.label,
        url: secret.url ?? null,
        note: secret.note ?? null,
        configured: this.secret(secret.name) !== undefined,
      })),
    }));
  }

  /** Sources d'affichage : résolution directe par instance, même sans référence vocale. */
  ambientInstances(profileId: string | null): AddonInstance[] {
    return this.authorized(profileId)
      .filter(({ addon, instance }) => !!addon.ambient && instance.displayEnabled)
      .map(({ instance }) => instance);
  }

  ambientSnapshot(instance: AddonInstance): ModuleSnapshot | null {
    const addon = this.addons.get(instance.addonId);
    const snapshot = this.options.instances.getSnapshot(instance);
    if (!snapshot || snapshot.dataVersion !== addon?.dataVersion) return null;
    if (snapshot.status === 'ready' && Date.parse(snapshot.validUntil ?? '') <= this.now())
      return { ...snapshot, status: 'stale' };
    return snapshot;
  }

  ambientDisplay(instance: AddonInstance): AmbientDisplay {
    const snapshot = this.ambientSnapshot(instance);
    const display: AmbientDisplay = {
      instanceId: instance.id,
      profileId: instance.profileId,
      addonId: instance.addonId,
      label: instance.label,
      status: snapshot?.status ?? 'loading',
      fetchedAt: snapshot?.fetchedAt ?? null,
      validUntil: snapshot?.validUntil ?? null,
      content: null,
    };
    if (!snapshot?.data) return display;
    try {
      const content = this.addons
        .get(instance.addonId)
        ?.ambient?.present(snapshot, this.presentContext(instance));
      if (!validators.ambientPresentation(content))
        return snapshot.status === 'empty' ? display : { ...display, status: 'error' };
      return { ...display, content };
    } catch {
      // Rien à signaler sans phrase du module : « Aucune donnée disponible », pas une erreur.
      return snapshot.status === 'empty' ? display : { ...display, status: 'error' };
    }
  }

  async refreshAmbient(instance: AddonInstance, signal: AbortSignal): Promise<ModuleSnapshot> {
    const addon = this.addons.get(instance.addonId);
    if (
      !addon?.ambient ||
      !instance.displayEnabled ||
      !instance.enabled ||
      !this.isCurrent(instance)
    )
      throw new AddonCollectError('unavailable', 'Affichage désactivé.', false);
    return this.ensureSnapshot(instance, addon, signal);
  }

  private validator(
    cache: Map<string, ReturnType<typeof compile>>,
    key: string,
    schema: Record<string, unknown>,
  ) {
    const existing = cache.get(key);
    if (existing) return existing;
    const compiled = compile(schema);
    cache.set(key, compiled);
    return compiled;
  }

  private instanceFor(
    addonId: string,
    profileId: string | null,
    instanceRef: string | null,
  ): { instance: AddonInstance } | AddonReadFailure {
    const candidates = this.options.instances
      .instancesFor(addonId, profileId)
      .filter((instance) => instance.enabled);
    if (candidates.length === 0)
      return fail('Aucune source configurée pour cette demande.', {
        code: 'config_invalid',
        message: 'Aucune instance active pour ce module.',
        retryable: false,
      });
    if (instanceRef) {
      const match = candidates.find((instance) => instance.ref === instanceRef);
      if (match) return { instance: match };
      return fail(`Source « ${instanceRef} » inconnue pour ce module.`, {
        code: 'config_invalid',
        message: 'Instance inconnue.',
        retryable: false,
      });
    }
    if (candidates.length === 1) return { instance: candidates[0]! };
    const own = candidates.filter((instance) => instance.profileId === profileId);
    if (own.length === 1) return { instance: own[0]! };
    return fail('Plusieurs sources existent : précisez laquelle.', {
      code: 'config_invalid',
      message: 'Instance ambiguë.',
      retryable: false,
    });
  }

  /**
   * Lecture d'une source. Avec `query` (outil à la demande) ou des arguments typés, la
   * collecte est propre à cet appel : ni cache, ni regroupement, ni repli sur une réponse à
   * une autre question.
   */
  async read(
    addonId: string,
    profileId: string | null,
    instanceRef: string | null,
    signal: AbortSignal,
    query: string | null = null,
    args: ToolArgs | null = null,
  ): Promise<AddonReadOutcome> {
    const onDemand = query !== null || args !== null;
    const addon = this.addons.get(addonId);
    if (!addon)
      return fail('Ce module est inconnu.', {
        code: 'not_found',
        message: 'Addon inconnu.',
        retryable: false,
      });
    const resolved = this.instanceFor(addonId, profileId, instanceRef);
    if ('ok' in resolved) return resolved;
    const instance = resolved.instance;
    let snapshot: ModuleSnapshot;
    try {
      if (signal.aborted) throw new AddonCollectError('unavailable', 'Collecte annulée.', true);
      snapshot = onDemand
        ? await this.collectQuery(instance, addon, { query, args }, signal)
        : await this.ensureSnapshot(instance, addon, signal);
      if (signal.aborted || !this.isCurrent(instance))
        throw new AddonCollectError('unavailable', 'Collecte annulée ou source modifiée.', true);
    } catch (error) {
      const described = this.describe(error, { addonId: addon.id, instanceId: instance.id });
      // Sans relevé enregistré, le message du module est dit tout de suite.
      return fail(
        onDemand ? `Source indisponible : ${described.message}` : 'Source indisponible.',
        described,
      );
    }
    if (!snapshot.data) {
      const stored = this.options.instances.getError(instance.id);
      return fail(
        stored
          ? `Source indisponible : ${stored.message}`
          : 'Aucune donnée disponible pour le moment.',
        {
          code: stored?.code ?? 'unavailable',
          message: stored?.message ?? 'Aucune donnée.',
          retryable: stored?.retryable ?? true,
        },
      );
    }
    const empty = snapshot.status === 'empty';
    const nothing = () =>
      fail(
        'La source ne fournit aucune donnée utile pour le moment.',
        { code: 'unavailable', message: 'Données vides.', retryable: true },
        'empty',
      );
    let presentation: AddonPresentation;
    try {
      presentation = addon.present(snapshot, this.presentContext(instance));
    } catch (error) {
      // Rien à signaler, et le module ne sait pas le dire : la phrase générique du cœur.
      if (empty) return nothing();
      this.options.logs?.write('error', 'addon', 'Présentation de carte impossible', {
        addonId,
        instanceId: instance.id,
        error,
      });
      return fail('Données reçues mais illisibles.', {
        code: 'malformed',
        message: 'Présentation impossible.',
        retryable: false,
      });
    }
    const stale = snapshot.status === 'stale';
    const card: ModuleCard = {
      schemaVersion: 1,
      cardType: 'module',
      addonId: addon.id,
      instanceRef: instance.ref,
      title: presentation.title,
      ...(presentation.icon ? { icon: presentation.icon } : {}),
      primaryValue: presentation.primaryValue,
      subtitle: presentation.subtitle,
      description: presentation.description,
      items: presentation.items,
      sources: presentation.sources ?? [],
      snapshotId: snapshot.snapshotId,
      stale,
    };
    // Une carte hors contrat (titre trop long, trop de lignes…) serait refusée à l'affichage
    // alors que l'outil aurait répondu « réussi » : l'échec est dit ici, détails au journal.
    if (!validators.moduleCard(card)) {
      if (empty) return nothing();
      this.options.logs?.write('error', 'addon', 'Carte de module non conforme', {
        addonId,
        instanceId: instance.id,
        errors: (validators.moduleCard.errors ?? [])
          .slice(0, 5)
          .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim()),
      });
      return fail('Données reçues mais illisibles.', {
        code: 'malformed',
        message: 'Carte de module non conforme.',
        retryable: false,
      });
    }
    return { ok: true, instance, snapshot, presentation, stale, card, empty };
  }

  toolResult(outcome: AddonReadOutcome): ToolResult {
    if (outcome.ok) {
      return toolResult(
        outcome.empty ? 'empty' : outcome.stale ? 'stale' : 'succeeded',
        outcome.presentation.summary,
        {
          result: {
            addonId: outcome.instance.addonId,
            instanceRef: outcome.instance.ref,
            title: outcome.presentation.title,
            value: outcome.presentation.primaryValue,
            summary: outcome.presentation.summary,
            data: outcome.snapshot.data,
            snapshotId: outcome.snapshot.snapshotId,
            stale: outcome.stale,
          },
          snapshotId: outcome.snapshot.snapshotId,
        },
      );
    }
    return toolResult(outcome.status, outcome.summary, { error: outcome.error });
  }

  private async ensureSnapshot(
    instance: AddonInstance,
    addon: AddonDefinition,
    signal: AbortSignal,
  ): Promise<ModuleSnapshot> {
    const existing = this.options.instances.getSnapshot(instance);
    const now = this.now();
    const valid =
      existing?.data !== null &&
      existing?.data !== undefined &&
      existing.dataVersion === addon.dataVersion &&
      existing.validUntil !== null &&
      Date.parse(existing.validUntil) > now;
    if (existing && valid) return existing;
    return this.refresh(instance, addon, signal);
  }

  /** Les requêtes identiques en vol sont regroupées ; une collecte ne rafraîchit jamais un échec. */
  refresh(
    instance: AddonInstance,
    addon: AddonDefinition,
    signal: AbortSignal,
  ): Promise<ModuleSnapshot> {
    const key = instanceKey(instance);
    const running = this.inflight.get(key);
    if (running && !running.signal.aborted)
      return running.promise.catch((error: unknown) => {
        // L'annulation du premier demandeur ne doit pas annuler une lecture encore active.
        if (running.signal.aborted && !signal.aborted && this.isCurrent(instance))
          return this.refresh(instance, addon, signal);
        throw error;
      });
    const promise = this.collect(instance, addon, signal).finally(() => {
      if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, { promise, signal });
    return promise;
  }

  /**
   * Collecte d'une lecture à la demande (question ou arguments) : mêmes contrôles qu'une
   * collecte ordinaire, mais le relevé reste en mémoire. Une erreur est levée telle quelle,
   * sans toucher au dernier relevé. La question n'est jamais journalisée.
   */
  private async collectQuery(
    instance: AddonInstance,
    addon: AddonDefinition,
    request: { query: string | null; args: ToolArgs | null },
    signal: AbortSignal,
  ): Promise<ModuleSnapshot> {
    const startedAt = this.now();
    const validateConfig = this.validator(
      this.configValidators,
      `${addon.id}@${instance.configVersion}`,
      addon.configSchema,
    );
    const config = this.migrateConfig(addon, instance);
    if (!validateConfig(config))
      throw new AddonCollectError('config_invalid', 'Configuration de source invalide.', false);
    const collection = await addon.collect({
      instance,
      config: config as Record<string, unknown>,
      http: this.options.http,
      now: this.now,
      signal,
      secret: (name) => this.secret(name),
      timeZone: this.timeZone,
      ...(request.query !== null ? { query: request.query } : {}),
      ...(request.args !== null ? { args: request.args } : {}),
    });
    if (signal.aborted || !this.isCurrent(instance))
      throw new AddonCollectError('unavailable', 'Collecte annulée ou source modifiée.', true);
    const validateData = this.validator(
      this.dataValidators,
      `${addon.id}@${addon.dataVersion}`,
      addon.dataSchema,
    );
    if (!validateData(collection.data))
      throw new AddonCollectError('malformed', 'Données de source non conformes.', false);
    const fetchedAt = this.now();
    const sequence = ++this.querySequence;
    this.options.logs?.write('info', 'addon', 'Lecture à la demande réussie', {
      addonId: addon.id,
      instanceId: instance.id,
      instanceRef: instance.ref,
      status: collection.empty ? 'empty' : 'ready',
      durationMs: fetchedAt - startedAt,
    });
    return {
      schemaVersion: 1,
      snapshotId: `${addon.id}:${instance.ref ?? instance.id}:q${sequence}`.slice(0, 128),
      cacheKey: `${addon.id}:${instance.ref ?? instance.id}:query`.slice(0, 256),
      revision: sequence,
      moduleId: addon.id,
      dataVersion: addon.dataVersion,
      scope: addonScope(instance),
      source: collection.source ?? null,
      fetchedAt: iso(fetchedAt),
      observedAt: iso(collection.observedAt ?? null),
      validUntil: iso(fetchedAt),
      status: collection.empty ? 'empty' : 'ready',
      data: collection.data as Record<string, unknown>,
    };
  }

  private isCurrent(instance: AddonInstance): boolean {
    const current = this.options.instances.getInstance(instance.id);
    return current !== null && instanceKey(current) === instanceKey(instance);
  }

  private async collect(
    instance: AddonInstance,
    addon: AddonDefinition,
    signal: AbortSignal,
  ): Promise<ModuleSnapshot> {
    const stored = this.options.instances.getSnapshot(instance);
    const previous = stored?.dataVersion === addon.dataVersion ? stored : null;
    const startedAt = this.now();
    try {
      const validateConfig = this.validator(
        this.configValidators,
        `${addon.id}@${instance.configVersion}`,
        addon.configSchema,
      );
      const config = this.migrateConfig(addon, instance);
      if (!validateConfig(config))
        throw new AddonCollectError('config_invalid', 'Configuration de source invalide.', false);
      const collection = await addon.collect({
        instance,
        config: config as Record<string, unknown>,
        http: this.options.http,
        now: this.now,
        signal,
        secret: (name) => this.secret(name),
        timeZone: this.timeZone,
      });
      if (signal.aborted || !this.isCurrent(instance))
        throw new AddonCollectError('unavailable', 'Collecte annulée ou source modifiée.', true);
      const validateData = this.validator(
        this.dataValidators,
        `${addon.id}@${addon.dataVersion}`,
        addon.dataSchema,
      );
      if (!validateData(collection.data))
        throw new AddonCollectError('malformed', 'Données de source non conformes.', false);
      const fetchedAt = this.now();
      const freshMs = Math.min(
        maxFreshMs,
        Math.max(minFreshMs, collection.freshMs ?? addon.freshMs),
      );
      const revision = (previous?.revision ?? 0) + 1;
      const observedAt = collection.observedAt ?? null;
      const snapshot: ModuleSnapshot = {
        schemaVersion: 1,
        snapshotId: `${addon.id}:${instance.ref ?? instance.id}:r${revision}`.slice(0, 128),
        cacheKey: (collection.cacheKey ?? `${addon.id}:${instance.ref ?? instance.id}`).slice(
          0,
          256,
        ),
        revision,
        moduleId: addon.id,
        dataVersion: addon.dataVersion,
        scope: addonScope(instance),
        source: collection.source ?? null,
        fetchedAt: iso(fetchedAt),
        observedAt: iso(observedAt),
        validUntil: iso(fetchedAt + freshMs),
        status: collection.empty ? 'empty' : 'ready',
        data: collection.data as Record<string, unknown>,
      };
      this.options.instances.saveSnapshot(instance, snapshot, null);
      this.options.logs?.write('info', 'addon', 'Collecte réussie', {
        addonId: addon.id,
        instanceId: instance.id,
        instanceRef: instance.ref,
        revision,
        status: snapshot.status,
        durationMs: this.now() - startedAt,
      });
      return snapshot;
    } catch (error) {
      // Une collecte obsolète ne doit jamais écraser le nouvel état ni recréer une source supprimée.
      if (signal.aborted || !this.isCurrent(instance)) throw error;
      const described = this.describe(error, { addonId: addon.id, instanceId: instance.id });
      if (previous?.data) {
        // Un succès vide reste vide : le transformer en « périmé » ferait échouer la présentation.
        const degraded: ModuleSnapshot = {
          ...previous,
          status: previous.status === 'empty' ? 'empty' : 'stale',
        };
        this.options.instances.saveSnapshot(instance, degraded, described);
        this.options.logs?.write('warn', 'addon', 'Collecte en échec ; dernier succès conservé', {
          addonId: addon.id,
          instanceId: instance.id,
          code: described.code,
          durationMs: this.now() - startedAt,
        });
        return degraded;
      }
      const empty: ModuleSnapshot = {
        schemaVersion: 1,
        snapshotId: `${addon.id}:${instance.ref ?? instance.id}:error`.slice(0, 128),
        cacheKey: `${addon.id}:${instance.ref ?? instance.id}`.slice(0, 256),
        revision: 0,
        moduleId: addon.id,
        dataVersion: addon.dataVersion,
        scope: addonScope(instance),
        source: null,
        fetchedAt: null,
        observedAt: null,
        validUntil: null,
        status: 'error',
        data: null,
      };
      this.options.instances.saveSnapshot(instance, empty, described);
      this.options.logs?.write('warn', 'addon', 'Première collecte en échec', {
        addonId: addon.id,
        instanceId: instance.id,
        code: described.code,
        retryable: described.retryable,
      });
      return empty;
    }
  }

  /**
   * Réglages d'une source tels que le formulaire de l'administration les montre : migrés par
   * `configMigrate`, comme à la collecte, sans rien écrire en base (c'est l'enregistrement du
   * formulaire qui fixe la nouvelle `configVersion`). Une migration qui échoue, ou qui ne rend
   * pas un objet, laisse les réglages enregistrés tels quels et une trace au journal.
   */
  editableConfig(instance: AddonInstance): Record<string, unknown> {
    const addon = this.addons.get(instance.addonId);
    if (!addon) return instance.config;
    try {
      const config: unknown = this.migrateConfig(addon, instance);
      if (config && typeof config === 'object' && !Array.isArray(config))
        return config as Record<string, unknown>;
      throw new Error('La migration ne rend pas un objet.');
    } catch (error) {
      this.options.logs?.write('warn', 'addon', 'Migration des réglages impossible', {
        addonId: addon.id,
        instanceId: instance.id,
        fromVersion: instance.configVersion,
        toVersion: addon.configVersion,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
      return instance.config;
    }
  }

  private migrateConfig(addon: AddonDefinition, instance: AddonInstance): Record<string, unknown> {
    if (instance.configVersion === addon.configVersion || !addon.configMigrate)
      return instance.config;
    return addon.configMigrate(instance.configVersion, instance.config) as Record<string, unknown>;
  }

  /**
   * Erreur exposée (à l'oral comme à l'administration). Une exception imprévue du module ne
   * livre jamais son texte brut, souvent technique : il va au journal, tronqué à 300 caractères.
   */
  private describe(
    error: unknown,
    context: { addonId: string; instanceId: string },
  ): { code: string; message: string; retryable: boolean } {
    if (error instanceof AddonCollectError)
      return { code: error.code, message: error.message, retryable: error.retryable };
    const raw = error instanceof Error ? error.message : String(error);
    this.options.logs?.write('error', 'addon', 'Erreur inattendue du module', {
      ...context,
      message: raw.slice(0, 300),
    });
    return {
      code: 'upstream',
      message: 'Le module a rencontré une erreur inattendue.',
      retryable: false,
    };
  }

  /** Utilisé par l'admin pour un test de collecte sans passer par une session Live. */
  async test(instance: AddonInstance): Promise<ModuleSnapshot> {
    const addon = this.addons.get(instance.addonId);
    if (!addon) throw new Error('Module inconnu.');
    const controller = new AbortController();
    return this.refresh(instance, addon, controller.signal);
  }

  private authorized(
    profileId: string | null,
  ): { addon: AddonDefinition; instance: AddonInstance }[] {
    const entries: { addon: AddonDefinition; instance: AddonInstance }[] = [];
    for (const addon of this.list())
      for (const instance of this.options.instances.instancesFor(addon.id, profileId))
        if (instance.enabled) entries.push({ addon, instance });
    return entries;
  }

  /** Sources autorisées pour ce propriétaire, telles que le modèle peut les nommer. */
  sourcesFor(profileId: string | null): { addonId: string; ref: string | null; label: string }[] {
    return this.authorized(profileId).map(({ addon, instance }) => ({
      addonId: addon.id,
      ref: instance.ref,
      label: instance.label,
    }));
  }
}
