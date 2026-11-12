/**
 * Vues du catalogue de modules et des mises à jour, échangées entre le serveur et
 * l'administration.
 */

export interface StoreModuleView {
  id: string;
  name: string;
  description: string;
  version: string | null;
  icon: string | null;
  minCoreVersion: string | null;
  /** Faux si le module demande une version de Cornelius plus récente. */
  compatible: boolean;
  installed: boolean;
  /** Chargé par le serveur en cours (sinon : après le prochain redémarrage). */
  loaded: boolean;
  /** Version chargée, si elle diffère de celle du dépôt. */
  loadedVersion: string | null;
  /** Raison d'un refus au démarrage, ou d'une installation impossible. */
  problem: string | null;
  /** Version proposée par la mise à jour en attente du dépôt. */
  nextVersion: string | null;
}

export interface StoreRepositoryView {
  id: string;
  url: string;
  /** « propriétaire/nom ». */
  name: string;
  /** Branche suivie ; `null` : celle par défaut du dépôt. */
  branch: string | null;
  official: boolean;
  commit: string | null;
  checkedAt: number | null;
  error: string | null;
  /** Commit plus récent déjà téléchargé, à appliquer. */
  update: { commit: string; changed: number; added: number } | null;
  modules: StoreModuleView[];
}

export interface StoreLocalModuleView {
  id: string;
  name: string;
  version: string | null;
  /** Masqué par la même version installée depuis un dépôt. */
  overridden: boolean;
}

export interface ModuleStoreView {
  /** Faux sans dossier de modules installés (tests, configuration particulière). */
  available: boolean;
  /** Recherches automatiques permises : un dépôt jamais lu est alors téléchargé à l’ouverture. */
  autoCheck: boolean;
  coreVersion: string;
  /** Une installation, un retrait ou une mise à jour attend un redémarrage. */
  pendingRestart: boolean;
  repositories: StoreRepositoryView[];
  /** Dossier local (cornelius-modules voisin ou CORNELIUS_MODULES_DIR), chargé tel quel. */
  local: { directory: string; modules: StoreLocalModuleView[] } | null;
}

export interface CoreUpdateCommit {
  sha: string;
  subject: string;
}

export interface CoreUpdateView {
  /** Faux : la mise à jour se fait ailleurs (raison donnée). */
  supported: boolean;
  reason: string | null;
  version: string;
  commit: string | null;
  branch: string | null;
  /** « stable » : dernière version publiée (tag vX.Y.Z) ; « branch » : la branche suivie. */
  channel: 'stable' | 'branch' | null;
  /** Modifications locales : la mise à jour est refusée. */
  dirty: boolean;
  checking: boolean;
  checkedAt: number | null;
  error: string | null;
  target: {
    ref: string;
    commit: string;
    version: string | null;
    count: number;
    commits: CoreUpdateCommit[];
  } | null;
  running: boolean;
  lastRun: { ok: boolean; message: string; at: number; from?: string; to?: string } | null;
}
