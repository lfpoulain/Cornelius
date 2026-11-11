import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShieldX,
  Trash2,
} from 'lucide-react';
import type { Profile } from '../../../shared/types';
import { api, errorMessage } from '../../api';
import type { ActionConfirmationView, ActionRunView, HttpActionView, RunAction } from './types';
import { ActionForm } from './ActionForm';
import { useAdminResource } from './useAdminResource';
import { refreshConfirmations, useConfirmations } from './useConfirmations';
import { ConfirmAction, LoadError, LoadingCard } from './shared';
import {
  errorCodeLabel,
  formatWhen,
  httpStatusLabel,
  ownerLabel,
  plural,
  runStatusLabel,
  runStatusVariant,
} from './format';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';

/** Raison lisible d’une exécution : statut HTTP traduit, sinon code d’erreur traduit. */
function runDetail(run: ActionRunView): string {
  if (run.responseStatus && (run.responseStatus < 200 || run.responseStatus >= 300))
    return httpStatusLabel(run.responseStatus);
  return run.errorCode ? errorCodeLabel(run.errorCode) : '';
}

const confirmationLabel = (value: string) =>
  value === 'required' ? 'Avec votre accord' : 'Sans accord';

export function Actions({
  profiles,
  run,
  onActions,
}: {
  profiles: Profile[];
  run: RunAction;
  /** Commandes telles qu’elles viennent d’être lues : l’en-tête du module suit la liste. */
  onActions?: (actions: HttpActionView[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    const [actions, runs] = await Promise.all([api.actions(), api.actionRuns()]);
    return { actions, runs };
  }, []);
  const { data, error: loadError, loading, reload } = useAdminResource(load);
  const loadedActions = data?.actions;
  useEffect(() => {
    if (loadedActions) onActions?.(loadedActions);
  }, [loadedActions, onActions]);
  // Relues toutes les 3 s tant que la page est visible : une demande arrive pendant une
  // conversation, sans qu’il faille actualiser.
  const { list: confirmations, error: confirmationsError } = useConfirmations();
  // Une demande validée disparaît une fois exécutée : le journal est relu à ce moment.
  const confirmationKey = (confirmations ?? []).map((entry) => entry.id).join(',');
  const lastKey = useRef(confirmationKey);
  useEffect(() => {
    if (lastKey.current === confirmationKey) return;
    lastKey.current = confirmationKey;
    void reload();
  }, [confirmationKey, reload]);

  if (loadError && !data) return <LoadError error={loadError} loading={loading} onRetry={reload} />;
  if (!data) return <LoadingCard label="Lecture des commandes enregistrées…" />;
  const { actions, runs } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
        <p className="max-w-[76ch] text-sm text-muted-foreground">
          Chaque commande appelle une adresse que vous enregistrez ici. Cornelius ne choisit jamais
          l’adresse : il déclenche une commande par son nom, après votre accord si elle est
          sensible.
        </p>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => {
            void reload();
            void refreshConfirmations();
          }}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
          Actualiser
        </Button>
      </div>
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Confirmations
        confirmations={confirmations ?? []}
        error={confirmationsError}
        actions={actions}
        profiles={profiles}
        run={run}
      />

      {runs.length > 0 && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Dernières exécutions</CardTitle>
            <CardDescription>
              Ce que Cornelius a réellement déclenché, du plus récent au plus ancien.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.slice(0, 6).map((entry) => (
              <div
                className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                key={entry.id}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="font-medium">
                    {actions.find((action) => action.id === entry.actionId)?.label ??
                      'Action supprimée'}
                  </strong>
                  <Badge variant={runStatusVariant(entry.status)}>
                    {runStatusLabel(entry.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{runDetail(entry)}</span>
                </span>
                <span className="text-xs text-muted-foreground">{formatWhen(entry.startedAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle as="h4">Commandes enregistrées</CardTitle>
          <CardDescription>
            {actions.length === 0
              ? 'Aucune commande enregistrée.'
              : plural(actions.length, 'commande enregistrée', 'commandes enregistrées') + '.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {actions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              actions={actions}
              profiles={profiles}
              run={run}
              onChanged={reload}
            />
          ))}
          {adding ? (
            <ActionForm
              profiles={profiles}
              actions={actions}
              run={run}
              onDone={async () => {
                setAdding(false);
                await reload();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Nouvelle commande
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Confirmations({
  confirmations,
  error,
  actions,
  profiles,
  run,
}: {
  confirmations: ActionConfirmationView[];
  error: string | null;
  actions: HttpActionView[];
  profiles: Profile[];
  run: RunAction;
}) {
  if (confirmations.length === 0 && !error) return null;
  const decide = (label: string, work: () => Promise<unknown>) =>
    void run(label, work).then(() => refreshConfirmations());
  return (
    <Card className="border-primary/30 shadow-none">
      <CardHeader>
        <CardTitle>Commandes à valider</CardTitle>
        <CardDescription>
          Cornelius attend votre accord avant d’appeler ces adresses. Validez ou refusez chaque
          demande.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="text-xs text-destructive" role="status">
            Lecture des demandes impossible : {error}
          </p>
        )}
        {confirmations.map((confirmation) => {
          const action = actions.find((candidate) => candidate.id === confirmation.actionId);
          return (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              key={confirmation.id}
            >
              <div className="min-w-0">
                <strong className="text-sm font-medium">
                  {action?.label ?? 'Commande supprimée'}
                </strong>
                {action && (
                  <p className="mt-1 font-mono text-xs break-all">
                    {action.method} {action.url}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {confirmation.profileId
                    ? `Pour ${ownerLabel(confirmation.profileId, profiles)}`
                    : 'Pour le foyer'}{' '}
                  · expire {formatWhen(confirmation.expiresAt)}
                </p>
              </div>
              {confirmation.approvedAt === null ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      decide('Commande validée.', () =>
                        api.approveActionConfirmation(confirmation.id),
                      )
                    }
                  >
                    <ShieldCheck />
                    Valider
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      decide('Demande refusée.', () =>
                        api.rejectActionConfirmation(confirmation.id),
                      )
                    }
                  >
                    <ShieldX />
                    Refuser
                  </Button>
                </div>
              ) : (
                <Badge variant="secondary">Validée</Badge>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ActionRow({
  action,
  actions,
  profiles,
  run,
  onChanged,
}: {
  action: HttpActionView;
  actions: HttpActionView[];
  profiles: Profile[];
  run: RunAction;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<{ text: string; failed: boolean } | null>(null);
  const missing = action.missingSecrets ?? [];

  async function test() {
    setTesting(true);
    setTestNote(null);
    try {
      const result = await api.testAction(action.id);
      const status = result.responseStatus;
      setTestNote({
        text:
          status && !result.summary.includes(String(status))
            ? `${result.summary} ${httpStatusLabel(status)}.`
            : result.summary,
        failed: result.status !== 'succeeded',
      });
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
            <strong className="text-sm font-medium">{action.label}</strong>
            <Badge variant="outline">{action.method}</Badge>
            <Badge variant="outline">{ownerLabel(action.profileId, profiles)}</Badge>
            <Badge variant={action.confirmation === 'required' ? 'secondary' : 'outline'}>
              {confirmationLabel(action.confirmation)}
            </Badge>
            {!action.enabled && <Badge variant="outline">Désactivée</Badge>}
          </div>
          {action.description && (
            <p className="mt-2 text-xs text-muted-foreground">{action.description}</p>
          )}
          <p className="mt-2 text-xs wrap-anywhere text-muted-foreground">
            {action.url} · identifiant « {action.ref} »
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={testing}
            aria-label={
              testing
                ? `Test de la commande ${action.label} en cours`
                : `Tester la commande ${action.label}`
            }
            onClick={() => void test()}
          >
            <Play />
            {testing ? 'Test…' : 'Tester'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={editing}
            aria-label={`Configurer la commande ${action.label}`}
            onClick={() => setEditing((value) => !value)}
          >
            <Settings2 />
            Configurer
          </Button>
          <Button
            variant="danger-outline"
            size="sm"
            aria-label={`Supprimer la commande ${action.label}`}
            onClick={() => setDeleting(true)}
          >
            <Trash2 />
            Supprimer
          </Button>
        </div>
      </div>
      {missing.length > 0 && (
        <Alert role="note" className="border-amber-300/40">
          <KeyRound aria-hidden="true" />
          <AlertDescription className="text-foreground">
            <p>
              {missing.length > 1 ? 'Des secrets manquent' : 'Un secret manque'} : ajoutez{' '}
              {missing.map((name, index) => (
                <span key={name}>
                  {index > 0 && (index === missing.length - 1 ? ' et ' : ', ')}
                  <code className="break-all">CORNELIUS_SECRET_{name}</code>
                </span>
              ))}{' '}
              dans le fichier .env puis redémarrez Cornelius. Sans{' '}
              {missing.length > 1 ? 'eux' : 'lui'}, la commande échoue.
            </p>
          </AlertDescription>
        </Alert>
      )}
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
          message={`Supprimer « ${action.label} » ? Son journal d’exécution sera effacé.`}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            void run('Commande supprimée.', () => api.deleteAction(action.id)).then((done) => {
              setDeleting(false);
              if (done) void onChanged();
            });
          }}
        />
      )}
      {editing && (
        <ActionForm
          profiles={profiles}
          action={action}
          actions={actions}
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
