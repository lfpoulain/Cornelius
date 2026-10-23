import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FlaskConical,
  Plus,
  RefreshCw,
  Trash2,
  Star,
  Settings2,
  KeyRound,
  ExternalLink,
  TriangleAlert,
  Webhook,
} from 'lucide-react';
import type { DevicesStatus, MirrorState, Profile } from '../../../shared/types';
import { api, errorMessage } from '../../api';
import type {
  AddonDefinitionView,
  AddonInstanceView,
  AddonCatalog,
  AddonSecretView,
  RunAction,
} from './types';
import { Actions } from './Actions';
import { HomeAssistantSettings } from './HomeAssistant';
import { VisionSettings } from './VisionSettings';
import { ImageGenerationSettings } from './ImageGenerationSettings';
import { WebSearchSettings } from './WebSearchSettings';
import { CardSettings } from './CardSettings';
import { Label } from '../ui/label';
import { InstanceForm } from './AddonForm';
import { addonIcon } from './addon-icons';
import { SecretField } from './Secrets';
import { useAdminResource } from './useAdminResource';
import { useConfirmations, waitingConfirmations } from './useConfirmations';
import { ConfirmAction, LoadingCard, ModulePanel, PersonPicker, SearchInput } from './shared';
import {
  commandsStatus,
  describeError,
  formatWhen,
  matchesSearch,
  moduleStatus,
  ownerLabel,
  plural,
  snapshotStatusLabel,
  sourceNeedsFix,
  sourceStatusLine,
  spokenPhrase,
} from './format';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';

const FAVORITES_KEY = 'cornelius.modules.favorites';

/**
 * Nom, description, icône et mots-clés d'un module : ceux qu'il déclare (`display`), sinon
 * son `sourceLabel` et la prise par défaut. Livrés et externes sont traités pareil.
 */
function moduleDisplay(definition: AddonDefinitionView) {
  const display = definition.display;
  return {
    name: display?.name ?? definition.sourceLabel,
    description: display?.description ?? 'Source d’informations pour la conversation.',
    icon: addonIcon(display?.icon),
    keywords: (display?.keywords ?? []).join(' '),
    group: display?.group ?? 'daily',
  };
}

type GroupId = 'daily' | 'home' | 'capabilities';

const moduleGroups: { id: GroupId; title: string; description: string }[] = [
  {
    id: 'daily',
    title: 'Au quotidien',
    description: 'L’heure, la météo et les transports, à la demande ou affichés en permanence.',
  },
  {
    id: 'home',
    title: 'Maison',
    description: 'Les appareils de la maison et les commandes que Cornelius peut déclencher.',
  },
  {
    id: 'capabilities',
    title: 'Capacités de Cornelius',
    description: 'Ce que Cornelius sait faire en plus : chercher sur le web, voir et dessiner.',
  },
];

// Les modules livrés ouvrent « Au quotidien », dans cet ordre ; les autres suivent par nom.
const dailyOrder = ['clock', 'weather', 'transit', 'ragator'];

// Modules intégrés : ils ne dépendent pas d’une personne et se retrouvent par mots-clés.
const builtIns = [
  {
    id: 'home-assistant',
    group: 'home',
    name: 'Home Assistant',
    keywords:
      'home assistant maison lumière lumières prises domotique capteur capteurs minuterie température',
    householdOnly: true,
  },
  {
    id: 'commands',
    group: 'home',
    name: 'Commandes HTTP',
    keywords: 'commandes http adresse url webhook portail volet scène action validation',
    householdOnly: false,
  },
  {
    id: 'cards',
    group: 'capabilities',
    name: 'Cartes',
    keywords: 'cartes carte affichage écran nombre durée disparition second plan raccourcir',
    householdOnly: false,
  },
  {
    id: 'web',
    group: 'capabilities',
    name: 'Web',
    keywords: 'web recherche internet actualité google sources',
    householdOnly: false,
  },
  {
    id: 'vision',
    group: 'capabilities',
    name: 'Vision',
    keywords: 'vision caméra voir image',
    householdOnly: false,
  },
  {
    id: 'image-generation',
    group: 'capabilities',
    name: 'Génération d’image',
    keywords: 'images génération dessin illustration création',
    householdOnly: false,
  },
] as const satisfies readonly {
  id: string;
  group: GroupId;
  name: string;
  keywords: string;
  householdOnly: boolean;
}[];

function readFavorites(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function Addons({
  state,
  run,
  status,
  openCommands = false,
}: {
  state: MirrorState;
  run: RunAction;
  status: DevicesStatus | null;
  /** Adresse #modules/commandes : le module Commandes HTTP s’ouvre et vient à l’écran. */
  openCommands?: boolean;
}) {
  const profiles = state.profiles;
  const [owner, setOwner] = useState('all');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(readFavorites);
  // L’ordre suit les favoris connus à l’ouverture : cliquer une étoile ne déplace pas le
  // module sous le pointeur, le nouvel ordre s’applique à la prochaine visite.
  const [pinned] = useState(favorites);
  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id)
      ? favorites.filter((value) => value !== id)
      : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      /* Organization still works for this page. */
    }
  };
  const favoriteButton = (id: string, name: string) => (
    <Button
      className="admin-module-favorite"
      variant="ghost"
      size="sm"
      aria-label={'Favori : ' + name}
      aria-pressed={favorites.includes(id)}
      title={favorites.includes(id) ? 'Retirer des favoris' : 'Placer en tête de son groupe'}
      onClick={() => toggleFavorite(id)}
    >
      <Star className={favorites.includes(id) ? 'fill-primary text-primary' : ''} />
    </Button>
  );
  const loadCatalog = useCallback(() => api.addons(), []);
  const {
    data: catalog,
    error: loadError,
    loading,
    reload,
  } = useAdminResource<AddonCatalog>(loadCatalog);

  if (loadError && !catalog)
    return (
      <Alert variant="destructive">
        <AlertDescription className="gap-3">
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!catalog) return <LoadingCard label="Lecture des modules installés…" />;

  const builtInVisible = (entry: (typeof builtIns)[number]) =>
    matchesSearch(search, entry.name, entry.keywords) &&
    (!entry.householdOnly || owner === 'all' || owner === 'household');
  const definitionVisible = (definition: AddonDefinitionView) => {
    const display = moduleDisplay(definition);
    return matchesSearch(
      search,
      display.name,
      display.keywords,
      display.description,
      definition.sourceLabel,
      ...catalog.instances
        .filter((instance) => instance.addonId === definition.id)
        .map((instance) => instance.label),
    );
  };
  type Entry =
    | { id: string; group: GroupId; builtIn: (typeof builtIns)[number]; definition: null }
    | { id: string; group: GroupId; builtIn: null; definition: AddonDefinitionView };
  const definitions = [...catalog.definitions].sort(
    (a, b) =>
      (dailyOrder.indexOf(a.id) + 1 || dailyOrder.length + 1) -
        (dailyOrder.indexOf(b.id) + 1 || dailyOrder.length + 1) ||
      moduleDisplay(a).name.localeCompare(moduleDisplay(b).name, 'fr'),
  );
  const moduleEntry = (definition: AddonDefinitionView): Entry => ({
    id: definition.id,
    group: moduleDisplay(definition).group,
    builtIn: null,
    definition,
  });
  // Dans « Maison », un module vient après Home Assistant et les commandes HTTP.
  const entries: Entry[] = [
    ...definitions.filter((d) => moduleDisplay(d).group === 'daily').map(moduleEntry),
    ...builtIns.map((entry): Entry => ({
      id: entry.id,
      group: entry.group,
      builtIn: entry,
      definition: null,
    })),
    ...definitions.filter((d) => moduleDisplay(d).group === 'home').map(moduleEntry),
  ];
  const visible = (entry: Entry) =>
    entry.builtIn ? builtInVisible(entry.builtIn) : definitionVisible(entry.definition);
  const nothingVisible = !entries.some(visible);

  const renderEntry = (entry: Entry) => {
    // Masqués plutôt que retirés : une recherche ne referme pas le panneau ni ne perd la
    // saisie en cours.
    const hidden = !visible(entry);
    if (entry.builtIn) {
      const props = { hidden, action: favoriteButton(entry.id, entry.builtIn.name) };
      if (entry.id === 'home-assistant')
        return <HomeAssistantSettings key={entry.id} {...props} run={run} />;
      if (entry.id === 'commands')
        return (
          <CommandsPanel
            key={entry.id}
            {...props}
            profiles={profiles}
            run={run}
            openOnArrival={openCommands}
          />
        );
      if (entry.id === 'web')
        return <WebSearchSettings key={entry.id} {...props} state={state} run={run} />;
      if (entry.id === 'cards')
        return <CardSettings key={entry.id} {...props} state={state} run={run} />;
      if (entry.id === 'vision')
        return <VisionSettings key={entry.id} {...props} status={status} run={run} />;
      return <ImageGenerationSettings key={entry.id} {...props} status={status} run={run} />;
    }
    const definition = entry.definition;
    const display = moduleDisplay(definition);
    return (
      <AddonCard
        key={entry.id}
        hidden={hidden}
        definition={definition}
        instances={catalog.instances.filter(
          (instance) =>
            instance.addonId === definition.id &&
            (owner === 'all' || instance.profileId === (owner === 'household' ? null : owner)),
        )}
        siblings={catalog.instances.filter((instance) => instance.addonId === definition.id)}
        profiles={profiles}
        run={run}
        onChanged={reload}
        defaultProfileId={owner === 'all' || owner === 'household' ? null : owner}
        action={favoriteButton(entry.id, display.name)}
      />
    );
  };

  return (
    <div className="space-y-5">
      <PersonPicker
        id="module-owner"
        label="Sources de"
        value={owner}
        onChange={setOwner}
        profiles={profiles}
        options={[
          { value: 'all', label: 'Tout le monde' },
          { value: 'household', label: 'Le foyer' },
        ]}
        description={
          owner === 'all'
            ? 'Retrouvez toutes les sources, ou choisissez une personne pour préparer ses modules.'
            : owner === 'household'
              ? 'Les sources du foyer peuvent aussi être utilisées par les profils.'
              : 'Les nouvelles sources sont attribuées à cette personne. Les sources du foyer restent disponibles en complément.'
        }
      />
      <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <Label htmlFor="module-search">Rechercher un module ou une source</Label>
          <SearchInput
            id="module-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Heure, web, vision, météo, arrêt de bus…"
          />
        </div>
        <Button variant="outline" disabled={loading} onClick={() => void reload()}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
          Actualiser
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Les modules marqués d’une étoile passent en tête de leur groupe.
      </p>
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {moduleGroups.map((group) => {
        const members = entries
          .filter((entry) => entry.group === group.id)
          // Tri stable : les favoris d’abord, l’ordre du groupe ensuite.
          .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)));
        return (
          <section
            key={group.id}
            className="space-y-3"
            aria-labelledby={`modules-group-${group.id}`}
            hidden={!members.some(visible)}
          >
            <div>
              <h2 id={`modules-group-${group.id}`} className="text-base font-semibold">
                {group.title}
              </h2>
              <p className="text-sm text-muted-foreground">{group.description}</p>
            </div>
            {members.map(renderEntry)}
          </section>
        );
      })}
      {nothingVisible && (
        <p className="text-sm text-muted-foreground" role="status">
          Aucun module ne correspond à « {search.trim()} ».
        </p>
      )}
      {(catalog.rejected ?? []).length > 0 && <RejectedModules rejected={catalog.rejected!} />}
    </div>
  );
}

/** Commandes HTTP : leur état, et le chemin vers l’onglet où elles se gèrent. */
function CommandsPanel({
  hidden,
  action,
  profiles,
  run,
  openOnArrival,
}: {
  hidden: boolean;
  action: ReactNode;
  profiles: Profile[];
  run: RunAction;
  openOnArrival: boolean;
}) {
  const load = useCallback(() => api.actions(), []);
  const { data: commands } = useAdminResource(load);
  const waiting = waitingConfirmations(useConfirmations().list).length;
  const count = commands?.length ?? 0;
  const status = commands ? commandsStatus(commands, waiting) : null;
  // Un module comme les autres : replié par défaut, ouvert quand l’adresse le désigne.
  const [open, setOpen] = useState(openOnArrival);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openOnArrival) return;
    setOpen(true);
    panel.current?.scrollIntoView({ block: 'start' });
  }, [openOnArrival]);
  return (
    <div ref={panel} hidden={hidden}>
      <ModulePanel
        id="module-commands"
        icon={Webhook}
        title="Commandes HTTP"
        subtitle={
          <>
            <span>Adresses HTTP</span> · {plural(count, 'commande')}
          </>
        }
        badge={status && <Badge variant={status.variant}>{status.label}</Badge>}
        action={action}
        open={open}
        onOpenChange={setOpen}
      >
        <p className="text-sm text-muted-foreground">
          Cornelius déclenche à la voix les adresses que vous enregistrez : ouvrir le portail,
          lancer une scène… Les commandes sensibles attendent votre accord.
        </p>
        {open && <Actions profiles={profiles} run={run} />}
      </ModulePanel>
    </div>
  );
}

/** Dossiers de addons/ ignorés au démarrage : le nom et la raison, pour corriger le module. */
function RejectedModules({ rejected }: { rejected: { name: string; reason: string }[] }) {
  return (
    <Alert role="note" aria-labelledby="rejected-modules-title">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription className="gap-2 text-foreground">
        <p id="rejected-modules-title" className="font-medium">
          {rejected.length > 1 ? 'Modules non chargés' : 'Module non chargé'}
        </p>
        <p className="text-muted-foreground">
          {rejected.length > 1 ? 'Ces dossiers' : 'Ce dossier'} du répertoire addons{' '}
          {rejected.length > 1 ? 'ont été ignorés' : 'a été ignoré'} au démarrage. Corrigez puis
          redémarrez Cornelius.
        </p>
        <ul className="space-y-1">
          {rejected.map((entry) => (
            <li key={entry.name} className="break-words">
              <code>{entry.name}</code> : {entry.reason}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function AddonCard({
  hidden = false,
  defaultProfileId,
  action,
  definition,
  instances,
  siblings,
  profiles,
  run,
  onChanged,
}: {
  hidden?: boolean;
  defaultProfileId: string | null;
  action: ReactNode;
  definition: AddonDefinitionView;
  instances: AddonInstanceView[];
  siblings: AddonInstanceView[];
  profiles: Profile[];
  run: RunAction;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const display = moduleDisplay(definition);
  const missingSecrets = (definition.secrets ?? []).filter((secret) => !secret.configured);
  const status = moduleStatus(instances, missingSecrets.length);
  const blockedId = `module-${definition.id}-blocked`;
  return (
    <ModulePanel
      id={'module-' + definition.id}
      hidden={hidden}
      icon={display.icon}
      title={display.name}
      subtitle={
        <>
          <span>{definition.sourceLabel}</span> · {plural(instances.length, 'source')}
        </>
      }
      badge={<Badge variant={status.variant}>{status.label}</Badge>}
      action={action}
    >
      {missingSecrets.map((secret) => (
        <MissingSecret key={secret.env} secret={secret} run={run} onChanged={onChanged} />
      ))}
      <p className="text-sm text-muted-foreground">{display.description}</p>
      {instances.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">Aucune source configurée pour ce module.</p>
      )}
      {instances.map((instance) => (
        <InstanceRow
          key={instance.id}
          definition={definition}
          instance={instance}
          siblings={siblings}
          profiles={profiles}
          run={run}
          onChanged={onChanged}
        />
      ))}
      {adding ? (
        <InstanceForm
          key={defaultProfileId ?? 'household'}
          defaultProfileId={defaultProfileId}
          definition={definition}
          siblings={siblings}
          profiles={profiles}
          run={run}
          onDone={async () => {
            setAdding(false);
            await onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={missingSecrets.length > 0}
            aria-describedby={missingSecrets.length > 0 ? blockedId : undefined}
            onClick={() => setAdding(true)}
          >
            <Plus />
            Ajouter une source
          </Button>
          {missingSecrets.length > 0 && (
            <span id={blockedId} className="text-xs text-muted-foreground">
              Disponible une fois le jeton ajouté et Cornelius redémarré.
            </span>
          )}
        </div>
      )}
    </ModulePanel>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** « d’un jeton », « d’une clé », « de deux jetons » : élision devant une voyelle. */
function elide(label: string): string {
  return /^[aeéèêiîoôuyh]/iu.test(label) ? 'd’' + label : 'de ' + label;
}

/** Jeton absent : le saisir ici, en tête de la carte du module. */
function MissingSecret({
  secret,
  run,
  onChanged,
}: {
  secret: AddonSecretView;
  run: RunAction;
  onChanged: () => Promise<void>;
}) {
  const label = secret.label.replace(/^(un|une)\s+/u, '');
  return (
    <Alert role="note" className="border-amber-300/40">
      <KeyRound aria-hidden="true" />
      <AlertDescription className="gap-2 text-foreground">
        <p>
          Ce module a besoin {elide(secret.label)}
          {secret.note ? ` (${secret.note})` : ''}. Collez-le ici : il est pris en compte tout de
          suite (ou ajoutez <code className="break-all">{secret.env}</code> dans le fichier .env).
        </p>
        <SecretField
          inline
          secret={{
            env: secret.env,
            group: 'modules',
            label: label.charAt(0).toUpperCase() + label.slice(1),
            usedBy: '',
            url: secret.url,
            note: secret.note,
            configured: false,
            source: null,
            hint: null,
          }}
          run={run}
          onChanged={() => void onChanged()}
        />
        {secret.url && (
          <a
            className="text-sm font-medium text-primary underline underline-offset-4"
            href={secret.url}
            target="_blank"
            rel="noreferrer"
          >
            S’inscrire sur {hostOf(secret.url)}
            <ExternalLink className="ml-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
          </a>
        )}
      </AlertDescription>
    </Alert>
  );
}

function InstanceRow({
  definition,
  instance,
  siblings,
  profiles,
  run,
  onChanged,
}: {
  definition: AddonDefinitionView;
  instance: AddonInstanceView;
  siblings: AddonInstanceView[];
  profiles: Profile[];
  run: RunAction;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<{ text: string; failed: boolean } | null>(null);
  // Aperçu calculé par le serveur à partir de la carte du module (« 20 vélos · Gare »).
  const summary = instance.preview ?? null;
  const spoken = spokenPhrase(definition.display?.spoken, instance.ref, instance.label);

  async function test() {
    setTesting(true);
    setTestNote(null);
    try {
      const result = await api.testAddonInstance(instance.id);
      setTestNote(
        result.error
          ? { text: `Échec. ${describeError(result.error)}`, failed: true }
          : {
              text: `Réponse ${snapshotStatusLabel(result.snapshot.status)} · ${formatWhen(result.snapshot.fetchedAt)}`,
              failed: false,
            },
      );
      await onChanged();
    } catch (failure) {
      setTestNote({ text: errorMessage(failure), failed: true });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm font-medium">{instance.label}</strong>
            <Badge variant="outline">{ownerLabel(instance.profileId, profiles)}</Badge>
            {instance.displayEnabled && <Badge variant="secondary">Affichage permanent</Badge>}
            {!instance.enabled && <Badge variant="outline">Désactivée</Badge>}
          </div>
          <p
            className={
              'mt-2 text-xs ' +
              (sourceNeedsFix(instance) ? 'text-destructive' : 'text-muted-foreground')
            }
          >
            {sourceStatusLine(instance, summary)}
          </p>
          {spoken && (
            <p className="mt-1 text-xs text-muted-foreground">
              Dites : <span className="text-foreground">« {spoken} »</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={testing}
            aria-label={
              testing
                ? `Test de la source ${instance.label} en cours`
                : `Tester la source ${instance.label}`
            }
            onClick={() => void test()}
          >
            <FlaskConical className={testing ? 'animate-pulse' : undefined} />
            {testing ? 'Test…' : 'Tester'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={editing}
            aria-label={`Configurer la source ${instance.label}`}
            onClick={() => setEditing((value) => !value)}
          >
            <Settings2 />
            Configurer
          </Button>
          <Button
            variant="danger-outline"
            size="sm"
            aria-label={`Supprimer la source ${instance.label}`}
            onClick={() => setDeleting(true)}
          >
            <Trash2 />
            Supprimer
          </Button>
        </div>
      </div>
      {testNote && (
        <p
          className={'text-xs ' + (testNote.failed ? 'text-destructive' : 'text-muted-foreground')}
          role="status"
        >
          {testNote.text}
        </p>
      )}
      {deleting && (
        <ConfirmAction
          message={`Supprimer « ${instance.label} » ? Le dernier relevé sera effacé.`}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            void run('Source supprimée.', () => api.deleteAddonInstance(instance.id)).then(
              (done) => {
                setDeleting(false);
                if (done) void onChanged();
              },
            );
          }}
        />
      )}
      {editing && (
        <InstanceForm
          definition={definition}
          profiles={profiles}
          instance={instance}
          siblings={siblings}
          run={run}
          onDone={async () => {
            setEditing(false);
            await onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}
