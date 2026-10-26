import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, PenLine, RefreshCw, UserPlus } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import type { MemoryBatch, MemoryFact, MemoryView } from '../../../shared/memory';
import { api } from '../../api';
import type { RunAction } from './types';
import { useAdminResource } from './useAdminResource';
import { formatWhen, ofName, plural } from './format';
import { ConfirmAction, Field, KeepHeight, LoadingCard, PersonPicker, SearchInput } from './shared';
import { useUnsavedChanges } from './unsaved';
import { personFromHash, personHref } from './person-links';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { Alert, AlertDescription } from '../ui/alert';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

export function Memory({ profiles, run }: { profiles: Profile[]; run: RunAction }) {
  const [selected, setSelected] = useState(() => personFromHash('memory') ?? profiles[0]?.id ?? '');
  // Un lien « Voir ce que Cornelius a retenu » ouvert alors que la rubrique l’est déjà.
  useEffect(() => {
    const linked = () => {
      const id = personFromHash('memory');
      if (id) setSelected(id);
    };
    window.addEventListener('hashchange', linked);
    return () => window.removeEventListener('hashchange', linked);
  }, []);
  const profile = profiles.find((p) => p.id === selected) ?? profiles[0];
  if (!profile)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Personne dans le foyer pour l’instant</CardTitle>
          <CardDescription>
            Les souvenirs appartiennent à chaque personne. Ajoutez d’abord quelqu’un au foyer.
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
    );
  return (
    <div className="space-y-5">
      <PersonPicker
        id="memory-profile"
        label="Souvenirs de"
        value={profile.id}
        onChange={setSelected}
        profiles={profiles}
        description={`Chaque personne a ses propres souvenirs : vous consultez, corrigez ou oubliez ceux ${ofName(profile.name)}.`}
      />
      <KeepHeight holdKey={profile.id}>
        <MemoryLoader key={profile.id} profile={profile} run={run} />
      </KeepHeight>
    </div>
  );
}

function MemoryLoader({ profile, run }: { profile: Profile; run: RunAction }) {
  const load = useCallback(() => api.memory(profile.id), [profile.id]);
  const resource = useAdminResource(load);
  if (resource.error && !resource.data)
    return (
      <Alert variant="destructive">
        <AlertDescription className="gap-3">
          <p>{resource.error}</p>
          <Button variant="outline" size="sm" onClick={() => void resource.reload()}>
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!resource.data) return <LoadingCard label="Chargement des souvenirs…" />;
  // Pas de clé dépendant de la version : un rechargement garde les corrections en cours.
  return (
    <div className="space-y-5">
      {resource.error && (
        <Alert variant="destructive">
          <AlertDescription>{resource.error}</AlertDescription>
        </Alert>
      )}
      <MemoryPanel
        loaded={resource.data}
        name={profile.name}
        reload={resource.reload}
        reloading={resource.loading}
        run={run}
      />
    </div>
  );
}

const batchLabels: Record<MemoryBatch['status'], string> = {
  extracting: 'Analyse en cours',
  applied: 'Conversation analysée',
  rejected: 'Proposition écartée',
  failed: 'Analyse impossible',
  cancelled: 'Analyse annulée',
};

/** « 05/10 », avec l’année seulement si ce n’est pas l’année en cours. */
function shortDate(value: number): string {
  const date = new Date(value);
  return date.toLocaleDateString(
    'fr-FR',
    date.getFullYear() === new Date().getFullYear()
      ? { day: '2-digit', month: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' },
  );
}

/** D’où vient le souvenir, sans identifiant technique. */
function memoryOrigin(memory: MemoryFact, name: string): string {
  if (memory.origin === 'admin')
    return 'Corrigé dans l’administration le ' + shortDate(memory.updatedAt);
  if (!memory.evidence.length) return 'Retenu d’une conversation le ' + shortDate(memory.updatedAt);
  return `Retenu de ${plural(memory.evidence.length, 'phrase dite', 'phrases dites')} par ${name} le ${shortDate(memory.updatedAt)}`;
}

type Mutate = (
  label: string,
  action: (version: number) => Promise<MemoryView>,
  conflict: string,
) => Promise<{ ok: boolean; conflict: boolean }>;

function MemoryPanel({
  loaded,
  name,
  reload,
  reloading,
  run,
}: {
  loaded: MemoryView;
  name: string;
  reload: () => Promise<void>;
  reloading: boolean;
  run: RunAction;
}) {
  const [view, setView] = useState(loaded);
  useEffect(() => setView(loaded), [loaded]);
  const [forgetAll, setForgetAll] = useState(false);
  const [filter, setFilter] = useState('');
  // Une version périmée (409) : la mémoire a changé ailleurs, par exemple après une
  // conversation. La liste est relue sans fermer les corrections en cours.
  const mutate: Mutate = async (label, action, conflict) => {
    let conflicted = false;
    const ok = await run(label, async () => {
      const version = view.version;
      try {
        setView(await action(version));
      } catch (failure) {
        const fresh = await api.memory(view.profileId).catch(() => null);
        if (fresh && fresh.version !== version) {
          conflicted = true;
          setView(fresh);
          throw new Error(conflict);
        }
        throw failure;
      }
    });
    return { ok, conflict: conflicted };
  };
  const memories = view.memories.filter((m) =>
    (m.topic + ' ' + m.fact).toLocaleLowerCase('fr').includes(filter.toLocaleLowerCase('fr')),
  );
  const count = view.memories.length;
  return (
    <div className="space-y-5">
      <details className="group rounded-xl border bg-card px-5 py-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
          <span>
            Ce que Cornelius a retenu récemment
            <span className="ml-2 font-normal text-muted-foreground">
              {view.batches.length
                ? plural(view.batches.length, 'conversation')
                : 'aucune conversation'}
            </span>
          </span>
          <ChevronDown
            className="size-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Le résultat de l’analyse après chaque conversation. Le texte de la conversation n’est
            pas conservé.
          </p>
          {!view.batches.length && (
            <p className="text-muted-foreground">Aucune conversation analysée pour {name}.</p>
          )}
          <ul className="space-y-2">
            {view.batches.map((batch) => (
              <li key={batch.id}>
                <p>
                  {batchLabels[batch.status]} · {formatWhen(batch.createdAt)}
                </p>
                {batch.reason && <p className="text-muted-foreground">{batch.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      </details>
      <Card>
        <CardHeader>
          <CardTitle>Mémoire de {name}</CardTitle>
          <CardDescription>
            Les souvenirs sont retenus après une conversation où {name} est la seule personne devant
            le miroir, reconnue par la caméra. Ils restent propres à {name}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="memory-enabled" className="text-sm font-medium">
              Autoriser la mémoire
            </label>
            <Switch
              id="memory-enabled"
              checked={view.enabled}
              onCheckedChange={(enabled) =>
                void mutate(
                  'Réglage mémoire enregistré.',
                  (version) => api.memoryEnabled(view.profileId, enabled, version),
                  `La mémoire de ${name} a changé entre-temps : la liste est à jour. Vérifiez le réglage, puis recommencez.`,
                )
              }
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {view.enabled
              ? 'Cornelius peut retenir des faits et s’en servir quand on le lui demande.'
              : 'Cornelius ne retient plus rien et ne consulte plus ces souvenirs. Ils restent visibles ici.'}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Après la conversation, ce que {name} a dit et ses souvenirs actuels sont envoyés au
            fournisseur vocal choisi, qui propose quoi retenir. Le texte de la conversation est
            ensuite effacé : seul reste le nombre de phrases à l’origine de chaque souvenir. À
            plusieurs, ou si la caméra ne sait pas qui parle, rien n’est retenu.
          </p>
          <p className="text-xs text-muted-foreground">
            Corriger, oublier ou changer l’autorisation ferme la conversation en cours avec {name},
            pour qu’elle reparte avec la mémoire à jour.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={reloading} onClick={() => void reload()}>
              <RefreshCw className={reloading ? 'animate-spin' : undefined} />
              Actualiser les souvenirs
            </Button>
            <Button asChild variant="ghost">
              <a href={personHref('personality', view.profileId)}>
                <PenLine />
                Écrire un fait permanent
              </a>
            </Button>
            <Button
              variant="danger-outline"
              disabled={!count}
              aria-label={`Tout oublier sur ${name}`}
              onClick={() => setForgetAll(true)}
            >
              Tout oublier
            </Button>
          </div>
          {forgetAll && count > 0 && (
            <ConfirmAction
              message={`Oublier ${count > 1 ? `les ${count} souvenirs` : 'le souvenir'} de ${name} ? C’est définitif.`}
              confirmLabel={count > 1 ? `Oublier les ${count} souvenirs` : 'Oublier le souvenir'}
              onCancel={() => setForgetAll(false)}
              onConfirm={() => {
                void mutate(
                  'Tous les souvenirs ont été oubliés.',
                  (version) => api.forgetMemory(view.profileId, null, version),
                  `La mémoire de ${name} a changé entre-temps : la liste est à jour. Vérifiez-la, puis recommencez.`,
                ).then(({ ok }) => {
                  if (ok) setForgetAll(false);
                });
              }}
            />
          )}
        </CardContent>
      </Card>
      {count > 0 && (
        <Field
          id="memory-filter"
          label="Rechercher un souvenir"
          help={
            filter
              ? plural(memories.length, 'souvenir affiché', 'souvenirs affichés') +
                ' sur ' +
                count.toLocaleString('fr-FR') +
                '.'
              : plural(count, 'souvenir enregistré', 'souvenirs enregistrés') + '.'
          }
        >
          <SearchInput
            id="memory-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Un sujet, une préférence…"
          />
        </Field>
      )}
      {!memories.length && (
        <p className="text-sm text-muted-foreground">
          {filter
            ? 'Aucun souvenir correspondant.'
            : `Aucun souvenir pour l’instant. Ils apparaîtront après une conversation où ${name} est la seule personne devant le miroir.`}
        </p>
      )}
      {memories.length > 0 && (
        <ul className="space-y-2" aria-label={'Ce que Cornelius sait de ' + name}>
          {memories.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} view={view} name={name} mutate={mutate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function localDate(date: number): string {
  return new Date(date - new Date(date).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function MemoryRow({
  memory,
  view,
  name,
  mutate,
}: {
  memory: MemoryFact;
  view: MemoryView;
  name: string;
  mutate: Mutate;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [topic, setTopic] = useState(memory.topic);
  const [fact, setFact] = useState(memory.fact);
  const [scope, setScope] = useState(memory.scope);
  const [expiry, setExpiry] = useState(memory.expiresAt ? localDate(memory.expiresAt) : '');
  useUnsavedChanges(
    editing &&
      (topic !== memory.topic ||
        fact !== memory.fact ||
        scope !== memory.scope ||
        expiry !== (memory.expiresAt ? localDate(memory.expiresAt) : '')),
  );
  const id = memory.id;
  const conflictMessage = `La mémoire de ${name} a changé entre-temps. La liste est à jour et votre correction est gardée : vérifiez-la, puis enregistrez de nouveau.`;
  const startEditing = () => {
    // Le brouillon part du souvenir tel qu’il est maintenant.
    setTopic(memory.topic);
    setFact(memory.fact);
    setScope(memory.scope);
    setExpiry(memory.expiresAt ? localDate(memory.expiresAt) : '');
    setConflict(false);
    setDeleting(false);
    setEditing(true);
  };
  return (
    <li className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{memory.topic}</span>
            {memory.scope === 'temporary' && (
              <Badge variant="outline" title={'Expire le ' + formatWhen(memory.expiresAt!)}>
                Temporaire
              </Badge>
            )}
            {memory.origin === 'admin' && <Badge variant="secondary">Corrigé</Badge>}
          </p>
          <p className="text-sm break-words whitespace-pre-wrap">{memory.fact}</p>
          <p className="text-xs text-muted-foreground">
            {memoryOrigin(memory, name)}
            {memory.scope === 'temporary' &&
              memory.expiresAt &&
              ' · expire le ' + formatWhen(memory.expiresAt)}
          </p>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Corriger le souvenir « ${memory.topic} »`}
              onClick={startEditing}
            >
              Corriger
            </Button>
            <Button
              variant="danger-outline"
              size="sm"
              aria-label={`Oublier le souvenir « ${memory.topic} »`}
              onClick={() => setDeleting(true)}
            >
              Oublier
            </Button>
          </div>
        )}
      </div>
      {editing && (
        <form
          className="mt-4 space-y-4 border-t pt-4"
          aria-label={'Corriger le souvenir « ' + memory.topic + ' »'}
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              'Souvenir corrigé.',
              (version) =>
                api.editMemory(view.profileId, id, {
                  version,
                  topic,
                  fact,
                  scope,
                  expiresAt: scope === 'temporary' ? new Date(expiry).toISOString() : null,
                }),
              conflictMessage,
            ).then(({ ok, conflict }) => {
              setConflict(conflict);
              if (ok) setEditing(false);
            });
          }}
        >
          {conflict && (
            <Alert role="status">
              <AlertDescription>{conflictMessage}</AlertDescription>
            </Alert>
          )}
          <Field id={'topic-' + id} label="Sujet">
            <Input
              id={'topic-' + id}
              autoFocus
              autoComplete="off"
              value={topic}
              maxLength={80}
              required
              onChange={(e) => setTopic(e.target.value)}
            />
          </Field>
          <Field id={'fact-' + id} label="Souvenir">
            <Textarea
              id={'fact-' + id}
              className="min-h-20"
              rows={3}
              value={fact}
              maxLength={500}
              required
              onChange={(e) => setFact(e.target.value)}
            />
          </Field>
          <Field id={'scope-' + id} label="Durée">
            <NativeSelect
              id={'scope-' + id}
              wrapperClassName="w-full sm:w-64"
              className="w-full"
              value={scope}
              onChange={(e) => setScope(e.target.value as MemoryFact['scope'])}
            >
              <NativeSelectOption value="durable">Durable</NativeSelectOption>
              <NativeSelectOption value="temporary">Temporaire</NativeSelectOption>
            </NativeSelect>
          </Field>
          {scope === 'temporary' && (
            <Field id={'expiry-' + id} label="Expiration">
              <Input
                id={'expiry-' + id}
                type="datetime-local"
                value={expiry}
                required
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!topic.trim() || !fact.trim()}>
              Enregistrer le souvenir
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setConflict(false);
              }}
            >
              Annuler
            </Button>
          </div>
        </form>
      )}
      {deleting && !editing && (
        <div className="mt-3">
          <ConfirmAction
            message={`Oublier ce souvenir de ${name} ? C’est définitif.`}
            confirmLabel="Oublier ce souvenir"
            onCancel={() => setDeleting(false)}
            onConfirm={() => {
              void mutate(
                'Souvenir oublié.',
                (version) => api.forgetMemory(view.profileId, id, version),
                `La mémoire de ${name} a changé entre-temps : la liste est à jour. Vérifiez ce souvenir, puis recommencez.`,
              );
            }}
          />
        </div>
      )}
    </li>
  );
}
