import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DiagnosticLog } from '../logs.js';
import type {
  ModuleStoreView,
  StoreLocalModuleView,
  StoreModuleView,
  StoreRepositoryView,
} from '../../shared/module-store.js';
import { readCatalog, type CatalogEntry } from './catalog.js';
import {
  downloadArchive,
  normalizeRepositoryUrl,
  RemoteError,
  resolveBranch,
  validBranch,
  type Fetch,
} from './git-remote.js';
import { extractTarGz, TarError } from './tar.js';

/**
 * Modules installés depuis des dépôts git : le dépôt officiel (cornelius-modules) et ceux que
 * la personne ajoute. Chaque dépôt est copié, à un commit précis, sous
 * `<dossier>/repositories/<dépôt>/<commit>/` ; un module installé est un dossier de cette
 * copie. Le dépôt entier est gardé, car ses modules partagent du code (`_lib/`).
 *
 * Rien n'est exécuté avant l'installation : le catalogue est lu dans les fichiers. Installer,
 * retirer ou mettre à jour prend effet au redémarrage suivant, comme le chargement des
 * modules au démarrage.
 */

export const officialRepositoryUrl = 'https://github.com/lfpoulain/cornelius-modules';

interface StoredRepository {
  id: string;
  url: string;
  branch: string | null;
  commit: string | null;
  /** Commit plus récent téléchargé, en attente d'être appliqué. */
  available: string | null;
  checkedAt: number | null;
  error: string | null;
}

interface StoredInstall {
  id: string;
  repository: string;
  installedAt: number;
}

interface StoreState {
  version: 1;
  repositories: StoredRepository[];
  installed: StoredInstall[];
}

/** Module à charger au démarrage. */
export interface ManagedModule {
  id: string;
  directory: string;
  repository: string;
}

export interface LoadedModuleInfo {
  /** Modules chargés : identifiant → version et origine. */
  loaded: Map<string, { version: string; origin: 'builtin' | 'local' | 'repository' }>;
  rejected: { name: string; reason: string }[];
  /** Modules du dossier local trouvés au démarrage. */
  local: { id: string; name: string; version: string | null }[];
  localDirectory: string | null;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function repositoryId(url: string): string {
  return url
    .replace(/^https:\/\//u, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80);
}

export class ModuleStore {
  private state: StoreState;
  private readonly stateFile: string;
  private readonly repositoriesRoot: string;
  /** Plan chargé au démarrage : comparé à l'état pour savoir s'il faut redémarrer. */
  private bootPlan: string;
  private loadedInfo: LoadedModuleInfo = {
    loaded: new Map(),
    rejected: [],
    local: [],
    localDirectory: null,
  };
  private readonly busy = new Set<string>();
  private catalogCache = new Map<string, CatalogEntry[]>();

  constructor(
    private readonly options: {
      directory: string;
      coreVersion: string;
      /** Téléchargements sans action de la personne (CORNELIUS_UPDATE_CHECK). */
      autoCheck?: boolean;
      /** Identifiants pris par le cœur (outils réservés, modules livrés). */
      reservedIds: () => ReadonlySet<string>;
      fetch?: Fetch;
      logs?: DiagnosticLog;
      now?: () => number;
    },
  ) {
    this.stateFile = join(options.directory, 'state.json');
    this.repositoriesRoot = join(options.directory, 'repositories');
    this.state = this.read();
    this.bootPlan = this.planKey();
  }

  private get fetcher(): Fetch {
    return this.options.fetch ?? fetch;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private read(): StoreState {
    const fresh: StoreState = {
      version: 1,
      repositories: [this.blankRepository(officialRepositoryUrl)],
      installed: [],
    };
    if (!existsSync(this.stateFile)) return fresh;
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<StoreState>;
      if (parsed.version !== 1 || !Array.isArray(parsed.repositories)) return fresh;
      const repositories = parsed.repositories.filter(
        (repository) => repository && normalizeRepositoryUrl(repository.url) === repository.url,
      );
      // Le dépôt officiel reste toujours proposé.
      if (!repositories.some((repository) => repository.url === officialRepositoryUrl))
        repositories.unshift(this.blankRepository(officialRepositoryUrl));
      const ids = new Set(repositories.map((repository) => repository.id));
      return {
        version: 1,
        repositories,
        installed: (parsed.installed ?? []).filter(
          (install) => install && typeof install.id === 'string' && ids.has(install.repository),
        ),
      };
    } catch (error) {
      this.options.logs?.write('warn', 'addon', 'État des modules installés illisible', { error });
      return fresh;
    }
  }

  private blankRepository(url: string, branch: string | null = null): StoredRepository {
    return {
      id: repositoryId(url),
      url,
      branch,
      commit: null,
      available: null,
      checkedAt: null,
      error: null,
    };
  }

  private async save(): Promise<void> {
    mkdirSync(this.options.directory, { recursive: true });
    const temporary = `${this.stateFile}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state, null, 2) + '\n', 'utf8');
    await rename(temporary, this.stateFile);
  }

  private snapshotDirectory(repository: StoredRepository, commit: string): string {
    return join(this.repositoriesRoot, repository.id, commit);
  }

  private catalog(repository: StoredRepository, commit: string | null): CatalogEntry[] {
    if (!commit) return [];
    const key = `${repository.id}@${commit}`;
    const cached = this.catalogCache.get(key);
    if (cached) return cached;
    const entries = readCatalog(this.snapshotDirectory(repository, commit));
    this.catalogCache.set(key, entries);
    return entries;
  }

  /** Clé du plan de chargement : identifiant → dossier. */
  private planKey(): string {
    return JSON.stringify(
      this.plan()
        .map((module) => `${module.id}=${module.directory}`)
        .sort(),
    );
  }

  /** Modules installés à charger, dans leur copie du dépôt. */
  plan(): ManagedModule[] {
    const modules: ManagedModule[] = [];
    for (const install of this.state.installed) {
      const repository = this.state.repositories.find((item) => item.id === install.repository);
      if (!repository?.commit) continue;
      const directory = join(this.snapshotDirectory(repository, repository.commit), install.id);
      if (!existsSync(join(directory, 'index.ts'))) continue;
      modules.push({ id: install.id, directory, repository: repository.url });
    }
    return modules;
  }

  /** Ce que le registre a chargé au démarrage, pour l'afficher à côté du catalogue. */
  setLoaded(info: LoadedModuleInfo): void {
    this.loadedInfo = info;
    this.bootPlan = this.planKey();
    this.cleanup();
  }

  /** Copies de dépôts que plus rien ne désigne : retirées au démarrage. */
  private cleanup(): void {
    if (!existsSync(this.repositoriesRoot)) return;
    const keep = new Set(
      this.state.repositories.flatMap((repository) =>
        [repository.commit, repository.available]
          .filter((commit): commit is string => !!commit)
          .map((commit) => this.snapshotDirectory(repository, commit)),
      ),
    );
    for (const repositoryDirectory of readdirSync(this.repositoriesRoot)) {
      const parent = join(this.repositoriesRoot, repositoryDirectory);
      let children: string[] = [];
      try {
        children = readdirSync(parent);
      } catch {
        continue;
      }
      for (const child of children) {
        const directory = join(parent, child);
        if (keep.has(directory)) continue;
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch {
          /* Fichier encore ouvert (Windows) : retenté au prochain démarrage. */
        }
      }
      if (!this.state.repositories.some((repository) => repository.id === repositoryDirectory))
        try {
          rmSync(parent, { recursive: true, force: true });
        } catch {
          /* idem */
        }
    }
  }

  private repository(id: string): StoredRepository {
    const repository = this.state.repositories.find((item) => item.id === id);
    if (!repository) throw new StoreError('Dépôt inconnu.', 404);
    return repository;
  }

  private async exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) throw new StoreError('Opération déjà en cours pour ce dépôt.', 409);
    this.busy.add(key);
    try {
      return await task();
    } finally {
      this.busy.delete(key);
    }
  }

  /** Télécharge et extrait un commit, si sa copie n'existe pas déjà. */
  private async download(repository: StoredRepository, commit: string): Promise<void> {
    const target = this.snapshotDirectory(repository, commit);
    if (existsSync(target)) return;
    const archive = await downloadArchive(this.fetcher, repository.url, commit);
    const staging = `${target}.${randomBytes(4).toString('hex')}.partial`;
    try {
      extractTarGz(archive, staging);
      // Sans package.json « module » au-dessus d'eux (data/ hors du dépôt, sous Home
      // Assistant), les .ts seraient lus en CommonJS et `#cornelius/…` introuvable.
      const manifest = join(staging, 'package.json');
      let esm = false;
      try {
        esm = JSON.parse(readFileSync(manifest, 'utf8'))?.type === 'module';
      } catch {
        esm = false;
      }
      if (!esm)
        writeFileSync(manifest, JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n');
      renameSync(staging, target);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  private describe(error: unknown): string {
    if (error instanceof RemoteError || error instanceof TarError || error instanceof StoreError)
      return error.message;
    this.options.logs?.write('warn', 'addon', 'Dépôt de modules : erreur inattendue', { error });
    return 'Erreur inattendue, voir le journal.';
  }

  async addRepository(input: { url: string; branch?: string | null }): Promise<string> {
    const url = normalizeRepositoryUrl(input.url);
    if (!url)
      throw new StoreError(
        'Adresse invalide : donnez l’adresse https d’un dépôt public, par exemple https://github.com/nom/depot.',
      );
    const branch = input.branch?.trim() || null;
    if (branch && !validBranch(branch)) throw new StoreError('Nom de branche invalide.');
    if (this.state.repositories.some((repository) => repository.url === url))
      throw new StoreError('Ce dépôt est déjà dans la liste.', 409);
    if (this.state.repositories.length >= 20) throw new StoreError('Vingt dépôts au plus.');
    const repository = this.blankRepository(url, branch);
    if (this.state.repositories.some((item) => item.id === repository.id))
      throw new StoreError('Ce dépôt est déjà dans la liste.', 409);
    // Le dépôt n'est gardé que s'il se lit : une faute de frappe ne reste pas dans la liste.
    await this.exclusive(repository.id, async () => {
      const resolved = await resolveBranch(this.fetcher, url, branch).catch((error: unknown) => {
        throw new StoreError(this.describe(error));
      });
      await this.download(repository, resolved.commit).catch((error: unknown) => {
        throw new StoreError(this.describe(error));
      });
      repository.commit = resolved.commit;
      repository.checkedAt = this.now();
      this.state.repositories.push(repository);
      await this.save();
    });
    this.options.logs?.write('info', 'addon', 'Dépôt de modules ajouté', {
      repository: url,
      modules: this.catalog(repository, repository.commit).map((entry) => entry.id),
    });
    return repository.id;
  }

  async removeRepository(id: string): Promise<void> {
    const repository = this.repository(id);
    if (repository.url === officialRepositoryUrl)
      throw new StoreError('Le dépôt officiel ne peut pas être retiré.');
    const removed = this.state.installed.filter((install) => install.repository === id);
    this.state.installed = this.state.installed.filter((install) => install.repository !== id);
    this.state.repositories = this.state.repositories.filter((item) => item.id !== id);
    await this.save();
    this.options.logs?.write('info', 'addon', 'Dépôt de modules retiré', {
      repository: repository.url,
      uninstalled: removed.map((install) => install.id),
    });
  }

  /**
   * Cherche un commit plus récent. Un dépôt sans module installé passe directement au
   * nouveau commit ; sinon la copie est préparée et attend « Mettre à jour ».
   */
  async check(id: string): Promise<void> {
    const repository = this.repository(id);
    await this.exclusive(id, async () => {
      try {
        const resolved = await resolveBranch(this.fetcher, repository.url, repository.branch);
        if (resolved.commit !== repository.commit) {
          await this.download(repository, resolved.commit);
          const used = this.state.installed.some((install) => install.repository === id);
          if (used && repository.commit) repository.available = resolved.commit;
          else {
            repository.commit = resolved.commit;
            repository.available = null;
          }
        } else repository.available = null;
        repository.error = null;
      } catch (error) {
        repository.error = this.describe(error);
      }
      repository.checkedAt = this.now();
      await this.save();
    });
  }

  async checkAll(): Promise<void> {
    for (const repository of [...this.state.repositories]) {
      if (this.busy.has(repository.id)) continue;
      await this.check(repository.id).catch(() => {});
    }
  }

  /** Applique la mise à jour téléchargée : effective au prochain redémarrage. */
  async update(id: string): Promise<void> {
    const repository = this.repository(id);
    if (!repository.available) throw new StoreError('Aucune mise à jour à appliquer.');
    const blocked = this.state.installed
      .filter((install) => install.repository === id)
      .map((install) =>
        this.catalog(repository, repository.available).find((e) => e.id === install.id),
      )
      .find(
        (entry) =>
          entry?.minCoreVersion &&
          compareVersions(this.options.coreVersion, entry.minCoreVersion) < 0,
      );
    if (blocked)
      throw new StoreError(
        `La nouvelle version de « ${blocked.name} » demande Cornelius ${blocked.minCoreVersion} : mettez d’abord Cornelius à jour.`,
      );
    const previous = repository.commit;
    repository.commit = repository.available;
    repository.available = null;
    await this.save();
    this.options.logs?.write('info', 'addon', 'Dépôt de modules mis à jour', {
      repository: repository.url,
      from: previous,
      to: repository.commit,
    });
  }

  async install(repositoryId: string, moduleId: string): Promise<void> {
    const repository = this.repository(repositoryId);
    const entry = this.catalog(repository, repository.commit).find((item) => item.id === moduleId);
    if (!entry) throw new StoreError('Module introuvable dans ce dépôt.', 404);
    const problem = this.installProblem(repository, entry);
    if (problem) throw new StoreError(problem);
    this.state.installed.push({ id: moduleId, repository: repositoryId, installedAt: this.now() });
    await this.save();
    this.options.logs?.write('info', 'addon', 'Module installé', {
      addonId: moduleId,
      repository: repository.url,
      version: entry.version,
    });
  }

  async uninstall(moduleId: string): Promise<void> {
    const install = this.state.installed.find((item) => item.id === moduleId);
    if (!install) throw new StoreError('Ce module n’est pas installé depuis un dépôt.', 404);
    this.state.installed = this.state.installed.filter((item) => item.id !== moduleId);
    await this.save();
    this.options.logs?.write('info', 'addon', 'Module désinstallé', { addonId: moduleId });
  }

  private installProblem(repository: StoredRepository, entry: CatalogEntry): string | null {
    if (entry.minCoreVersion && compareVersions(this.options.coreVersion, entry.minCoreVersion) < 0)
      return `Demande Cornelius ${entry.minCoreVersion} ou plus récent (installé : ${this.options.coreVersion}).`;
    if (this.options.reservedIds().has(entry.id))
      return 'Identifiant déjà pris par un module livré avec Cornelius.';
    const other = this.state.installed.find((install) => install.id === entry.id);
    if (other)
      return other.repository === repository.id
        ? 'Déjà installé.'
        : `Un module « ${entry.id} » est déjà installé depuis un autre dépôt.`;
    return null;
  }

  /** Installé depuis un dépôt ? Pour proposer « Désinstaller » à côté du module. */
  isManaged(moduleId: string): boolean {
    return this.state.installed.some((install) => install.id === moduleId);
  }

  view(): ModuleStoreView {
    const installedIds = new Set(this.state.installed.map((install) => install.id));
    const rejected = new Map(this.loadedInfo.rejected.map((item) => [item.name, item.reason]));
    const repositories: StoreRepositoryView[] = this.state.repositories.map((repository) => {
      const current = this.catalog(repository, repository.commit);
      const next = repository.available ? this.catalog(repository, repository.available) : null;
      const modules: StoreModuleView[] = current.map((entry) => {
        const install = this.state.installed.find((item) => item.id === entry.id);
        const installed = install?.repository === repository.id;
        const loaded = this.loadedInfo.loaded.get(entry.id);
        const loadedHere = installed && loaded?.origin === 'repository';
        const compatible =
          !entry.minCoreVersion ||
          compareVersions(this.options.coreVersion, entry.minCoreVersion) >= 0;
        const nextEntry = next?.find((item) => item.id === entry.id);
        return {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          icon: entry.icon,
          minCoreVersion: entry.minCoreVersion,
          compatible,
          installed,
          loaded: !!loadedHere,
          loadedVersion: loadedHere && loaded.version !== entry.version ? loaded.version : null,
          problem: installed
            ? (rejected.get(entry.id) ?? null)
            : this.installProblem(repository, entry),
          nextVersion: nextEntry && nextEntry.version !== entry.version ? nextEntry.version : null,
        };
      });
      let update: StoreRepositoryView['update'] = null;
      if (repository.available && next) {
        const before = new Map(current.map((entry) => [entry.id, entry.version]));
        update = {
          commit: repository.available,
          changed: next.filter(
            (entry) => before.has(entry.id) && before.get(entry.id) !== entry.version,
          ).length,
          added: next.filter((entry) => !before.has(entry.id)).length,
        };
      }
      return {
        id: repository.id,
        url: repository.url,
        name: repository.url.split('/').slice(-2).join('/'),
        branch: repository.branch,
        official: repository.url === officialRepositoryUrl,
        commit: repository.commit,
        checkedAt: repository.checkedAt,
        error: repository.error,
        update,
        modules,
      };
    });
    const local: StoreLocalModuleView[] = this.loadedInfo.local.map((module) => ({
      ...module,
      overridden: installedIds.has(module.id),
    }));
    return {
      available: true,
      autoCheck: this.options.autoCheck ?? false,
      coreVersion: this.options.coreVersion,
      pendingRestart: this.planKey() !== this.bootPlan,
      repositories,
      local: this.loadedInfo.localDirectory
        ? { directory: resolve(this.loadedInfo.localDirectory), modules: local }
        : null,
    };
  }
}
