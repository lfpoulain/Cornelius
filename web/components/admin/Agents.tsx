import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'radix-ui';
import { Bot, Cable, ListChecks, MessageSquare, UserPlus } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import {
  agentTaskLabels,
  type AgentAdminView,
  type AgentConnectionView,
  type AgentTaskView,
} from '../../../shared/agents';
import { api, errorMessage } from '../../api';
import type { RunAction } from './types';
import { formatWhen, ofName } from './format';
import { Field, Fold, KeepHeight, LoadingCard, PersonPicker, SearchInput } from './shared';
import { useUnsavedChanges } from './unsaved';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

function connectionFeedback(view: AgentAdminView): string {
  const discovery = view.connection.discovery;
  if (!discovery) return 'Configuration enregistrée. Connexion pas encore vérifiée.';
  if (!discovery.available)
    return (
      'Configuration enregistrée, mais la vérification de connexion a échoué. ' +
      (discovery.error ?? 'Hermes est indisponible.')
    );
  return discovery.catalogComplete
    ? 'Configuration enregistrée. Connexion à Hermes vérifiée.'
    : 'Configuration enregistrée. Connexion à Hermes vérifiée, mais certaines capacités n’ont pas pu être récupérées.';
}

/** État d’une connexion, le même pour l’en-tête et pour les capacités. */
export function agentState(connection: AgentConnectionView): {
  label: string;
  available: boolean;
} {
  const discovery = connection.discovery;
  if (!connection.hasToken) return { label: 'À configurer', available: false };
  if (!connection.enabled) return { label: 'Désactivé', available: false };
  if (!discovery) return { label: 'Connexion à vérifier', available: false };
  if (!discovery.available) return { label: 'Connexion indisponible', available: false };
  return { label: 'Disponible pour Cornelius', available: true };
}

/** Ce qu’est Hermes et comment le relier, en trois étapes. */
function HermesIntro() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Relier un agent Hermes</CardTitle>
        <CardDescription>
          Hermes est un agent personnel installé à part, sur ce PC ou un autre. Cornelius lui confie
          les demandes qui prennent du temps (agenda, recherches, organisation) et vous en rapporte
          les réponses. Hermes continue quand vous quittez le miroir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2 text-sm">
          {[
            'Installez Hermes pour la personne et ouvrez son accès API : il donne une adresse et un jeton.',
            'Choisissez la personne, puis collez l’adresse et le jeton dans « Connexion ».',
            'Autorisez Cornelius à contacter l’agent, puis « Enregistrer et vérifier ».',
          ].map((step, index) => (
            <li key={index} className="flex gap-3">
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-full border text-xs text-muted-foreground"
              >
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function Agents({ profiles, run }: { profiles: Profile[]; run: RunAction }) {
  const [selected, setSelected] = useState(profiles[0]?.id ?? '');
  const profile = profiles.find((p) => p.id === selected) ?? profiles[0];
  if (!profile)
    return (
      <div className="space-y-5">
        <HermesIntro />
        <Card>
          <CardHeader>
            <CardTitle>Aucune personne dans le foyer pour l’instant</CardTitle>
            <CardDescription>
              Chaque agent appartient à une personne. Ajoutez d’abord quelqu’un au foyer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="#profiles">
                <UserPlus />
                Ajouter une personne
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  return (
    <div className="space-y-5">
      <PersonPicker
        id="agent-profile"
        label="Agent de"
        value={profile.id}
        onChange={setSelected}
        profiles={profiles}
        description={`Chaque agent appartient à une personne : vous réglez ici celui ${ofName(profile.name)}, sa connexion, ce qu’il sait faire et ses demandes en cours.`}
      />
      <KeepHeight holdKey={profile.id}>
        <AgentPanel key={profile.id} profile={profile} run={run} />
      </KeepHeight>
    </div>
  );
}
function AgentPanel({ profile, run }: { profile: Profile; run: RunAction }) {
  const [view, setView] = useState<AgentAdminView | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [pollError, setPollError] = useState('');
  const [message, setMessage] = useState('');
  const [taskId, setTaskId] = useState('');
  const [removing, setRemoving] = useState(false);
  const [tab, setTab] = useState('connection');
  const [search, setSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const keepConnection = () => {
    setRemoving(false);
    removeButton.current?.focus();
  };
  const [checking, setChecking] = useState<'save' | 'discover' | null>(null);
  // Vrai dès qu’une lecture a rempli le formulaire : avant cela, une relecture périodique
  // réussie tient lieu de première lecture.
  const loaded = useRef(false);
  // Compte les enregistrements et retraits : une relecture partie avant l’un d’eux ne doit pas
  // l’écraser. La révision ne suffit pas à les ordonner, elle repart de 0 après un retrait.
  const writes = useRef(0);
  const accept = (next: AgentAdminView) => {
    loaded.current = true;
    writes.current++;
    setError('');
    setView(next);
    setTaskId((current) => (next.tasks.some((t) => t.id === current) ? current : ''));
    setUrl(next.connection.url);
    setToken('');
    setDescription(next.connection.description);
    setEnabled(next.connection.enabled);
    setRevision(next.connection.revision);
  };
  useEffect(() => {
    let mounted = true;
    void api
      .agent(profile.id)
      .then((next) => {
        // Une relecture périodique a pu aboutir avant : la saisie commencée depuis reste.
        if (mounted && !loaded.current) accept(next);
      })
      .catch((e) => {
        if (mounted && !loaded.current) setError(errorMessage(e));
      });
    // Une lecture périodique qui échoue ne doit pas laisser un bandeau d’erreur figé :
    // il disparaît dès que la lecture suivante réussit.
    const timer = setInterval(() => {
      if (document.hidden) return;
      const started = writes.current;
      void api
        .agent(profile.id)
        .then((next) => {
          if (!mounted) return;
          setPollError('');
          // Première lecture échouée : celle-ci remplit le formulaire et efface l’erreur.
          if (!loaded.current) accept(next);
          else if (started === writes.current) setView(next);
        })
        .catch((e) => {
          if (mounted) setPollError(errorMessage(e));
        });
    }, 3000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [profile.id]);
  const perform = (label: string, work: () => Promise<void>) =>
    run(label, async () => {
      setError('');
      await work();
    });
  // L’issue s’affiche dans l’encadré « État de la connexion Hermes », sans message en double.
  const verify = async (save: boolean) => {
    if (checking) return;
    setChecking(save ? 'save' : 'discover');
    setVerifyError('');
    // Une relecture en route pendant l’enregistrement est déjà ancienne à son retour.
    if (save) writes.current++;
    try {
      const next = save
        ? await api.saveAgent(profile.id, { url, token, description, enabled, revision })
        : await api.discoverAgent(profile.id);
      if (save) accept(next);
      else setView(next);
    } catch (e) {
      setVerifyError(errorMessage(e));
    } finally {
      setChecking(null);
    }
  };
  useUnsavedChanges(
    !!view &&
      (url !== view.connection.url ||
        !!token ||
        description !== view.connection.description ||
        enabled !== view.connection.enabled),
  );
  if (!view)
    return error ? (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <LoadingCard label="Chargement de l’agent…" />
    );
  const c = view.connection,
    discovery = c.discovery;
  const toolsets = discovery?.capabilities.filter((a) => a.kind === 'toolset') ?? [];
  const skills = discovery?.capabilities.filter((a) => a.kind === 'skill') ?? [];
  const taskLabel = (t: AgentTaskView) =>
    'Demande du ' + formatWhen(t.createdAt) + ' · ' + agentTaskLabels[t.status];
  const ready = c.enabled && c.hasToken;
  const state = agentState(c);
  const dirty = url !== c.url || !!token || description !== c.description || enabled !== c.enabled;
  const matches = (a: (typeof toolsets)[number]) =>
    [a.name, a.description, ...a.tools]
      .join(' ')
      .toLocaleLowerCase('fr-FR')
      .includes(search.trim().toLocaleLowerCase('fr-FR'));
  const filteredToolsets = toolsets.filter(matches);
  const filteredSkills = skills.filter(matches);
  const activeStatuses = ['submitting', 'queued', 'running', 'stopping', 'unknown'];
  const activeTasks = view.tasks.filter((t) => activeStatuses.includes(t.status));
  const approvals = view.tasks.filter((t) => t.status === 'waiting_for_approval');
  const visibleTasks = view.tasks.filter(
    (t) =>
      taskFilter === 'all' ||
      (taskFilter === 'active' && activeStatuses.includes(t.status)) ||
      (taskFilter === 'approval' && t.status === 'waiting_for_approval') ||
      (taskFilter === 'finished' &&
        ['completed', 'failed', 'cancelled', 'interrupted'].includes(t.status)),
  );
  return (
    <div className="space-y-5">
      {(error || pollError) && (
        <Alert variant="destructive">
          <AlertDescription>{error || pollError}</AlertDescription>
        </Alert>
      )}
      {!c.hasToken && <HermesIntro />}
      <section
        className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4"
        aria-label="Vue d’ensemble de Hermes"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Bot className="size-8 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold break-words">Hermes {ofName(profile.name)}</h2>
              <p className="text-sm text-muted-foreground">
                Vos demandes continuent dans Hermes quand vous quittez le miroir.
              </p>
            </div>
          </div>
          <Badge variant={state.available ? 'secondary' : 'outline'}>{state.label}</Badge>
        </div>
        {/* Des compteurs à zéro ne disent rien tant que la connexion n’a pas répondu. */}
        {(discovery?.available || view.tasks.length > 0) && (
          <dl className="grid grid-cols-3 gap-3 border-t border-primary/15 pt-4">
            <div>
              <dt className="text-xs text-muted-foreground">En cours</dt>
              <dd className="mt-1 text-xl font-semibold">{activeTasks.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Accords attendus</dt>
              <dd className="mt-1 text-xl font-semibold">{approvals.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Capacités connues</dt>
              <dd className="mt-1 text-xl font-semibold">{toolsets.length + skills.length}</dd>
            </div>
          </dl>
        )}
        {discovery?.available && !discovery.catalogComplete && (
          <button
            type="button"
            className="text-sm text-left text-muted-foreground underline underline-offset-4"
            onClick={() => setTab('capabilities')}
          >
            Catalogue partiel : voir le détail
          </button>
        )}
        {approvals.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              setTaskFilter('approval');
              setTab('requests');
            }}
          >
            Voir les accords demandés
          </Button>
        )}
      </section>
      <Tabs.Root value={tab} onValueChange={setTab} className="space-y-4">
        <Tabs.List
          aria-label="Rubriques de l’agent"
          className="grid grid-cols-3 rounded-lg bg-muted p-1 gap-1"
        >
          {[
            { value: 'connection', label: 'Connexion', Icon: Cable },
            { value: 'capabilities', label: 'Capacités', Icon: ListChecks },
            { value: 'requests', label: 'Demandes', Icon: MessageSquare },
          ].map(({ value, label, Icon }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="flex min-w-0 items-center justify-center gap-2 rounded-md px-2 py-2.5 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="connection" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Connexion et délégation</CardTitle>
              <CardDescription>
                Cornelius transmet vos demandes à votre agent et vous restitue ses réponses. Hermes
                gère ses outils, ses actions et ses demandes d’accord.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify(true);
                }}
              >
                <Field
                  id="agent-url"
                  label="Adresse de Hermes"
                  help="Adresse du serveur API de votre agent, avec le préfixe de son profil si nécessaire."
                >
                  <Input
                    id="agent-url"
                    type="url"
                    required
                    maxLength={2048}
                    placeholder="http://127.0.0.1:8642"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </Field>
                {/* Le badge reste hors du Field : avec deux enfants, l’aide ne serait plus reliée
                    au champ par aria-describedby. */}
                <div className="space-y-2">
                  <Field
                    id="agent-token"
                    label="Jeton de connexion"
                    help={
                      c.hasToken
                        ? 'Le jeton enregistré est masqué. Saisissez un nouveau jeton uniquement pour le remplacer ; laissez vide pour le conserver à la même adresse.'
                        : 'Le jeton API configuré dans Hermes.'
                    }
                  >
                    <Input
                      id="agent-token"
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        c.hasToken ? 'Jeton enregistré (masqué)' : 'Saisir le jeton Hermes'
                      }
                      maxLength={4096}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </Field>
                  {c.hasToken && <Badge variant="secondary">Jeton enregistré</Badge>}
                </div>
                <Field
                  id="agent-description"
                  label="À quoi sert cet agent ?"
                  help="Facultatif : précisez son rôle pour aider Cornelius à choisir quand lui confier une demande."
                >
                  <Textarea
                    id="agent-description"
                    maxLength={2000}
                    placeholder="Mon agenda, mes recherches et l’organisation des voyages…"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="agent-enabled" className="text-sm font-medium">
                    Autoriser Cornelius à contacter cet agent
                  </label>
                  <Switch id="agent-enabled" checked={enabled} onCheckedChange={setEnabled} />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Utilisez l’agent ou le profil Hermes propre à cette personne. Les demandes
                  confiées à Hermes et ses réponses suivent aussi ses réglages de conservation. Le
                  jeton reste sur le serveur Cornelius.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={checking !== null}>
                    {checking === 'save'
                      ? 'Enregistrement et vérification…'
                      : 'Enregistrer et vérifier'}
                  </Button>
                  {c.hasToken && (
                    <Button
                      ref={removeButton}
                      type="button"
                      variant="danger-outline"
                      onClick={() => setRemoving(!removing)}
                    >
                      Supprimer la connexion
                    </Button>
                  )}
                  {/* Toujours présent, masqué si inutile : son apparition ne décale rien. */}
                  <span
                    role="status"
                    className={
                      'ml-auto text-sm text-warning ' + (dirty && c.hasToken ? '' : 'invisible')
                    }
                  >
                    Modifications non enregistrées.
                  </span>
                </div>
                {verifyError && !checking ? (
                  <Alert
                    aria-label="État de la connexion Hermes"
                    role="alert"
                    variant="destructive"
                  >
                    <AlertDescription>{verifyError}</AlertDescription>
                  </Alert>
                ) : checking ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {checking === 'save'
                      ? 'Enregistrement de la configuration et vérification de la connexion à Hermes…'
                      : 'Vérification de la connexion et actualisation des capacités Hermes…'}
                  </p>
                ) : c.hasToken ? (
                  <Alert
                    aria-label="État de la connexion Hermes"
                    role={discovery && !discovery.available ? 'alert' : 'status'}
                    variant={discovery && !discovery.available ? 'destructive' : 'default'}
                  >
                    <AlertDescription>{connectionFeedback(view)}</AlertDescription>
                  </Alert>
                ) : null}
              </form>
              {removing && (
                // Pas ConfirmAction : son bouton d’annulation dit « Annuler », ici « Conserver ».
                // Mêmes égards : boîte d’alerte nommée par sa question, focus sur le refus,
                // Échap referme et rend le focus au bouton d’origine.
                <Alert
                  className="mt-4"
                  role="alertdialog"
                  aria-labelledby="agent-remove-question"
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape') return;
                    e.stopPropagation();
                    keepConnection();
                  }}
                >
                  <AlertDescription>
                    <p id="agent-remove-question">
                      Retirer cette connexion et ses références de tâches du miroir ? Les tâches et
                      l’historique restent dans Hermes.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        onClick={() =>
                          void perform('Connexion Hermes retirée.', async () => {
                            accept(await api.removeAgent(profile.id, revision));
                            setRemoving(false);
                          })
                        }
                      >
                        Retirer du miroir
                      </Button>
                      <Button variant="outline" autoFocus onClick={keepConnection}>
                        Conserver
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </Tabs.Content>
        <Tabs.Content value="capabilities" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Capacités transmises à Cornelius</CardTitle>
                <Badge variant={state.available ? 'secondary' : 'outline'}>{state.label}</Badge>
              </div>
              <CardDescription>
                Les outils activés et configurés ainsi que les compétences installées permettent à
                Cornelius de choisir ce qu’il peut déléguer.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!!discovery?.issues?.length && (
                <Alert>
                  <AlertDescription>
                    <p className="font-medium text-foreground">Catalogue incomplet</p>
                    {discovery.issues.map((issue, index) => (
                      <p key={index}>
                        {issue.kind === 'toolset'
                          ? 'Outils (/v1/toolsets)'
                          : 'Compétences (/v1/skills)'}{' '}
                        : {issue.message}
                      </p>
                    ))}
                    <p>
                      Les capacités déjà reçues restent utilisables. Réessayez après avoir vérifié
                      Hermes.
                    </p>
                  </AlertDescription>
                </Alert>
              )}
              {discovery?.error && (
                <Alert variant="destructive">
                  <AlertDescription>{discovery.error}</AlertDescription>
                </Alert>
              )}
              {discovery && (
                <p className="text-xs text-muted-foreground">
                  Dernière vérification : {formatWhen(discovery.checkedAt)}.{' '}
                  {discovery.available
                    ? discovery.catalogComplete
                      ? 'Catalogue reçu.'
                      : 'Catalogue partiel : certaines capacités n’ont pas pu être découvertes.'
                    : 'Les capacités n’ont pas pu être vérifiées.'}
                </p>
              )}
              {!c.enabled && (
                <p className="text-sm text-muted-foreground">
                  Connexion désactivée : ces capacités ne sont pas proposées à Cornelius.
                </p>
              )}
              {(toolsets.length > 0 || skills.length > 0) && (
                <Field id="agent-capability-search" label="Rechercher une capacité">
                  <SearchInput
                    id="agent-capability-search"
                    placeholder="Agenda, recherche, fichiers…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </Field>
              )}
              {!!toolsets.length && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Outils disponibles ({toolsets.length})</p>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {filteredToolsets.map((a, i) => (
                      <div key={a.name + i} className="rounded-lg border p-3 break-words">
                        <p className="text-sm font-medium">{a.name}</p>
                        <p className="text-sm text-muted-foreground">{a.description}</p>
                        {!!a.tools.length && (
                          <Fold
                            variant="inline"
                            summary={`Voir les outils (${a.tools.length})`}
                            className="mt-2 text-xs text-muted-foreground"
                          >
                            <p className="wrap-anywhere">{a.tools.join(', ')}</p>
                          </Fold>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!!skills.length && (
                <Fold summary={`Compétences installées (${skills.length})`}>
                  <p className="text-xs text-muted-foreground">
                    Une compétence peut nécessiter un service ou un compte supplémentaire dans
                    Hermes.
                  </p>
                  {filteredSkills.map((a, i) => (
                    <div key={a.name + i} className="mt-3 break-words">
                      <p className="text-sm font-medium">{a.name}</p>
                      <p className="text-sm text-muted-foreground">{a.description}</p>
                    </div>
                  ))}
                </Fold>
              )}
              {search.trim() && !filteredToolsets.length && !filteredSkills.length && (
                <p role="status" className="text-sm text-muted-foreground">
                  Aucune capacité ne correspond à cette recherche.
                </p>
              )}
              {!toolsets.length && !skills.length && (
                <p className="text-sm text-muted-foreground">
                  Aucune capacité découverte pour le moment.
                </p>
              )}
              <Button
                variant="outline"
                disabled={!c.hasToken || checking !== null}
                onClick={() => void verify(false)}
              >
                {checking === 'discover' ? 'Vérification en cours…' : 'Actualiser les capacités'}
              </Button>
            </CardContent>
          </Card>
        </Tabs.Content>
        <Tabs.Content value="requests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Échanger avec Hermes</CardTitle>
              <CardDescription>
                Essayez une demande ici ou parlez au miroir. Les tâches continuent dans Hermes quand
                vous quittez le miroir.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform('Demande transmise à Hermes.', async () => {
                    const response = await api.messageAgent(profile.id, message, taskId || null);
                    if (response.status === 'failed' || response.status === 'unknown')
                      throw new Error(response.summary);
                    setMessage('');
                    if (typeof response.result?.taskId === 'string')
                      setTaskId(response.result.taskId);
                    setView(await api.agent(profile.id));
                  });
                }}
              >
                <Field id="agent-task" label="Conversation">
                  <NativeSelect
                    id="agent-task"
                    value={taskId}
                    onChange={(e) => setTaskId(e.target.value)}
                  >
                    <NativeSelectOption value="">Nouvelle demande</NativeSelectOption>
                    {view.tasks.map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {taskLabel(t)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="agent-message" label="Message à Hermes">
                  <Textarea
                    id="agent-message"
                    ref={messageInput}
                    required
                    maxLength={8000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Prépare trois idées de sorties pour samedi…"
                  />
                </Field>
                {!ready && (
                  <p className="text-sm text-muted-foreground">
                    Enregistrez la connexion et autorisez Cornelius à contacter Hermes dans l’onglet
                    Connexion.
                  </p>
                )}
                {ready && !discovery?.available && (
                  <p className="text-sm text-destructive">
                    Vérifiez la connexion avant d’envoyer une demande.
                  </p>
                )}
                {dirty && (
                  <p className="text-sm text-muted-foreground">
                    Les échanges utilisent la configuration enregistrée. Vos modifications de
                    connexion ne sont pas encore appliquées.
                  </p>
                )}
                {taskId && (
                  <p className="text-xs text-muted-foreground">
                    Votre message poursuit la conversation sélectionnée. Choisissez « Nouvelle
                    demande » pour un autre sujet.
                  </p>
                )}
                <Button type="submit" disabled={!ready || !discovery?.available || !message.trim()}>
                  Envoyer à Hermes
                </Button>
              </form>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium">Demandes récentes</p>
                <Button
                  variant="outline"
                  disabled={!ready}
                  onClick={() =>
                    void perform('Tâches Hermes actualisées.', async () =>
                      setView(await api.refreshAgent(profile.id)),
                    )
                  }
                >
                  Actualiser les tâches
                </Button>
              </div>
              {!view.tasks.length && (
                <p className="text-sm text-muted-foreground">Aucune demande pour cette personne.</p>
              )}
              {!!view.tasks.length && (
                <Field id="agent-task-filter" label="Afficher les demandes">
                  <NativeSelect
                    id="agent-task-filter"
                    value={taskFilter}
                    onChange={(e) => setTaskFilter(e.target.value)}
                  >
                    <NativeSelectOption value="all">
                      Toutes ({view.tasks.length})
                    </NativeSelectOption>
                    <NativeSelectOption value="active">
                      En cours ou à vérifier ({activeTasks.length})
                    </NativeSelectOption>
                    <NativeSelectOption value="approval">
                      Accord attendu ({approvals.length})
                    </NativeSelectOption>
                    <NativeSelectOption value="finished">Terminées</NativeSelectOption>
                  </NativeSelect>
                </Field>
              )}
              {!!view.tasks.length && !visibleTasks.length && (
                <p className="text-sm text-muted-foreground">
                  Aucune demande dans cette catégorie.
                </p>
              )}
              {visibleTasks.map((t) => (
                <article key={t.id} className="space-y-3 rounded-lg border p-4 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{formatWhen(t.createdAt)}</h3>
                    <Badge variant="outline">{agentTaskLabels[t.status]}</Badge>
                  </div>
                  {t.error && (
                    <p role="status" className="text-sm text-destructive">
                      {t.error}
                    </p>
                  )}
                  {t.output && (
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label="Résultat Hermes"
                      className="max-h-80 overflow-y-auto rounded-md bg-muted/40 p-3 whitespace-pre-wrap break-words text-sm"
                    >
                      {t.output}
                    </div>
                  )}
                  {t.status === 'completed' && !t.output && !t.error && (
                    <p className="text-sm text-muted-foreground">
                      Résultat à récupérer : utilisez « Actualiser les tâches » pour le relire dans
                      Hermes.
                    </p>
                  )}
                  {t.approval && (
                    <div className="space-y-3 rounded-lg bg-muted p-3">
                      <p className="text-sm font-medium">Hermes demande votre accord</p>
                      <p className="text-sm whitespace-pre-wrap wrap-anywhere">
                        {t.approval.description}
                      </p>
                      {discovery?.approval ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={!ready}
                            onClick={() =>
                              void perform('Décision transmise à Hermes.', async () => {
                                await api.approveAgent(profile.id, t.id, t.approval!.id, 'once');
                                setView(await api.agent(profile.id));
                              })
                            }
                          >
                            Autoriser cette fois
                          </Button>
                          <Button
                            variant="outline"
                            disabled={!ready}
                            onClick={() =>
                              void perform('Refus transmis à Hermes.', async () => {
                                await api.approveAgent(profile.id, t.id, t.approval!.id, 'deny');
                                setView(await api.agent(profile.id));
                              })
                            }
                          >
                            Refuser
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm">Donnez votre accord directement dans Hermes.</p>
                      )}
                    </div>
                  )}
                  {t.status === 'waiting_for_approval' && !t.approval && (
                    <p className="text-sm">
                      Consultez la demande d’accord directement dans Hermes.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!ready}
                      onClick={() => {
                        setTaskId(t.id);
                        messageInput.current?.focus();
                        messageInput.current?.scrollIntoView({
                          block: 'center',
                          behavior: 'smooth',
                        });
                      }}
                    >
                      Répondre à cette demande
                    </Button>
                    {['queued', 'running', 'waiting_for_approval', 'unknown'].includes(
                      t.status,
                    ) && (
                      <Button
                        variant="outline"
                        disabled={!ready}
                        onClick={() =>
                          void perform('Arrêt demandé à Hermes.', async () => {
                            await api.stopAgent(profile.id, t.id);
                            setView(await api.agent(profile.id));
                          })
                        }
                      >
                        Demander l’arrêt
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </CardContent>
          </Card>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
