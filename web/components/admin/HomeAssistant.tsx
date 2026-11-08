import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, House, RefreshCw } from 'lucide-react';
import {
  isControllable,
  type HomeAssistantEntity,
  type HomeAssistantView,
} from '../../../shared/home-assistant';
import { api, errorMessage } from '../../api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { plural } from './format';
import { ConfirmAction, ModulePanel, SaveBar, SearchInput } from './shared';
import type { RunAction } from './types';

const stateLabel = (state: string) =>
  ({ on: 'Allumé', off: 'Éteint', unavailable: 'Indisponible', unknown: 'Inconnu' })[state] ??
  state;

/** État lisible d’un capteur : unité, heure de fin d’un horodatage ou d’une minuterie. */
function sensorLabel(entity: HomeAssistantEntity): string {
  if (['unavailable', 'unknown'].includes(entity.state)) return stateLabel(entity.state);
  const at = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(
          new Date(value),
        )
      : null;
  if (entity.domain === 'timer') {
    const end = at(entity.attributes?.finishes_at);
    return entity.state === 'active'
      ? 'En cours' + (end ? ' · fin à ' + end : '')
      : entity.state === 'paused'
        ? 'En pause'
        : 'Inactive';
  }
  if (entity.deviceClass === 'timestamp') return at(entity.state) ?? entity.state;
  if (entity.domain === 'binary_sensor')
    return entity.state === 'on' ? 'Actif' : entity.state === 'off' ? 'Inactif' : entity.state;
  return entity.state + (entity.unit ? ' ' + entity.unit : '');
}
const kinds = [
  { value: 'all', label: 'Tout' },
  { value: 'devices', label: 'Lumières et prises' },
  { value: 'sensors', label: 'Capteurs' },
] as const;

export function HomeAssistantSettings({
  run,
  hidden,
  action,
}: {
  run: RunAction;
  hidden?: boolean;
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<HomeAssistantView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  // Sélection en cours de modification ; null tant qu’elle suit la sélection enregistrée.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [assistWarning, setAssistWarning] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [kind, setKind] = useState<(typeof kinds)[number]['value']>('all');
  const [connecting, setConnecting] = useState(false);
  // Connexion impossible : dite sous le formulaire, reliée au champ en cause, jusqu’au prochain
  // essai ou à une modification de ce champ.
  const [connectError, setConnectError] = useState<string | null>(null);
  const tokenRefused = !!connectError && /jeton/iu.test(connectError);
  const [removing, setRemoving] = useState(false);
  // Révision lue au moment de l’action : deux réglages enchaînés ne se contredisent pas, et
  // une modification faite ailleurs entre-temps reste signalée par le serveur.
  const revision = useRef(0);
  const saved = view?.selected ?? [];
  const selected = draft ?? saved;
  const changes =
    selected.filter((id) => !saved.includes(id)).length +
    saved.filter((id) => !selected.includes(id)).length;
  const accept = (next: HomeAssistantView) => {
    setView(next);
    setUrl(next.url);
    setToken('');
    setDraft(null);
    setAssistWarning(null);
    revision.current = next.revision;
  };
  useEffect(() => {
    let active = true;
    api
      .homeAssistant()
      .then((next) => {
        if (active) accept(next);
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);
  // Une lecture partie avant un enregistrement ne le fait pas oublier.
  const newest = (next: HomeAssistantView) =>
    setView((previous) => (previous && next.revision < previous.revision ? previous : next));
  useEffect(() => {
    if (!open || hidden) return;
    let active = true;
    const timer = setInterval(() => {
      if (document.hidden) return;
      api
        .homeAssistant()
        .then((next) => {
          if (active) newest(next);
        })
        .catch(() => {});
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, hidden]);
  const setAccess = (patch: { enabled?: boolean; knownPeopleOnly?: boolean }, label: string) =>
    void run(
      label,
      async () => {
        const next = await api.homeAssistantAccess({ ...patch, revision: revision.current });
        // La sélection en cours de modification reste un brouillon.
        setView(next);
        revision.current = next.revision;
      },
      { key: 'home-assistant-access-' + Object.keys(patch).join(), payload: patch },
    );
  const entities =
    view?.entities.filter(
      (entity) =>
        (!selectedOnly || selected.includes(entity.id)) &&
        (kind === 'all' || (kind === 'devices') === isControllable(entity)) &&
        (entity.name + ' ' + entity.id + ' ' + (entity.aliases ?? []).join(' '))
          .toLocaleLowerCase('fr')
          .includes(search.toLocaleLowerCase('fr')),
    ) ?? [];
  const toggle = (id: string, checked: boolean) =>
    setDraft((previous) => {
      const base = previous ?? saved;
      return checked ? [...base, id] : base.filter((value) => value !== id);
    });
  const refreshView = async () => newest(await api.homeAssistant());
  return (
    <ModulePanel
      id="module-home-assistant"
      icon={House}
      title="Home Assistant"
      subtitle="Lumières et prises commandées, capteurs lus par Cornelius."
      badge={
        <Badge variant={view?.connected ? 'secondary' : 'outline'}>
          {view?.connected ? 'Connecté' : view?.hasToken ? 'Déconnecté' : 'À configurer'}
        </Badge>
      }
      action={action}
      hidden={hidden}
      open={open}
      onOpenChange={setOpen}
    >
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {view?.error && (
        <p className="text-sm text-muted-foreground">
          {view.error} Les états affichés peuvent être anciens.
        </p>
      )}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setConnecting(true);
          setConnectError(null);
          void run(
            'Home Assistant connecté. Choisissez les appareils autorisés, puis enregistrez.',
            async () => {
              accept(
                await api.connectHomeAssistant({
                  url: url.trim(),
                  ...(token.trim() ? { token: token.trim() } : {}),
                  revision: revision.current,
                }),
              );
            },
            {
              key: 'home-assistant-connect',
              onError: (error) => setConnectError(errorMessage(error)),
            },
          ).finally(() => setConnecting(false));
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ha-url">Adresse Home Assistant</Label>
            <Input
              id="ha-url"
              placeholder="http://homeassistant.local:8123"
              autoComplete="off"
              spellCheck={false}
              type="url"
              required
              value={url}
              disabled={connecting}
              aria-invalid={(!!connectError && !tokenRefused) || undefined}
              aria-describedby={connectError && !tokenRefused ? 'ha-connect-error' : undefined}
              onChange={(event) => {
                setUrl(event.target.value);
                if (!tokenRefused) setConnectError(null);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ha-token">Jeton longue durée</Label>
            <Input
              id="ha-token"
              type="password"
              autoComplete="new-password"
              value={token}
              placeholder={
                view?.hasToken ? 'Jeton enregistré (masqué)' : 'Coller le jeton Home Assistant'
              }
              disabled={connecting}
              aria-invalid={tokenRefused || undefined}
              aria-describedby={tokenRefused ? 'ha-connect-error' : undefined}
              onChange={(event) => {
                setToken(event.target.value);
                if (tokenRefused) setConnectError(null);
              }}
            />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {view?.hasToken ? 'Laissez le jeton vide pour conserver celui qui est enregistré. ' : ''}
          Créez un jeton dans votre profil Home Assistant, onglet Sécurité, rubrique « Jetons
          d’accès longue durée ». Il reste enregistré sur ce PC. Aucun module complémentaire n’est
          nécessaire dans Home Assistant.
        </p>
        <Button type="submit" disabled={connecting || !view}>
          {connecting ? 'Connexion en cours…' : 'Connecter Home Assistant'}
        </Button>
        {connectError && (
          <p
            id="ha-connect-error"
            role="alert"
            className="flex items-start gap-2 text-sm leading-relaxed text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Connexion impossible : {connectError}</span>
          </p>
        )}
      </form>
      {view?.hasToken && (
        <>
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="ha-enabled">Autoriser Cornelius à utiliser la sélection</Label>
                <p className="text-xs text-muted-foreground">
                  Cornelius allume ou éteint les lumières et prises cochées, et lit les capteurs
                  cochés (« quelle température dans la chambre ? »). Les capteurs ne sont jamais
                  commandés.
                </p>
              </div>
              <Switch
                id="ha-enabled"
                checked={view.enabled}
                onCheckedChange={(enabled) =>
                  setAccess(
                    { enabled },
                    enabled
                      ? 'Cornelius peut utiliser la sélection Home Assistant.'
                      : 'Cornelius n’utilise plus Home Assistant.',
                  )
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="ha-known-people">Réserver aux personnes reconnues</Label>
                <p className="text-xs text-muted-foreground">
                  {view.knownPeopleOnly
                    ? 'Un visiteur inconnu ne peut ni commander les appareils ni lire les capteurs. Il faut qu’un membre du foyer soit reconnu, ou choisi dans l’administration. En mode voix, il faut la reconnaissance au mot d’appel.'
                    : 'Désactivé : toute personne qui parle au miroir, même inconnue, peut commander la sélection et lire ses capteurs (une serrure, par exemple).'}
                </p>
              </div>
              <Switch
                id="ha-known-people"
                checked={view.knownPeopleOnly}
                onCheckedChange={(knownPeopleOnly) =>
                  setAccess(
                    { knownPeopleOnly },
                    knownPeopleOnly
                      ? 'Home Assistant est réservé aux personnes reconnues.'
                      : 'Home Assistant est ouvert à toute personne devant le miroir.',
                  )
                }
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void run('Liste des appareils actualisée.', async () => {
                  const next = await api.refreshHomeAssistant();
                  setView(next);
                  if (!next.connected)
                    throw new Error(
                      (next.error ?? 'Home Assistant ne répond pas.') +
                        ' Les états affichés restent ceux de la dernière connexion.',
                    );
                })
              }
            >
              <RefreshCw />
              Actualiser les appareils
            </Button>
            <Button
              variant="outline"
              disabled={!view.connected}
              onClick={() =>
                void run('Sélection Assist reprise : vérifiez-la, puis enregistrez.', async () => {
                  const result = await api.importHomeAssistantAssist();
                  setDraft(result.selected);
                  setAssistWarning(result.warning);
                  // Montrer seulement ce qu’Assist expose, plutôt que tout le catalogue.
                  setSelectedOnly(true);
                  setKind('all');
                  setSearch('');
                })
              }
            >
              Reprendre la sélection Assist
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            L’import Assist demande un jeton administrateur Home Assistant. Il prépare une sélection
            à vérifier et enregistrer ; les réglages Assist ne changent pas. Les boutons Allumer et
            Éteindre restent disponibles ici pour toutes les lumières et prises.
          </p>
          <div className="space-y-2">
            <Label htmlFor="ha-search">Rechercher un appareil</Label>
            <SearchInput
              id="ha-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Salon, lampe, prise, lave-linge, température…"
            />
          </div>
          {!!view.newEntities?.length && (
            <p className="text-sm" role="status">
              {plural(
                view.newEntities.length,
                'nouvel appareil dans Home Assistant',
                'nouveaux appareils dans Home Assistant',
              )}{' '}
              depuis le dernier enregistrement : cochez ceux que Cornelius doit utiliser, puis
              enregistrez. Ils sont marqués « Nouveau » dans la liste.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {plural(selected.length, 'appareil sélectionné', 'appareils sélectionnés')} sur{' '}
            {view.entities.length.toLocaleString('fr-FR')} ·{' '}
            {view.connected ? 'États suivis en direct' : 'Derniers états connus'}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedOnly}
                onChange={(event) => setSelectedOnly(event.target.checked)}
              />
              Afficher uniquement la sélection
            </label>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Type d’entité">
              {kinds.map((entry) => (
                <Button
                  key={entry.value}
                  size="sm"
                  variant={kind === entry.value ? 'secondary' : 'ghost'}
                  aria-pressed={kind === entry.value}
                  onClick={() => setKind(entry.value)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {entities.map((entity) => (
              <div
                key={entity.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <label className="flex min-w-0 basis-full items-center gap-3 sm:basis-0 sm:flex-1">
                  <input
                    type="checkbox"
                    aria-label={'Autoriser ' + entity.name}
                    checked={selected.includes(entity.id)}
                    onChange={(event) => toggle(entity.id, event.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {entity.name}
                      {view.newEntities?.includes(entity.id) && (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-normal">
                          Nouveau
                        </span>
                      )}
                    </span>
                    {!!entity.aliases?.length && (
                      <span className="block text-xs text-muted-foreground">
                        Autres noms : {entity.aliases.join(', ')}
                      </span>
                    )}
                    <span className="block text-xs wrap-anywhere text-muted-foreground">
                      {entity.id} ·{' '}
                      {!isControllable(entity)
                        ? 'Lecture seule'
                        : entity.brightness
                          ? 'Luminosité réglable'
                          : 'Marche / arrêt'}
                    </span>
                  </span>
                </label>
                <span className="text-sm text-muted-foreground">
                  {isControllable(entity) ? stateLabel(entity.state) : sensorLabel(entity)}
                  {isControllable(entity) && entity.state === 'on' && entity.brightnessPct !== null
                    ? ' · ' + entity.brightnessPct + ' %'
                    : ''}
                </span>
                {(isControllable(entity) ? (['turn_on', 'turn_off'] as const) : []).map(
                  (action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant="outline"
                      aria-label={(action === 'turn_on' ? 'Allumer ' : 'Éteindre ') + entity.name}
                      onClick={() =>
                        void run(
                          (action === 'turn_on' ? 'Allumer' : 'Éteindre') +
                            ' « ' +
                            entity.name +
                            ' » : commande envoyée.',
                          async () => {
                            const result = await api.controlHomeAssistant({
                              entityId: entity.id,
                              action,
                              brightnessPct: null,
                            });
                            if (result.status !== 'succeeded') throw new Error(result.summary);
                            await refreshView();
                          },
                          { key: 'home-assistant-control-' + entity.id, payload: action },
                        )
                      }
                    >
                      {action === 'turn_on' ? 'Allumer' : 'Éteindre'}
                    </Button>
                  ),
                )}
              </div>
            ))}
            {!entities.length && (
              <p className="text-sm text-muted-foreground">
                {view.entities.length
                  ? 'Aucune entité ne correspond.'
                  : 'Aucune lumière, prise ni capteur trouvé. Utilisez « Actualiser les appareils ».'}
              </p>
            )}
          </div>
          {selected.some((id) => !view.entities.some((entity) => entity.id === id)) && (
            <Button
              variant="outline"
              onClick={() =>
                setDraft(selected.filter((id) => view.entities.some((entity) => entity.id === id)))
              }
            >
              Retirer les appareils disparus de la sélection
            </Button>
          )}
          <SaveBar
            label="Sélection des appareils"
            count={changes}
            error={selected.length > 100 ? 'Sélectionnez au maximum 100 appareils.' : null}
            onSave={() =>
              void run(
                'Sélection enregistrée.',
                async () => {
                  const next = await api.selectHomeAssistant({
                    selected,
                    revision: revision.current,
                  });
                  setView(next);
                  revision.current = next.revision;
                  setDraft(null);
                  setAssistWarning(null);
                },
                { key: 'home-assistant-selection', payload: selected },
              )
            }
            onCancel={() => {
              setDraft(null);
              setAssistWarning(null);
            }}
          >
            {assistWarning && <p className="text-xs text-muted-foreground">{assistWarning}</p>}
          </SaveBar>
          <div>
            <Button variant="danger-outline" onClick={() => setRemoving(true)}>
              Supprimer la connexion
            </Button>
          </div>
          {removing && (
            <ConfirmAction
              message="Supprimer le jeton enregistré et les autorisations Home Assistant ?"
              confirmLabel="Supprimer la connexion"
              onCancel={() => setRemoving(false)}
              onConfirm={() =>
                void run('Connexion supprimée.', async () => {
                  accept(await api.disconnectHomeAssistant(revision.current));
                  setRemoving(false);
                })
              }
            />
          )}
        </>
      )}
    </ModulePanel>
  );
}
