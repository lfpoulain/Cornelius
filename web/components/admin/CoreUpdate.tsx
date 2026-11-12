import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, RefreshCw } from 'lucide-react';
import type { CoreUpdateView } from '../../../shared/module-store';
import { api } from '../../api';
import type { RunAction } from './types';
import { formatWhen, plural } from './format';
import { useAdminResource } from './useAdminResource';
import { ConfirmAction } from './shared';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

/**
 * Version de Cornelius et sa mise à jour : dernière version publiée sur main, la branche
 * suivie sinon. L'application arrête le serveur le temps de l'installation.
 */
export function CoreUpdateCard({ run }: { run: RunAction }) {
  const load = useCallback(() => api.coreUpdate(), []);
  const { data } = useAdminResource<CoreUpdateView>(load);
  const [view, setView] = useState<CoreUpdateView | null>(null);
  useEffect(() => setView(data), [data]);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = view ?? data;
  if (!current) return null;
  const target = current.target;
  const check = () =>
    void run('Recherche terminée.', async () => setView(await api.checkCoreUpdate()));
  return (
    <Card id="core-update">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Cornelius {current.version}
          {current.branch && current.branch !== 'main' && (
            <Badge variant="outline">branche {current.branch}</Badge>
          )}
          {target && <Badge>Mise à jour disponible</Badge>}
        </CardTitle>
        <CardDescription>
          {current.supported
            ? current.channel === 'branch'
              ? 'Suit les nouveautés de sa branche.'
              : 'Suit les versions publiées de Cornelius.'
            : current.reason}
          {current.checkedAt !== null && ` Dernière recherche : ${formatWhen(current.checkedAt)}.`}
        </CardDescription>
      </CardHeader>
      {current.supported && (
        <CardContent className="space-y-4">
          {current.lastRun && (
            <p
              className={current.lastRun.ok ? 'text-sm' : 'text-sm text-destructive'}
              role="status"
            >
              Dernière mise à jour ({formatWhen(current.lastRun.at)}) : {current.lastRun.message}
            </p>
          )}
          {current.error && (
            <Alert variant="destructive">
              <AlertDescription>{current.error}</AlertDescription>
            </Alert>
          )}
          {current.running ? (
            <p role="status" className="text-sm">
              Mise à jour en cours : Cornelius s’arrête, s’installe puis redémarre. Cette page se
              reconnectera seule ; il faudra peut-être se reconnecter.
            </p>
          ) : target ? (
            <div className="space-y-3">
              <p className="text-sm">
                {target.version ? `Version ${target.version}` : target.ref} :{' '}
                {plural(target.count, 'changement')}.
              </p>
              <ul className="max-h-48 space-y-0.5 overflow-auto text-sm text-muted-foreground">
                {target.commits.map((commit) => (
                  <li key={commit.sha}>
                    <code className="mr-2 text-xs">{commit.sha.slice(0, 7)}</code>
                    {commit.subject}
                  </li>
                ))}
                {target.count > target.commits.length && (
                  <li>… et {plural(target.count - target.commits.length, 'autre')}</li>
                )}
              </ul>
              {current.dirty && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Des fichiers de Cornelius ont été modifiés à la main : la mise à jour les
                    écraserait. Annulez-les (git status) ou mettez à jour à la main.
                  </AlertDescription>
                </Alert>
              )}
              {confirming ? (
                <ConfirmAction
                  message="Mettre à jour maintenant ? Cornelius sera indisponible quelques minutes."
                  confirmLabel="Mettre à jour"
                  returnFocusTo={trigger}
                  onCancel={() => setConfirming(false)}
                  onConfirm={() => {
                    setConfirming(false);
                    void run('Mise à jour lancée.', async () =>
                      setView(await api.applyCoreUpdate(target.commit)),
                    );
                  }}
                />
              ) : (
                <Button
                  ref={trigger}
                  size="sm"
                  disabled={current.dirty}
                  onClick={() => setConfirming(true)}
                >
                  <ArrowUpCircle aria-hidden="true" />
                  Mettre à jour vers {target.version ?? target.ref}
                </Button>
              )}
            </div>
          ) : (
            current.checkedAt !== null &&
            !current.error && <p className="text-sm">Cornelius est à jour.</p>
          )}
          <Button variant="outline" size="sm" disabled={current.checking} onClick={check}>
            <RefreshCw
              className={current.checking ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
            Rechercher une mise à jour
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
