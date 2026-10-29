import { useCallback, useId, useState, type FormEvent } from 'react';
import { Boxes, ExternalLink, KeyRound, Sparkles, type LucideIcon } from 'lucide-react';
import type { CustomProviderSettings, CustomProviderView } from '../../../shared/custom-provider';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import type { SecretView } from '../../../shared/types';
import { api } from '../../api';
import { addonIcon } from './addon-icons';
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
        <form className="flex flex-wrap gap-2" onSubmit={(event) => void save(event)}>
          <label htmlFor={id} className="sr-only">
            {secret.label}
          </label>
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 basis-48 font-mono"
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
  const Icon = secret.group === 'modules' ? addonIcon(secret.icon) : KeyRound;
  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card/50 p-4 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Icon className="size-5" />
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
  const headingId = useId();
  if (secrets.length === 0) return null;
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
      <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))]">
        {secrets.map((secret) => (
          <SecretCard key={secret.env} secret={secret} run={run} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function CustomProviderForm({ run, keyConfigured }: { run: RunAction; keyConfigured: boolean }) {
  const resource = useAdminResource(api.customProvider);
  return (
    <ResourceState resource={resource} loadingLabel="Lecture du fournisseur mémoire…">
      {(initial) => (
        <CustomProviderFields initial={initial} run={run} keyConfigured={keyConfigured} />
      )}
    </ResourceState>
  );
}

function CustomProviderFields({
  initial,
  run,
  keyConfigured,
}: {
  initial: CustomProviderView;
  run: RunAction;
  keyConfigured: boolean;
}) {
  const [view, setView] = useState(initial);
  const [form, setForm] = useState<CustomProviderSettings>(initial);
  const field = (key: keyof CustomProviderSettings, value: string) =>
    setForm({ ...form, [key]: value });
  const models = view.models;
  return (
    <section
      className="min-w-0 space-y-4 rounded-xl border bg-muted/20 p-4"
      aria-labelledby="custom-provider-settings"
    >
      <div>
        <h3 id="custom-provider-settings" className="text-sm font-semibold">
          Mémoire personnalisée
        </h3>
        <p className="text-xs text-muted-foreground">
          Extraction de la mémoire via une API compatible OpenAI. La clé se renseigne ci-dessus.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block min-w-0 space-y-1 text-sm">
          <span>Nom affiché</span>
          <Input value={form.name} onChange={(event) => field('name', event.target.value)} />
        </label>
        <label className="block min-w-0 space-y-1 text-sm">
          <span>URL de base</span>
          <Input
            type="url"
            placeholder="http://serveur:port/v1"
            value={form.baseUrl}
            onChange={(event) => field('baseUrl', event.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!keyConfigured || !form.baseUrl}
          onClick={() =>
            void run('Modèles compatibles détectés.', async () => {
              const saved = await api.saveCustomProvider(form);
              setView(saved);
              const discovered = await api.discoverCustomProviderModels();
              setView(discovered);
              setForm(discovered);
            })
          }
        >
          Détecter les modèles
        </Button>
        <span className="self-center text-xs text-muted-foreground">
          {models.length ? `${models.length} modèle(s) détecté(s)` : 'Aucun modèle détecté'}
        </span>
      </div>
      <datalist id="custom-provider-models">
        {models.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <label className="block min-w-0 space-y-1 text-sm">
        <span>Modèle mémoire</span>
        <Input
          list="custom-provider-models"
          value={form.memoryModel}
          onChange={(event) => field('memoryModel', event.target.value)}
        />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="block min-w-0 space-y-1 text-sm">
          <label htmlFor="custom-memoryProvider">Fournisseur mémoire</label>
          <NativeSelect
            id="custom-memoryProvider"
            value={form.memoryProvider}
            onChange={(event) => field('memoryProvider', event.target.value)}
          >
            <NativeSelectOption value="openai">OpenAI</NativeSelectOption>
            <NativeSelectOption value="mistral">Mistral</NativeSelectOption>
            <NativeSelectOption value="custom">Personnalisé</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="block min-w-0 space-y-1 text-sm">
          <label htmlFor="custom-memoryFallback">Secours mémoire</label>
          <NativeSelect
            id="custom-memoryFallback"
            value={form.memoryFallback}
            onChange={(event) => field('memoryFallback', event.target.value)}
          >
            <NativeSelectOption value="openai">OpenAI</NativeSelectOption>
            <NativeSelectOption value="mistral">Mistral</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Si le fournisseur personnalisé est indisponible, les données de cette extraction sont
        envoyées au fournisseur de secours choisi, si sa clé est renseignée.
      </p>
      <Button
        type="button"
        className="h-auto whitespace-normal"
        onClick={() =>
          void run('Fournisseur personnalisé enregistré.', async () => {
            const saved = await api.saveCustomProvider(form);
            setView(saved);
            setForm(saved);
          })
        }
      >
        Enregistrer la configuration
      </Button>
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
            const providers = secrets.filter((secret) => secret.group === 'providers');
            const modules = secrets.filter((secret) => secret.group === 'modules');
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
                <CustomProviderForm
                  run={run}
                  keyConfigured={secrets.some(
                    (secret) => secret.env === 'CUSTOM_OPENAI_API_KEY' && secret.configured,
                  )}
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
