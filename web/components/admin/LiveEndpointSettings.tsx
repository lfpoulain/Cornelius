import { LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  DEFAULT_LIVE_BASE_URL,
  liveBaseUrlError,
  type LiveEndpointView,
} from '../../../shared/live-endpoint';
import { api } from '../../api';
import type { RunAction } from './types';
import { Field, LoadError } from './shared';
import { reloadLiveEndpoint, setLiveEndpoint, useLiveEndpoint } from './liveEndpointStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/** Nom du serveur Live, tel que l’administration le montre. */
export function liveServerLabel(view: LiveEndpointView): string {
  if (view.kind === 'openai') return 'OpenAI';
  if (view.kind === 'localive') return 'Localive';
  return 'Serveur compatible';
}

function sourceLabel(view: LiveEndpointView): string {
  if (view.source === 'admin') return 'réglé ici';
  if (view.source === 'env') return 'fichier .env';
  return 'par défaut';
}

/** Serveur Live : OpenAI par défaut, ou un serveur compatible tenu à la maison (Localive…). */
export function LiveEndpointSettings({ run }: { run: RunAction }) {
  const { view, error } = useLiveEndpoint();
  if (!view)
    return error ? (
      <LoadError error={error} onRetry={reloadLiveEndpoint} />
    ) : (
      <div className="admin-loading" data-admin-loading="" aria-busy="true">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <p role="status">Lecture du serveur Live…</p>
      </div>
    );
  return <LiveEndpointForm key={view.effectiveBaseUrl} view={view} run={run} />;
}

function LiveEndpointForm({ view, run }: { view: LiveEndpointView; run: RunAction }) {
  const [value, setValue] = useState(view.baseUrl);
  const error = value.trim() ? liveBaseUrlError(value) : null;
  const save = (baseUrl: string) =>
    run(
      baseUrl ? 'Serveur Live enregistré.' : 'Serveur Live par défaut rétabli.',
      async () => {
        const saved = await api.saveLiveEndpoint(baseUrl);
        setValue(saved.baseUrl);
        setLiveEndpoint(saved);
      },
      { key: 'live-endpoint' },
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!error) void save(value.trim());
  };
  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field
        id="live-endpoint"
        label="Serveur Live"
        error={error}
        help={
          <>
            Vide : {view.envBaseUrl ? `celui du fichier .env (${view.envBaseUrl})` : 'OpenAI'}. Pour
            Localive ou un autre serveur compatible, son adresse avec /v1. La clé OpenAI lui est
            envoyée. S’applique à la prochaine conversation.
          </>
        }
      >
        <Input
          id="live-endpoint"
          type="url"
          inputMode="url"
          spellCheck={false}
          className="font-mono"
          placeholder={view.envBaseUrl || DEFAULT_LIVE_BASE_URL}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button type="submit" size="sm" disabled={!!error || value.trim() === view.baseUrl}>
          Enregistrer
        </Button>
        {view.baseUrl && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void save('')}>
            Revenir à {view.envBaseUrl ? '.env' : 'OpenAI'}
          </Button>
        )}
        <Badge variant={view.kind === 'openai' ? 'outline' : 'secondary'}>
          {liveServerLabel(view)} · {sourceLabel(view)}
        </Badge>
        <code className="break-all text-xs text-muted-foreground">{view.effectiveBaseUrl}</code>
      </div>
    </form>
  );
}
