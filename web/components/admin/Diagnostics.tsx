import { useCallback, type ReactNode } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';

import type { ReadinessItem } from '../../../shared/readiness';
import type { MirrorConnection } from '../../useMirror';
import { phaseLabels } from '../phase-labels';
import { api } from '../../api';
import type { ActionRunView, AddonInstanceView, HttpActionView } from './types';
import { useAdminResource } from './useAdminResource';
import { remainingSteps } from './GettingStarted';
import { Fold } from './shared';
import {
  describeError,
  formatWhen,
  freshnessLabel,
  ownerLabel,
  plural,
  runStatusLabel,
  runStatusVariant,
  snapshotStatusLabel,
  snapshotVariant,
} from './format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';

const imageModelLabels: Record<string, string> = {
  'sdxl-turbo': 'SDXL Turbo',
  'sana-sprint-0.6b': 'SANA-Sprint 0.6B',
  'flux2-klein-4b': 'FLUX.2 Klein 4B',
  'z-image-turbo': 'Z-Image Turbo',
  'gpt-image-2.5-flare': 'OpenAI · GPT Image 2.5 Flare',
  'gpt-image-2.5-sunburst': 'OpenAI · GPT Image 2.5 Sunburst',
  'gpt-image-1-mini': 'OpenAI · GPT Image 1 mini',
};

const installationLabels: Record<string, string> = {
  missing: 'Non installé',
  present: 'Présent',
  checking: 'Vérification…',
  downloading: 'Installation…',
  ready: 'Installé et vérifié',
  failed: 'Installation en échec',
};

/** Heure courte (14:32) d’une dernière valeur connue. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** En-tête de carte : signale une valeur figée depuis la perte de connexion. */
function LiveHeader({
  title,
  description,
  staleSince,
}: {
  title: string;
  description: ReactNode;
  staleSince: number | null;
}) {
  return (
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
      {staleSince !== null && (
        <Badge variant="outline" className="mt-1">
          Dernière valeur connue à {clock(staleSince)}
        </Badge>
      )}
    </CardHeader>
  );
}

export function Diagnostics({
  connection,
  staleSince,
  readiness,
  onShowStart,
}: {
  connection: MirrorConnection;
  /** Heure de la perte de connexion ; null quand les valeurs sont à jour. */
  staleSince: number | null;
  readiness: ReadinessItem[] | null;
  onShowStart: () => void;
}) {
  const { state, event, fresh } = connection;
  const load = useCallback(async () => {
    const [catalog, history, commands] = await Promise.all([
      api.addons(),
      api.actionRuns(),
      api.actions(),
    ]);
    // Nom lisible de chaque module (« Horloge locale »), plutôt que son identifiant technique.
    const modules = Object.fromEntries(
      catalog.definitions.map((definition) => [definition.id, definition.sourceLabel]),
    );
    return { instances: catalog.instances, modules, runs: history, actions: commands };
  }, []);
  const { data, error: loadError, loading, reload } = useAdminResource(load);

  if (!state || !event) return null;
  const profiles = state.profiles;
  const now = Date.now();
  const rows = [
    ['Connexion administration', fresh ? 'Synchronisée' : 'Non confirmée'],
    ['Navigateur miroir', state.browserConnected ? 'Connecté' : 'Non connecté'],
    ['Session', phaseLabels[state.session.phase]],
    ['Microphone', state.session.microphoneEnabled ? 'Actif' : 'Arrêté'],
    ['Caméra locale', state.presence.health === 'ok' ? 'Disponible' : 'Indisponible'],
    [
      'Présence',
      plural(state.presence.peopleCount, 'personne') +
        ' · ' +
        (state.presence.state === 'engaged'
          ? 'engagée'
          : state.presence.state === 'present'
            ? 'présente'
            : 'absente'),
    ],
    ['Cartes en cours', String(state.cards.length)],
  ];
  const instances: AddonInstanceView[] | null = data?.instances ?? null;
  const runs: ActionRunView[] = data?.runs ?? [];
  const actions: HttpActionView[] = data?.actions ?? [];

  const stale = staleSince !== null;
  const remaining = readiness ? remainingSteps(readiness) : 0;
  const incident = state.diagnostic || state.session.reason;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {stale
            ? `Connexion perdue à ${clock(staleSince)} : les valeurs ci-dessous datent de ce moment.`
            : 'Les valeurs du miroir se mettent à jour d’elles-mêmes ; les sources et les actions, à la demande.'}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="max-[760px]:min-h-11"
          disabled={loading}
          onClick={() => {
            void reload();
            void connection.refresh();
          }}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
          Actualiser
        </Button>
      </div>
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>
            Sources et actions illisibles pour le moment : {loadError}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card className="shadow-none">
          <LiveHeader
            title="État des services"
            description="La dernière observation du serveur local."
            staleSince={staleSince}
          />
          <CardContent className={stale ? 'opacity-70' : undefined}>
            <dl className="divide-y">
              {rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-5 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <LiveHeader
            title="Dernier signal"
            description="La dernière erreur ou le dernier refus signalé par Cornelius."
            staleSince={staleSince}
          />
          <CardContent className={stale ? 'space-y-5 opacity-70' : 'space-y-5'}>
            {incident && (
              <Alert role="status">
                <AlertDescription>{incident}</AlertDescription>
              </Alert>
            )}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                {!readiness
                  ? 'Mise en route : lecture en cours.'
                  : remaining === 0
                    ? 'Mise en route : tout est prêt.'
                    : `Mise en route : ${plural(remaining, 'étape')} à terminer.`}
              </span>
              <a
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                href="#start"
                onClick={(clickEvent) => {
                  clickEvent.preventDefault();
                  onShowStart();
                }}
              >
                Voir la mise en route
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </a>
            </p>
            <Fold summary="Détails techniques" hint="À joindre à une demande d’aide.">
              <dl className="divide-y">
                {[
                  ['Démarrage du serveur', event.bootId.slice(0, 12)],
                  ['Séquence', event.sequence],
                  ['Version profil / contexte', event.profileEpoch + ' / ' + event.contextVersion],
                  ['Interaction', event.interactionId?.slice(0, 12) || 'Aucune'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-5 py-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-all text-right font-mono text-xs">{value}</dd>
                  </div>
                ))}
              </dl>
            </Fold>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <LiveHeader
            title="Génération d’image"
            description="Modèle local, installation, calcul et durée de la dernière image."
            staleSince={staleSince}
          />
          <CardContent className={stale ? 'space-y-4 opacity-70' : 'space-y-4'}>
            {(() => {
              const generation = connection.devices?.imageGeneration;
              if (!generation)
                return (
                  <p className="text-sm text-muted-foreground">
                    État de la génération d’image en attente du serveur…
                  </p>
                );
              const installation = generation.installations?.[generation.model];
              const installed = installation
                ? ['present', 'ready'].includes(installation.state)
                : false;
              return (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={generation.enabled ? 'secondary' : 'outline'}>
                      {generation.enabled ? 'Outil activé' : 'Outil désactivé'}
                    </Badge>
                    <Badge variant={installed ? 'secondary' : 'outline'}>
                      {installationLabels[installation?.state ?? 'missing'] ?? installation?.state}
                    </Badge>
                    <Badge variant={generation.connected ? 'secondary' : 'outline'}>
                      {generation.connected ? 'Service d’images lancé' : 'Service d’images arrêté'}
                    </Badge>
                    {generation.busy && <Badge variant="default">Génération en cours</Badge>}
                  </div>
                  <dl className="divide-y text-sm">
                    {(
                      [
                        [
                          'Modèle sélectionné',
                          generation.provider === 'openai'
                            ? (imageModelLabels[generation.openaiModel] ?? generation.openaiModel) +
                              ` (qualité ${generation.openaiQuality})`
                            : (imageModelLabels[generation.model] ?? generation.model),
                        ],
                        [
                          'Modèle chargé',
                          generation.loadedModel
                            ? (imageModelLabels[generation.loadedModel] ?? generation.loadedModel)
                            : 'Aucun',
                        ],
                        [
                          'Calcul de l’image',
                          generation.provider === 'openai'
                            ? '1024 × 1024 · API d’images OpenAI'
                            : generation.model === 'sana-sprint-0.6b'
                              ? `1024 × 1024 · ${generation.sanaSteps} étapes → 512 × 512`
                              : '512 × 512',
                        ],
                        [
                          'Périphérique',
                          generation.device === 'cuda'
                            ? 'GPU · CUDA'
                            : (generation.device?.toUpperCase() ?? 'Non détecté'),
                        ],
                        [
                          'Dernière génération',
                          generation.lastDurationMs === null
                            ? 'Jamais'
                            : (generation.lastDurationMs / 1000).toFixed(1) + ' s',
                        ],
                        [
                          'Progression installation',
                          installation
                            ? `${installation.completed} / ${installation.files} étapes`
                            : 'Indisponible',
                        ],
                        ['Étape en cours', installation?.file ?? 'Aucune'],
                      ] as [string, string][]
                    ).map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-5 py-2 first:pt-0">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="break-words text-right">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {generation.detail && (
                    <Alert role="status">
                      <AlertDescription>{generation.detail}</AlertDescription>
                    </Alert>
                  )}
                  {installation?.error && (
                    <Alert variant="destructive" role="status">
                      <AlertDescription>{installation.error}</AlertDescription>
                    </Alert>
                  )}
                  {generation.installations && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Modèles locaux</p>
                      {Object.entries(generation.installations).map(([model, status]) => (
                        <div
                          className="flex items-center justify-between gap-3 border-b pb-2 text-xs last:border-b-0 last:pb-0"
                          key={model}
                        >
                          <span>{imageModelLabels[model] ?? model}</span>
                          <Badge
                            variant={
                              ['present', 'ready'].includes(status.state) ? 'secondary' : 'outline'
                            }
                          >
                            {installationLabels[status.state] ?? status.state}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <LiveHeader
            title="Description de la scène"
            description={
              'Analyse d’image faite sur cet ordinateur (modèle LFM2.5-VL' +
              (connection.devices?.perception.vision
                ? ' ' + connection.devices.perception.vision.modelId.toUpperCase()
                : '') +
              ') : mode, état, durée et dernières analyses.'
            }
            staleSince={staleSince}
          />
          <CardContent className={stale ? 'space-y-4 opacity-70' : 'space-y-4'}>
            {(() => {
              const vision = connection.devices?.perception.vision;
              if (!vision)
                return (
                  <p className="text-sm text-muted-foreground">
                    État de la vision en attente du serveur…
                  </p>
                );
              if (vision.unavailable)
                return <p className="text-sm text-muted-foreground">{vision.unavailable}</p>;
              const modeLabels: Record<string, string> = {
                off: 'Désactivée',
                scene: 'À l’ouverture, puis sur demande',
                tool: 'Uniquement sur demande',
              };
              const triggerLabels: Record<string, string> = {
                scene: 'ouverture',
                tool: 'outil',
              };
              const statusLabels: Record<string, string> = {
                ready: 'réussie',
                failed: 'échouée',
                unavailable: 'indisponible',
                replaced: 'remplacée',
              };
              return (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{modeLabels[vision.mode] ?? vision.mode}</Badge>
                    <Badge variant={vision.model === 'ready' ? 'secondary' : 'outline'}>
                      {vision.model === 'ready'
                        ? 'Modèle prêt'
                        : vision.model === 'loading'
                          ? 'Chargement…'
                          : vision.model === 'unavailable'
                            ? 'Modèle absent'
                            : 'Modèle inconnu'}
                    </Badge>
                    <Badge variant="outline">
                      {connection.devices?.perception.connected
                        ? 'Service caméra lancé'
                        : 'Service caméra arrêté'}
                    </Badge>
                    <Badge variant="outline">{vision.provider ?? 'Calcul inconnu'}</Badge>
                  </div>
                  <dl className="divide-y text-sm">
                    {(
                      [
                        ['Analyses en attente', String(vision.pending)],
                        ['Descriptions transmises à la conversation', String(vision.appends)],
                        [
                          'Dernière durée',
                          vision.lastLatencyMs === null
                            ? 'Jamais'
                            : (vision.lastLatencyMs / 1000).toFixed(1) + ' s',
                        ],
                        [
                          'Dernière demande',
                          vision.lastRequestAt === null
                            ? 'Jamais'
                            : formatWhen(vision.lastRequestAt),
                        ],
                        [
                          'Dernière image',
                          vision.lastAt === null ? 'Jamais' : formatWhen(vision.lastAt),
                        ],
                      ] as [string, string][]
                    ).map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-5 py-2 first:pt-0">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="text-right">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {vision.detail && (
                    <Alert role="status">
                      <AlertDescription>{vision.detail}</AlertDescription>
                    </Alert>
                  )}
                  {vision.lastDescription && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">
                        Dernière analyse visuelle (
                        {triggerLabels[vision.lastTrigger ?? ''] ?? 'capture'}) :
                      </span>{' '}
                      {vision.lastDescription}
                    </p>
                  )}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Dernières analyses</p>
                    {vision.history.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Aucune analyse enregistrée.</p>
                    ) : (
                      vision.history.map((entry, index) => (
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs last:border-b-0 last:pb-0"
                          key={entry.at + '-' + index}
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <Badge variant={entry.status === 'ready' ? 'secondary' : 'outline'}>
                              {statusLabels[entry.status] ?? entry.status}
                            </Badge>
                            <span className="text-muted-foreground">
                              {triggerLabels[entry.trigger] ?? entry.trigger}
                            </span>
                            {entry.question && <span>Question : {entry.question}</span>}
                            {entry.detail && <span>{entry.detail}</span>}
                            {entry.injection && (
                              <Badge variant="outline">
                                {entry.injection === 'confirmed'
                                  ? 'Contexte confirmé'
                                  : entry.injection === 'failed'
                                    ? 'Contexte non confirmé'
                                    : 'Contexte en attente'}
                              </Badge>
                            )}
                            {entry.description && <span>{entry.description}</span>}
                          </span>
                          <span className="text-muted-foreground">
                            {entry.durationMs === null
                              ? ''
                              : (entry.durationMs / 1000).toFixed(1) + ' s · '}
                            {formatWhen(entry.at)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Sources et modules</CardTitle>
            <CardDescription>
              Le dernier relevé de chaque source enregistrée, avec son erreur exacte.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {instances === null ? (
              <p className="text-sm text-muted-foreground">
                {loadError ? 'Lecture impossible pour le moment.' : 'Lecture des sources…'}
              </p>
            ) : instances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune source enregistrée.</p>
            ) : (
              instances.map((instance) => {
                // Jamais collectée et sans erreur : en attente, pas en échec.
                const status = instance.snapshot?.status ?? (instance.error ? 'error' : 'pending');
                return (
                  <div className="space-y-2 rounded-lg border p-3" key={instance.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-medium">{instance.label}</strong>
                      <Badge variant="outline">
                        {data?.modules[instance.addonId] ?? instance.addonId}
                      </Badge>
                      <Badge variant="outline">{ownerLabel(instance.profileId, profiles)}</Badge>
                      {!instance.enabled && <Badge variant="outline">Désactivée</Badge>}
                      <Badge variant={snapshotVariant(status)}>{snapshotStatusLabel(status)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {instance.snapshot
                        ? `${freshnessLabel(instance, now)} · relevé ${formatWhen(instance.snapshot.fetchedAt)}`
                        : 'Aucun relevé enregistré.'}
                    </p>
                    {instance.error && (
                      <p className="break-words text-xs text-destructive" role="status">
                        {describeError(instance.error)} Code {instance.error.code},{' '}
                        {formatWhen(instance.error.at)}.
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Dernières exécutions d’actions</CardTitle>
            <CardDescription>
              Ce que Cornelius a réellement déclenché, du plus récent au plus ancien.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!data ? (
              <p className="text-sm text-muted-foreground">
                {loadError ? 'Lecture impossible pour le moment.' : 'Lecture des exécutions…'}
              </p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune exécution enregistrée.</p>
            ) : (
              runs.slice(0, 20).map((entry) => (
                <div className="space-y-1 border-b pb-2 last:border-b-0 last:pb-0" key={entry.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <strong className="font-medium">
                        {actions.find((action) => action.id === entry.actionId)?.label ??
                          'Action supprimée'}
                      </strong>
                      <Badge variant={runStatusVariant(entry.status)}>
                        {runStatusLabel(entry.status)}
                      </Badge>
                      {entry.responseStatus && (
                        <span className="text-xs text-muted-foreground">
                          HTTP {entry.responseStatus}
                        </span>
                      )}
                      {entry.errorCode && (
                        <span className="text-xs text-destructive">{entry.errorCode}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatWhen(entry.startedAt)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ownerLabel(entry.profileId, profiles)}
                    {entry.errorMessage ? ` · ${entry.errorMessage}` : ''}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
