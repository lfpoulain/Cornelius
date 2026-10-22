import { useCallback, useState, type FormEvent } from 'react';
import {
  AudioWaveform,
  Boxes,
  ExternalLink,
  KeyRound,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { SecretView } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { ConfirmAction, ResourceState } from './shared';
import { useAdminResource } from './useAdminResource';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function status(secret: SecretView): string {
  if (!secret.configured) return 'À renseigner';
  const end = secret.hint ? ` (se termine par ${secret.hint})` : '';
  return secret.source === 'admin' ? `Dans l’administration${end}` : `Dans le fichier .env${end}`;
}

interface SecretPresentation {
  icon?: LucideIcon;
  logo?: string;
  iconClassName: string;
}

const providerEnvs = new Set(['OPENAI_API_KEY', 'MISTRAL_API_KEY']);

function presentationOf(secret: SecretView): SecretPresentation {
  switch (secret.env) {
    case 'OPENAI_API_KEY':
      return { logo: '/providers/openai.svg', iconClassName: 'bg-white text-black' };
    case 'MISTRAL_API_KEY':
      return { icon: AudioWaveform, iconClassName: 'bg-orange-500/10 text-orange-500' };
    case 'CORNELIUS_PRIM_API_KEY':
      return { logo: '/providers/idfm.svg', iconClassName: 'bg-white' };
    case 'CORNELIUS_METEO_CONCEPT_TOKEN':
      return { logo: '/providers/meteo-concept.png', iconClassName: 'bg-white' };
    default:
      return { icon: KeyRound, iconClassName: 'bg-primary/10 text-primary' };
  }
}

/**
 * Saisie d’une clé : la valeur part au serveur et n’en revient jamais. Une clé saisie ici passe
 * avant celle du fichier .env ; l’effacer fait revenir celle de .env.
 */
export function SecretField({
  secret,
  run,
  onChanged,
  inline = false,
}: {
  secret: SecretView;
  run: RunAction;
  onChanged: (secrets: SecretView[]) => void;
  /** Dans le bandeau d’un module : la saisie seule, sans état ni lien. */
  inline?: boolean;
}) {
  const [editing, setEditing] = useState(!secret.configured);
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const id = `secret-${secret.env}`;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(`Enregistré : ${secret.label}.`, async () => {
      const result = await api.saveSecret(secret.env, value);
      onChanged(result.secrets);
    });
    if (ok) {
      setValue('');
      setEditing(false);
    }
  };
  return (
    <div className="space-y-3">
      {!inline && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={secret.configured ? 'secondary' : 'outline'}>{status(secret)}</Badge>
          {secret.configured && !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Remplacer
            </Button>
          )}
          {secret.source === 'admin' && !confirming && (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Effacer
            </Button>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmAction
          message={`Effacer la valeur enregistrée ici pour « ${secret.label} » ? Celle du fichier .env, s’il y en a une, reprendra sa place.`}
          confirmLabel="Effacer"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run(`Effacé : ${secret.label}.`, async () => {
              const result = await api.deleteSecret(secret.env);
              onChanged(result.secrets);
            });
          }}
        />
      )}
      {editing && (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void save(event)}>
          <label htmlFor={id} className="sr-only">
            {secret.label}
          </label>
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono"
            placeholder="Collez la valeur ici"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={value.trim().length < 8}>
              Enregistrer
            </Button>
            {secret.configured && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValue('');
                  setEditing(false);
                }}
              >
                Annuler
              </Button>
            )}
          </div>
        </form>
      )}
      {secret.url && !inline && (
        <a
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-4"
          href={secret.url}
          target="_blank"
          rel="noreferrer"
        >
          Obtenir la clé sur {hostOf(secret.url)}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function SecretCard({
  secret,
  run,
  onChanged,
}: {
  secret: SecretView;
  run: RunAction;
  onChanged: (secrets: SecretView[]) => void;
}) {
  const presentation = presentationOf(secret);
  const Icon = presentation.icon;
  return (
    <article className="flex min-w-0 snap-start flex-col gap-4 rounded-xl border bg-card/50 p-4 shadow-sm [flex:0_0_min(28rem,calc(100vw-5rem))]">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${presentation.iconClassName}`}
          aria-hidden="true"
        >
          {presentation.logo ? (
            <img src={presentation.logo} alt="" className="size-6 object-contain" />
          ) : Icon ? (
            <Icon className="size-5" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold leading-5">
            {secret.label}
            {secret.note ? (
              <span className="font-normal text-muted-foreground"> ({secret.note})</span>
            ) : null}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{secret.usedBy}</p>
          <code className="mt-1 block break-all text-[0.7rem] text-muted-foreground/80">
            {secret.env}
          </code>
        </div>
      </div>
      <div className="mt-auto">
        <SecretField
          key={`${secret.env}-${secret.configured}`}
          secret={secret}
          run={run}
          onChanged={onChanged}
        />
      </div>
    </article>
  );
}

function SecretGroup({
  icon: Icon,
  title,
  description,
  secrets,
  run,
  onChanged,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  secrets: SecretView[];
  run: RunAction;
  onChanged: (secrets: SecretView[]) => void;
}) {
  if (secrets.length === 0) return null;
  const headingId = `secret-group-${title === 'Modules' ? 'modules' : 'providers'}`;
  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h3 id={headingId} className="text-sm font-semibold">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="secret-card-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 [scrollbar-gutter:stable]">
        {secrets.map((secret) => (
          <SecretCard key={secret.env} secret={secret} run={run} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

/** Clés des fournisseurs IA et jetons des modules, saisis sans toucher au fichier .env. */
export function Secrets({ run }: { run: RunAction }) {
  const load = useCallback(() => api.secrets().then((result) => result.secrets), []);
  const resource = useAdminResource(load);
  const [updated, setUpdated] = useState<SecretView[] | null>(null);
  const shown = { ...resource, data: updated ?? resource.data };
  return (
    <Card id="secrets">
      <CardHeader>
        <CardTitle>Clés et jetons</CardTitle>
        <CardDescription>
          Pris en compte tout de suite, sans redémarrer. Ils restent sur cet ordinateur : une fois
          enregistrés, l’administration n’en montre que les quatre derniers caractères. Une clé
          enregistrée ici passe avant celle du fichier .env.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResourceState resource={shown} loadingLabel="Lecture des clés…">
          {(secrets) => {
            const providers = secrets.filter((secret) => providerEnvs.has(secret.env));
            const modules = secrets.filter((secret) => !providerEnvs.has(secret.env));
            return (
              <div className="space-y-7">
                <SecretGroup
                  icon={Sparkles}
                  title="Fournisseurs IA"
                  description="Conversation, voix, mémoire et génération."
                  secrets={providers}
                  run={run}
                  onChanged={setUpdated}
                />
                <SecretGroup
                  icon={Boxes}
                  title="Modules"
                  description="Services externes utilisés par les modules installés."
                  secrets={modules}
                  run={run}
                  onChanged={setUpdated}
                />
              </div>
            );
          }}
        </ResourceState>
      </CardContent>
    </Card>
  );
}
