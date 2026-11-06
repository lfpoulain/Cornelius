import { useState, type FormEvent } from 'react';
import {
  DEFAULT_LIVE_BASE_URL,
  liveBaseUrlError,
  type LiveEndpointView,
} from '../../../shared/live-endpoint';
import { api } from '../../api';
import type { RunAction } from './types';
import { Field, ResourceState } from './shared';
import { useAdminResource } from './useAdminResource';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

function sourceLabel(view: LiveEndpointView): string {
  if (view.source === 'admin') return 'Réglé ici';
  if (view.source === 'env') return 'Fichier .env (CORNELIUS_LIVE_BASE_URL)';
  return 'OpenAI (par défaut)';
}

/** Serveur Live : OpenAI par défaut, ou un serveur compatible tenu à la maison. */
export function LiveEndpointSettings({ run }: { run: RunAction }) {
  const resource = useAdminResource(api.liveEndpoint);
  return (
    <ResourceState resource={resource} loadingLabel="Lecture du serveur Live…">
      {(initial) => <LiveEndpointForm initial={initial} run={run} />}
    </ResourceState>
  );
}

function LiveEndpointForm({ initial, run }: { initial: LiveEndpointView; run: RunAction }) {
  const [view, setView] = useState(initial);
  const [value, setValue] = useState(initial.baseUrl);
  const error = value.trim() ? liveBaseUrlError(value) : null;
  const save = (baseUrl: string) =>
    run(
      baseUrl ? 'Serveur Live enregistré.' : 'Serveur Live par défaut rétabli.',
      async () => {
        const saved = await api.saveLiveEndpoint(baseUrl);
        setView(saved);
        setValue(saved.baseUrl);
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
            Adresse de base d’un serveur compatible avec l’API Live d’OpenAI, avec /v1. Vide :{' '}
            {view.envBaseUrl ? `celle du fichier .env (${view.envBaseUrl})` : 'OpenAI'}. La clé
            OpenAI lui est envoyée. S’applique à la prochaine conversation.
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
        <Badge variant={view.source === 'default' ? 'outline' : 'secondary'}>
          {sourceLabel(view)}
        </Badge>
        <code className="break-all text-xs text-muted-foreground">{view.effectiveBaseUrl}</code>
      </div>
    </form>
  );
}
