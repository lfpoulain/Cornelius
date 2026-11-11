import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Download,
  ExternalLink,
  FolderGit2,
  PackageCheck,
  RefreshCw,
  RotateCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { addonIcons, type AddonIcon } from '../../../shared/addons';
import type {
  ModuleStoreView,
  StoreModuleView,
  StoreRepositoryView,
} from '../../../shared/module-store';
import { api } from '../../api';
import type { RunAction } from './types';
import { addonIcon } from './addon-icons';
import { formatWhen, plural } from './format';
import { useAdminResource } from './useAdminResource';
import { ConfirmAction, LoadingCard } from './shared';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const shortCommit = (commit: string | null) => (commit ? commit.slice(0, 7) : '—');

function iconOf(name: string | null) {
  return addonIcon(
    name && (addonIcons as readonly string[]).includes(name) ? (name as AddonIcon) : undefined,
  );
}

/**
 * Catalogue de modules : les dépôts (l'officiel et ceux ajoutés), les modules de chacun à
 * installer ou désinstaller, et leurs mises à jour. Tout prend effet au redémarrage.
 */
export function ModuleStore({ run }: { run: RunAction }) {
  const load = useCallback(() => api.moduleStore(), []);
  const { data, error, loading, reload } = useAdminResource<ModuleStoreView>(load);
  const [view, setView] = useState<ModuleStoreView | null>(null);
  useEffect(() => setView(data), [data]);
  const current = view ?? data;

  // Premier passage : un dépôt jamais lu (l'officiel, à l'installation) est téléchargé.
  const firstRead = useRef(false);
  useEffect(() => {
    if (!current || firstRead.current) return;
    firstRead.current = true;
    if (!current.autoCheck) return;
    const unread = current.repositories.filter((repository) => !repository.commit);
    if (unread.length === 0) return;
    void (async () => {
      for (const repository of unread) {
        const next = await api.checkModuleRepository(repository.id).catch(() => null);
        if (next) setView(next);
      }
    })();
  }, [current]);

  /** Action du catalogue : la réponse est le nouvel état. */
  const act = (label: string, task: () => Promise<ModuleStoreView>) =>
    run(label, async () => setView(await task()));

  if (error && !current)
    return (
      <Alert variant="destructive">
        <AlertDescription className="gap-3">
          <p>Lecture impossible : {error}</p>
          <Button
            variant="outline"
            size="sm"
            className="text-foreground"
            disabled={loading}
            onClick={() => void reload()}
          >
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!current) return <LoadingCard label="Lecture du catalogue de modules…" />;
  if (!current.available)
    return (
      <Alert role="note">
        <AlertDescription>
          Le catalogue est fermé sur ce serveur (aucun dossier de modules installés).
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-5">
      {current.pendingRestart && <RestartNotice run={run} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Les modules viennent de dépôts git publics. Installer, désinstaller ou mettre à jour prend
          effet au redémarrage de Cornelius. Les sources d’un module désinstallé sont gardées pour
          une réinstallation.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void act('Dépôts vérifiés.', () => api.checkModuleRepositories())}
        >
          <RefreshCw aria-hidden="true" />
          Rechercher des mises à jour
        </Button>
      </div>
      {current.repositories.map((repository) => (
        <RepositoryCard
          key={repository.id}
          repository={repository}
          coreVersion={current.coreVersion}
          act={act}
        />
      ))}
      {current.local && current.local.modules.length > 0 && (
        <LocalFolderCard local={current.local} />
      )}
      <AddRepositoryCard act={act} />
    </div>
  );
}

function RestartNotice({ run }: { run: RunAction }) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Alert role="status">
      <RotateCw aria-hidden="true" />
      <AlertDescription className="gap-3 text-foreground">
        <p>Des changements de modules attendent un redémarrage de Cornelius pour s’appliquer.</p>
        {confirming ? (
          <ConfirmAction
            message="Redémarrer maintenant ? Une conversation en cours sera coupée."
            confirmLabel="Redémarrer"
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              void run('Redémarrage du serveur…', () => api.restartServer());
            }}
          />
        ) : (
          <div>
            <Button ref={trigger} size="sm" onClick={() => setConfirming(true)}>
              <RotateCw aria-hidden="true" />
              Redémarrer Cornelius
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

type Act = (label: string, task: () => Promise<ModuleStoreView>) => Promise<boolean>;

function RepositoryCard({
  repository,
  coreVersion,
  act,
}: {
  repository: StoreRepositoryView;
  coreVersion: string;
  act: Act;
}) {
  const [removing, setRemoving] = useState(false);
  const removeTrigger = useRef<HTMLButtonElement>(null);
  const installed = repository.modules.filter((module) => module.installed);
  const titleId = `repository-${repository.id}`;
  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="flex flex-wrap items-center gap-2">
          <FolderGit2 className="size-4" aria-hidden="true" />
          {repository.name}
          <Badge variant={repository.official ? 'default' : 'outline'}>
            {repository.official ? 'Dépôt officiel' : 'Dépôt ajouté'}
          </Badge>
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-3 gap-y-1">
          <a
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
            href={repository.url}
            target="_blank"
            rel="noreferrer"
          >
            {repository.url.replace(/^https:\/\//u, '')}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
          <span>Branche {repository.branch ?? 'par défaut'}</span>
          <span>Commit {shortCommit(repository.commit)}</span>
          <span>Vérifié : {formatWhen(repository.checkedAt)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {repository.error && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{repository.error}</AlertDescription>
          </Alert>
        )}
        {repository.update && (
          <Alert role="status">
            <Download aria-hidden="true" />
            <AlertDescription className="gap-2 text-foreground">
              <p>
                Mise à jour prête (commit {shortCommit(repository.update.commit)}) :{' '}
                {[
                  repository.update.changed > 0 &&
                    plural(repository.update.changed, 'module modifié', 'modules modifiés'),
                  repository.update.added > 0 &&
                    plural(repository.update.added, 'nouveau module', 'nouveaux modules'),
                ]
                  .filter(Boolean)
                  .join(', ') || 'corrections sans changement de version'}
                .
              </p>
              <div>
                <Button
                  size="sm"
                  onClick={() =>
                    void act('Mise à jour appliquée : redémarrez Cornelius.', () =>
                      api.updateModuleRepository(repository.id),
                    )
                  }
                >
                  <Download aria-hidden="true" />
                  Mettre à jour le dépôt
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {repository.modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {repository.commit
              ? 'Aucun module dans ce dépôt (un module est un dossier avec un index.ts).'
              : 'Catalogue pas encore téléchargé.'}
          </p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label={`Modules de ${repository.name}`}>
            {repository.modules.map((module) => (
              <ModuleRow
                key={module.id}
                module={module}
                repositoryId={repository.id}
                coreVersion={coreVersion}
                act={act}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void act('Dépôt vérifié.', () => api.checkModuleRepository(repository.id))
            }
          >
            <RefreshCw aria-hidden="true" />
            Vérifier ce dépôt
          </Button>
          {!repository.official &&
            (removing ? (
              <ConfirmAction
                message={
                  installed.length > 0
                    ? `Retirer ce dépôt désinstalle ${plural(installed.length, 'module')} (${installed
                        .map((module) => module.name)
                        .join(', ')}). Continuer ?`
                    : 'Retirer ce dépôt de la liste ?'
                }
                confirmLabel="Retirer"
                onCancel={() => setRemoving(false)}
                onConfirm={() => {
                  setRemoving(false);
                  void act('Dépôt retiré.', () => api.removeModuleRepository(repository.id));
                }}
              />
            ) : (
              <Button
                ref={removeTrigger}
                variant="outline"
                size="sm"
                onClick={() => setRemoving(true)}
              >
                <Trash2 aria-hidden="true" />
                Retirer le dépôt
              </Button>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

function moduleState(module: StoreModuleView): string | null {
  if (module.installed && !module.loaded) return 'Actif après redémarrage';
  if (!module.installed && module.loaded) return 'Retiré au redémarrage';
  if (module.loadedVersion)
    return `${module.loadedVersion} en service, ${module.version} au redémarrage`;
  return null;
}

function ModuleRow({
  module,
  repositoryId,
  coreVersion,
  act,
}: {
  module: StoreModuleView;
  repositoryId: string;
  coreVersion: string;
  act: Act;
}) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const Icon = iconOf(module.icon);
  const state = moduleState(module);
  const installable = !module.installed && !module.problem;
  return (
    <li className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {module.name}
            {module.version && (
              <span className="text-xs font-normal text-muted-foreground">
                {module.version}
                {module.nextVersion && ` → ${module.nextVersion}`}
              </span>
            )}
            {module.installed && (
              <Badge variant="secondary">
                <PackageCheck aria-hidden="true" />
                Installé
              </Badge>
            )}
            {state && <Badge variant="outline">{state}</Badge>}
          </p>
          <p className="text-sm text-muted-foreground">{module.description}</p>
          {module.problem && (
            <p
              className={
                module.installed ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
              }
            >
              {module.installed ? 'Refusé au démarrage : ' : ''}
              {module.problem}
              {!module.compatible && !module.installed && ` Cornelius installé : ${coreVersion}.`}
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        {module.installed ? (
          confirming ? (
            <ConfirmAction
              message={`Désinstaller « ${module.name} » ? Ses sources sont gardées.`}
              confirmLabel="Désinstaller"
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false);
                void act(`${module.name} désinstallé : redémarrez Cornelius.`, () =>
                  api.uninstallModule(module.id),
                );
              }}
            />
          ) : (
            <Button
              ref={trigger}
              variant="outline"
              size="sm"
              aria-label={`Désinstaller ${module.name}`}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" />
              Désinstaller
            </Button>
          )
        ) : (
          <Button
            size="sm"
            disabled={!installable}
            aria-label={`Installer ${module.name}`}
            onClick={() =>
              void act(`${module.name} installé : redémarrez Cornelius.`, () =>
                api.installModule(repositoryId, module.id),
              )
            }
          >
            <Download aria-hidden="true" />
            Installer
          </Button>
        )}
      </div>
    </li>
  );
}

function LocalFolderCard({ local }: { local: NonNullable<ModuleStoreView['local']> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderGit2 className="size-4" aria-hidden="true" />
          Dossier local
        </CardTitle>
        <CardDescription>
          Modules chargés tels quels depuis <code className="break-all">{local.directory}</code>{' '}
          (dépôt cloné à côté de Cornelius ou CORNELIUS_MODULES_DIR). Ils se mettent à jour par git,
          hors de cette page. Un module installé depuis un dépôt remplace celui du même nom.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {local.modules.map((module) => (
            <li key={module.id}>
              {module.name}{' '}
              <span className="text-muted-foreground">
                {module.version}
                {module.overridden && ' · remplacé par la version installée au redémarrage'}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AddRepositoryCard({ act }: { act: Act }) {
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await act('Dépôt ajouté.', () =>
      api.addModuleRepository(url.trim(), branch.trim() || null),
    );
    if (ok) {
      setUrl('');
      setBranch('');
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajouter un dépôt</CardTitle>
        <CardDescription>
          L’adresse https d’un dépôt public (GitHub, GitLab, Gitea, Forgejo, Codeberg) qui suit la
          forme de cornelius-modules : un dossier par module, avec son index.ts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert className="mb-4" role="note">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="text-foreground">
            Un module s’exécute avec les mêmes droits que Cornelius : il peut lire vos réglages et
            vos clés. N’installez que des modules dont vous connaissez l’auteur.
          </AlertDescription>
        </Alert>
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(event) => void submit(event)}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="module-repository-url">Adresse du dépôt</Label>
            <Input
              id="module-repository-url"
              type="url"
              inputMode="url"
              placeholder="https://github.com/nom/mes-modules"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="module-repository-branch">Branche (facultatif)</Label>
            <Input
              id="module-repository-branch"
              placeholder="par défaut"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!url.trim().startsWith('https://')}>
            Ajouter
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
