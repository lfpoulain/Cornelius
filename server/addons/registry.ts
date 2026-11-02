import { readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import packageJson from '../../package.json' with { type: 'json' };
import {
  addonIcons,
  type AddonDefinition,
  type AddonDisplay,
  type AddonSecretRequirement,
  type AddonToolArgument,
} from '../../shared/addons.js';
import type { DiagnosticLog } from '../logs.js';
import { compile } from '../../shared/validation.js';
import './core-imports.js';

/**
 * Découverte dynamique des modules : un dossier `addons/<id>/` portant un `index.ts`
 * devient un module sans que le cœur soit modifié. La garantie de type perdue au
 * chargement est reprise ici par une validation runtime du contrat v1 : un module
 * invalide est signalé puis ignoré, jamais la cause d'un échec du serveur.
 * Les fixtures et schémas restent la propriété du module, le registre ne connaît
 * que la définition qu'il exporte par défaut.
 *
 * Deux dossiers sont parcourus : `addons/`, livré avec le dépôt, puis le dépôt de
 * modules externes (`cornelius-modules` cloné à côté de Cornelius, ou
 * `CORNELIUS_MODULES_DIR`), mis à jour indépendamment du cœur. Un module livré garde
 * toujours son identifiant.
 */

export interface AddonLoadReport {
  /** Modules acceptés, ordonnés par identifiant pour un catalogue déterministe. */
  addons: AddonDefinition[];
  /** Dossiers refusés : nom du dossier et raison courte, affichés au diagnostic. */
  rejected: { name: string; reason: string }[];
}

const entryFile = 'index.ts';
/** Un identifiant devient un nom d'outil (`<id>__<tool>`) : alphabet strict exigé. */
const idPattern = /^[a-z][a-z0-9_]{0,31}$/;
/** Préfixes des outils du cœur (`mail__send`, `image__recall`…) : un module n’en prend aucun. */
export const reservedAddonIds: ReadonlySet<string> = new Set([
  'agents',
  'alarms',
  'home_assistant',
  'http',
  'image',
  'mail',
  'memory',
  'ui',
  'vision',
  'web',
]);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Racine `addons/` déduite de ce fichier : le registre suit le dépôt, pas le cwd. */
const root = resolve(repository, 'addons');
/** Version du cœur, comparée au `minCoreVersion` facultatif des modules. */
export const coreVersion: string = packageJson.version;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/** Modules externes : `CORNELIUS_MODULES_DIR` (relatif au cwd), sinon `cornelius-modules` voisin du dépôt. */
export function externalAddonsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CORNELIUS_MODULES_DIR?.trim();
  return configured ? resolve(configured) : resolve(repository, '..', 'cornelius-modules');
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur inconnue.';
}

const secretNamePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const secretEnvPattern = /^[A-Z][A-Z0-9_]{0,99}$/u;

/** Jetons déclarés (champ facultatif) : noms stricts, page d'inscription en http(s). */
function validateSecrets(secrets: unknown): string | null {
  if (secrets === undefined) return null;
  if (!Array.isArray(secrets)) return 'liste de jetons invalide.';
  const names = new Set<string>();
  for (const secret of secrets as Partial<AddonSecretRequirement>[]) {
    if (
      !secret ||
      typeof secret !== 'object' ||
      typeof secret.name !== 'string' ||
      !secretNamePattern.test(secret.name) ||
      typeof secret.env !== 'string' ||
      !secretEnvPattern.test(secret.env) ||
      typeof secret.label !== 'string' ||
      !secret.label.trim() ||
      secret.label.length > 80 ||
      (secret.note !== undefined && (typeof secret.note !== 'string' || secret.note.length > 40))
    )
      return 'jeton déclaré invalide.';
    if (secret.url !== undefined) {
      let url: URL | null = null;
      try {
        url = typeof secret.url === 'string' ? new URL(secret.url) : null;
      } catch {
        url = null;
      }
      if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:'))
        return `page d’inscription du jeton « ${secret.name} » invalide.`;
    }
    if (names.has(secret.name)) return 'jeton déclaré deux fois.';
    names.add(secret.name);
  }
  return null;
}

const shortText = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Présentation dans l'administration (champ facultatif) : textes courts, icône connue. */
function validateDisplay(display: unknown): string | null {
  if (display === undefined) return null;
  const d = display as Partial<AddonDisplay> | null;
  if (!d || typeof d !== 'object') return 'présentation du module invalide.';
  if (!shortText(d.name, 40)) return 'nom du module invalide (40 caractères au plus).';
  if (!shortText(d.description, 160))
    return 'description du module invalide (160 caractères au plus).';
  if (d.icon !== undefined && !(addonIcons as readonly string[]).includes(d.icon))
    return `icône « ${String(d.icon)} » inconnue.`;
  if (d.group !== undefined && d.group !== 'daily' && d.group !== 'home')
    return 'groupe du module invalide (daily ou home).';
  if (
    d.keywords !== undefined &&
    (!Array.isArray(d.keywords) ||
      d.keywords.length > 20 ||
      !d.keywords.every((k) => shortText(k, 40)))
  )
    return 'mots-clés du module invalides.';
  if (
    d.example !== undefined &&
    (!d.example ||
      !shortText(d.example.label, 80) ||
      !/^[a-z0-9-]{1,64}$/u.test(d.example.ref ?? ''))
  )
    return 'exemple de source invalide.';
  if (
    d.spoken !== undefined &&
    (!d.spoken ||
      !shortText(d.spoken.head, 60) ||
      (d.spoken.repeats !== undefined &&
        (!Array.isArray(d.spoken.repeats) ||
          !d.spoken.repeats.every((word) => /^[a-z0-9]{1,30}$/u.test(word)))))
  )
    return 'phrase vocale du module invalide.';
  return null;
}

const argumentNamePattern = /^[a-z][a-zA-Z0-9_]{0,31}$/u;

/** Arguments typés d'un outil : quatre au plus, bornés, jamais `instanceRef` ni `query`. */
function validateArguments(args: unknown): string | null {
  if (args === undefined) return null;
  if (!args || typeof args !== 'object' || Array.isArray(args))
    return 'arguments d’outil invalides.';
  const entries = Object.entries(args as Record<string, Partial<AddonToolArgument>>);
  if (entries.length > 4) return 'quatre arguments d’outil au plus.';
  for (const [name, arg] of entries) {
    if (!argumentNamePattern.test(name) || name === 'instanceRef' || name === 'query')
      return `nom d’argument « ${name} » invalide.`;
    if (!arg || typeof arg !== 'object' || !shortText(arg.description, 200))
      return `argument « ${name} » sans description.`;
    if (arg.type === 'integer') {
      const { minimum, maximum } = arg as { minimum?: unknown; maximum?: unknown };
      if (
        !Number.isInteger(minimum) ||
        !Number.isInteger(maximum) ||
        (minimum as number) > (maximum as number) ||
        (maximum as number) - (minimum as number) > 10_000
      )
        return `argument « ${name} » : bornes entières attendues.`;
    } else if (arg.type === 'string') {
      const values = (arg as { enum?: unknown }).enum;
      if (
        !Array.isArray(values) ||
        values.length < 1 ||
        values.length > 30 ||
        new Set(values).size !== values.length ||
        !values.every((value) => shortText(value, 40))
      )
        return `argument « ${name} » : liste de choix attendue.`;
    } else if (arg.type !== 'boolean') return `argument « ${name} » : type inconnu.`;
  }
  return null;
}

/**
 * Contrôle de forme du contrat gelé `apiVersion: 1`. Les schémas sont compilés dès
 * le chargement pour isoler les modules invalides avant tout appel du modèle.
 */
export function validateAddonDefinition(addon: unknown, core = coreVersion): string | null {
  if (!addon || typeof addon !== 'object') return 'aucune définition exportée.';
  const candidate = addon as Partial<AddonDefinition>;
  if (candidate.apiVersion !== 1) return `apiVersion non supportée (attendu : 1).`;
  if (typeof candidate.id !== 'string' || !idPattern.test(candidate.id))
    return 'identifiant invalide.';
  if (typeof candidate.version !== 'string') return 'version absente.';
  if (candidate.minCoreVersion !== undefined) {
    if (
      typeof candidate.minCoreVersion !== 'string' ||
      !versionPattern.test(candidate.minCoreVersion)
    )
      return 'version minimale de Cornelius invalide (attendu : x.y.z).';
    if (compareVersions(core, candidate.minCoreVersion) < 0)
      return `nécessite Cornelius ${candidate.minCoreVersion} ou plus récent (installé : ${core}).`;
  }
  if (typeof candidate.sourceLabel !== 'string') return 'libellé de source absent.';
  if (!Number.isInteger(candidate.configVersion) || candidate.configVersion! < 1)
    return 'version de configuration absente.';
  if (!!candidate.configSchema && typeof candidate.configSchema !== 'object')
    return 'schéma de configuration invalide.';
  if (!candidate.configSchema) return 'schéma de configuration absent.';
  if (!candidate.configDefaults || typeof candidate.configDefaults !== 'object')
    return 'valeurs par défaut absentes.';
  if (!Number.isInteger(candidate.dataVersion) || candidate.dataVersion! < 1)
    return 'version de données absente.';
  if (!candidate.dataSchema || typeof candidate.dataSchema !== 'object')
    return 'schéma de données absent.';
  if (!Number.isInteger(candidate.freshMs) || candidate.freshMs! <= 0) return 'fraîcheur absente.';
  if (!Array.isArray(candidate.tools)) return 'liste d’outils absente.';
  const toolNames = new Set<string>();
  for (const tool of candidate.tools) {
    if (
      !tool ||
      typeof tool.name !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/u.test(tool.name) ||
      `${candidate.id}__${tool.name}`.length > 64 ||
      typeof tool.description !== 'string' ||
      !tool.parameters ||
      typeof tool.parameters !== 'object' ||
      (tool.query !== undefined &&
        (!tool.query ||
          !Number.isInteger(tool.query.maxLength) ||
          tool.query.maxLength < 1 ||
          tool.query.maxLength > 2000))
    )
      return 'définition d’outil invalide.';
    if (toolNames.has(tool.name)) return 'nom d’outil dupliqué.';
    toolNames.add(tool.name);
    const argsInvalid = validateArguments(tool.arguments);
    if (argsInvalid) return argsInvalid;
  }
  const displayInvalid = validateDisplay(candidate.display);
  if (displayInvalid) return displayInvalid;
  if (
    candidate.ambient !== undefined &&
    (!candidate.ambient || typeof candidate.ambient.present !== 'function')
  )
    return 'présentation permanente invalide.';
  const secretsInvalid = validateSecrets(candidate.secrets);
  if (secretsInvalid) return secretsInvalid;
  if (typeof candidate.collect !== 'function') return 'collecte absente.';
  if (typeof candidate.present !== 'function') return 'présentation absente.';
  if (
    candidate.search &&
    (typeof candidate.search.find !== 'function' ||
      !Array.isArray(candidate.search.fields) ||
      !candidate.search.fields.every(
        (field) =>
          field &&
          typeof field.kind === 'string' &&
          typeof field.label === 'string' &&
          typeof field.target === 'string',
      ))
  )
    return 'recherche assistée invalide.';
  const schemas: [string, unknown][] = [
    ['schéma de configuration', candidate.configSchema],
    ['schéma de données', candidate.dataSchema],
    ...candidate.tools.map((tool): [string, unknown] => [
      `paramètres de l’outil « ${tool.name} »`,
      tool.parameters,
    ]),
  ];
  for (const [label, schema] of schemas) {
    try {
      compile(schema as object);
    } catch (error) {
      return `${label} invalide : ${firstSchemaError(error)}`;
    }
  }
  return null;
}

/** Premier message d'Ajv, assez court pour la page Modules (« must be object »…). */
function firstSchemaError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const first = message.replace(/^schema is invalid: /u, '').split(/, (?=data)/u)[0] ?? message;
  const text = first.length > 160 ? first.slice(0, 159) + '…' : first;
  return text.endsWith('.') || text.endsWith('…') ? text : text + '.';
}

interface AddonLoadOptions {
  logs?: DiagnosticLog;
  /** Dossier des modules externes ; `null` n'en charge aucun. Défaut : `externalAddonsRoot()`. */
  externalRoot?: string | null;
}

/**
 * Parcourt `addons/` puis le dossier externe et charge chaque module isolément : un
 * dossier cassé est journalisé et n'empêche jamais les autres de charger.
 */
export async function loadAddons(options: AddonLoadOptions = {}): Promise<AddonLoadReport> {
  const report: AddonLoadReport = { addons: [], rejected: [] };
  await loadDirectory(root, false, report, options.logs);
  const external = options.externalRoot === undefined ? externalAddonsRoot() : options.externalRoot;
  if (external && resolve(external) !== root) {
    await loadDirectory(resolve(external), true, report, options.logs);
  }
  report.addons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (report.addons.length > 0 || report.rejected.length > 0)
    options.logs?.write('info', 'addon', 'Registre des modules chargé', {
      loaded: report.addons.map((addon) => addon.id),
      rejected: report.rejected,
    });
  return report;
}

/**
 * Le dossier externe peut être un dépôt entier (docs/, scripts/, node_modules/) : seuls
 * ses sous-dossiers munis d'un `index.ts` y sont des modules, les autres sont ignorés.
 */
async function loadDirectory(
  directoryRoot: string,
  external: boolean,
  report: AddonLoadReport,
  logs: DiagnosticLog | undefined,
): Promise<void> {
  const { addons, rejected } = report;
  let entries: string[] = [];
  try {
    entries = existsSync(directoryRoot) ? readdirSync(directoryRoot) : [];
  } catch (error) {
    logs?.write('warn', 'addon', 'Dossier des modules illisible', {
      directory: directoryRoot,
      error,
    });
    return;
  }
  for (const name of entries.sort()) {
    if (!idPattern.test(name) || name === 'node_modules') continue;
    const directory = resolve(directoryRoot, name);
    try {
      if (!statSync(directory).isDirectory()) continue;
    } catch {
      continue;
    }
    const entry = resolve(directory, entryFile);
    if (!existsSync(entry)) {
      if (!external) rejected.push({ name, reason: `point d’entrée « ${entryFile} » absent.` });
      continue;
    }
    if (reservedAddonIds.has(name)) {
      rejected.push({ name, reason: 'identifiant réservé à un outil de Cornelius.' });
      logs?.write('warn', 'addon', 'Module refusé : identifiant réservé', { addonId: name });
      continue;
    }
    if (external && addons.some((addon) => addon.id === name)) {
      rejected.push({ name, reason: 'identifiant déjà pris par un module livré avec Cornelius.' });
      logs?.write('warn', 'addon', 'Module externe refusé : identifiant déjà pris', {
        addonId: name,
      });
      continue;
    }
    try {
      const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
      const invalid = validateAddonDefinition(module.default);
      if (invalid) {
        rejected.push({ name, reason: invalid });
        logs?.write('warn', 'addon', 'Module refusé par le contrat v1', {
          addonId: name,
          reason: invalid,
          external,
        });
        continue;
      }
      const addon = module.default as AddonDefinition;
      if (addon.id !== name) {
        rejected.push({ name, reason: `identifiant « ${addon.id} » différent du dossier.` });
        logs?.write('warn', 'addon', 'Module refusé : identifiant incohérent', {
          addonId: name,
          declaredId: addon.id,
          external,
        });
        continue;
      }
      addons.push(addon);
    } catch (error) {
      rejected.push({ name, reason: describe(error) });
      logs?.write('warn', 'addon', 'Module non chargé', { addonId: name, error, external });
    }
  }
}
