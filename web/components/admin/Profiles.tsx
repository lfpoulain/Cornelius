import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, Plus, ScanFace, UserRound } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import { duplicateNameMessage, sameNameProfile } from '../../../shared/profile-names';
import { api } from '../../api';
import type { RunAction } from './types';
import { plural } from './format';
import { Field } from './shared';
import { useUnsavedChanges } from './unsaved';
import { requestFaceEnrollment, type FaceBlocker } from './FaceEnrollment';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';

/** Pourquoi « Mémoriser le visage … maintenant » est indisponible, dit à côté du bouton. */
const faceBlockerReasons: Record<FaceBlocker, string> = {
  perception:
    'Impossible pour l’instant : le service caméra (perception) n’est pas lancé. Relancez Cornelius avec scripts/start.sh (scripts/start.ps1 sous Windows), puis mémorisez le visage plus bas, dans « Reconnaissance des visages ».',
};

export function Profiles({
  profiles,
  run,
  onPersonalize,
  faceBlocker = null,
}: {
  profiles: Profile[];
  run: RunAction;
  onPersonalize: (id: string | null) => void;
  /** Ce qui empêche de mémoriser un visage tout de suite (service caméra arrêté…). */
  faceBlocker?: FaceBlocker | null;
}) {
  const [name, setName] = useState('');
  const [memory, setMemory] = useState(true);
  // Dernière personne ajoutée : sa ligne est montrée, avec la proposition de mémoriser son visage.
  const [created, setCreated] = useState<string | null>(null);
  const duplicate = sameNameProfile(profiles, name);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (duplicate) return;
    const result: { profile?: Profile } = {};
    const ok = await run('Profil créé.', async () => {
      result.profile = await api.addProfile(name.trim(), memory);
    });
    if (!ok) return;
    setName('');
    setMemory(true);
    setCreated(result.profile?.id ?? null);
  }
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Les membres du foyer</CardTitle>
          <CardDescription>
            {profiles.length === 0
              ? 'Votre foyer attend ses premiers profils.'
              : plural(profiles.length, 'profil enregistré', 'profils enregistrés') + '.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <div className="pb-4">
            <Button variant="outline" onClick={() => onPersonalize(null)}>
              Personnaliser Cornelius pour le foyer
            </Button>
          </div>
          {profiles.length === 0 && (
            <p className="pt-4 text-sm leading-relaxed text-muted-foreground">
              Commencez par ajouter un prénom dans « Une nouvelle personne ».
            </p>
          )}
          {profiles.map((profile) => (
            <ProfileRow
              profile={profile}
              profiles={profiles}
              run={run}
              key={profile.id}
              fresh={created === profile.id}
              faceBlocker={faceBlocker}
              onFreshDone={() => setCreated(null)}
              onPersonalize={onPersonalize}
            />
          ))}
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Une nouvelle personne</CardTitle>
          <CardDescription>
            Ajoutez un prénom, puis mémorisez son visage plus bas, dans « Reconnaissance des
            visages ».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              void add(event);
            }}
          >
            <Field id="new-profile" label="Prénom ou nom d’affichage">
              <Input
                id="new-profile"
                autoComplete="off"
                maxLength={80}
                required
                value={name}
                aria-invalid={!!duplicate}
                aria-describedby={duplicate ? 'new-profile-duplicate' : undefined}
                onChange={(event) => setName(event.target.value)}
                placeholder="Par exemple, Camille"
              />
              {duplicate && (
                <p id="new-profile-duplicate" className="text-xs leading-relaxed text-warning">
                  {duplicateNameMessage(duplicate.name, name)}
                </p>
              )}
            </Field>
            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={memory}
                onChange={(event) => setMemory(event.target.checked)}
              />
              <span>
                Laisser Cornelius retenir des souvenirs pour cette personne (extraits par le
                fournisseur vocal choisi après la conversation)
                <span className="block text-xs text-muted-foreground">
                  Modifiable à tout moment dans la rubrique Mémoire.
                </span>
              </span>
            </label>
            <Button disabled={!name.trim() || !!duplicate} type="submit">
              <Plus />
              Ajouter au foyer
            </Button>
          </form>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Le prénom est enregistré sur cet ordinateur. Quand Cornelius reconnaît la personne, il
            le transmet au fournisseur vocal choisi pour l’appeler par son prénom.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileRow({
  profile,
  profiles,
  run,
  fresh,
  faceBlocker,
  onFreshDone,
  onPersonalize,
}: {
  profile: Profile;
  profiles: Profile[];
  run: RunAction;
  /** Personne tout juste ajoutée : sa ligne est montrée et propose de mémoriser son visage. */
  fresh: boolean;
  faceBlocker: FaceBlocker | null;
  onFreshDone: () => void;
  onPersonalize: (id: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fresh) row.current?.scrollIntoView({ block: 'center' });
  }, [fresh]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(profile.name);
  const duplicate = sameNameProfile(profiles, name, profile.id);
  useUnsavedChanges(editing && name.trim() !== profile.name);
  useEffect(() => {
    setName(profile.name);
  }, [profile.name]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (duplicate) return;
    if (await run('Profil renommé.', () => api.renameProfile(profile.id, name.trim())))
      setEditing(false);
  }
  return (
    <div
      ref={row}
      id={'profile-' + profile.id}
      className={
        'profile-row space-y-3 py-5 first:pt-0 last:pb-0' +
        (fresh ? ' -mx-3 rounded-lg bg-primary/5 px-3 last:pb-5' : '')
      }
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-primary">
          <UserRound className="size-4" />
        </span>
        <strong className="text-sm font-medium">{profile.name}</strong>
      </div>
      {fresh && (
        <div className="space-y-3 rounded-lg border border-primary/30 p-3">
          <p className="text-sm leading-relaxed">
            {profile.name} fait partie du foyer. Pour que Cornelius reconnaisse {profile.name},
            mémorisez son visage maintenant, face à la caméra du miroir.
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Désactivé avec sa raison plutôt qu’un clic qui ne ferait que défiler. */}
            <Button
              size="sm"
              disabled={!!faceBlocker}
              aria-describedby={faceBlocker ? 'face-blocked-' + profile.id : undefined}
              onClick={() => {
                onFreshDone();
                requestFaceEnrollment(profile.id);
              }}
            >
              <ScanFace />
              Mémoriser le visage de {profile.name} maintenant
            </Button>
            <Button size="sm" variant="ghost" onClick={onFreshDone}>
              Plus tard
            </Button>
          </div>
          {faceBlocker && (
            <p
              id={'face-blocked-' + profile.id}
              className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span>{faceBlockerReasons[faceBlocker]}</span>
            </p>
          )}
        </div>
      )}
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <Field id={'name-' + profile.id} label={`Nouveau nom de ${profile.name}`}>
            <Input
              id={'name-' + profile.id}
              autoFocus
              autoComplete="off"
              value={name}
              aria-invalid={!!duplicate}
              aria-describedby={duplicate ? 'name-duplicate-' + profile.id : undefined}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
            {duplicate && (
              <p
                id={'name-duplicate-' + profile.id}
                className="text-xs leading-relaxed text-warning"
              >
                {duplicateNameMessage(duplicate.name, name)}
              </p>
            )}
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              type="submit"
              disabled={!name.trim() || name.trim() === profile.name || !!duplicate}
            >
              Enregistrer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setEditing(false);
                setName(profile.name);
              }}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : deleting ? (
        <DeleteProfile profile={profile} run={run} onClose={() => setDeleting(false)} />
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPersonalize(profile.id)}
            aria-label={'Personnaliser Cornelius pour ' + profile.name}
          >
            Personnaliser Cornelius
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={'Renommer ' + profile.name}
            onClick={() => setEditing(true)}
          >
            Renommer
          </Button>
          <Button
            variant="danger-outline"
            size="sm"
            aria-label={'Supprimer ' + profile.name}
            onClick={() => setDeleting(true)}
          >
            Supprimer
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Suppression définitive : la liste suit ce que la base efface en cascade (visage, souvenirs,
 * style et repères, sources, commandes, connexion à l’agent), puis les copies de sécurité.
 * Si un visage existe, l’oublier seul est proposé à côté.
 */
function DeleteProfile({
  profile,
  run,
  onClose,
}: {
  profile: Profile;
  run: RunAction;
  onClose: () => void;
}) {
  const [hasFace, setHasFace] = useState(false);
  useEffect(() => {
    let current = true;
    api
      .devices()
      .then((status) => {
        if (current) setHasFace(status.perception.enrolledProfileIds.includes(profile.id));
      })
      // Sans réponse, seule la suppression complète reste proposée.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [profile.id]);
  return (
    <Alert variant="destructive" role="group" aria-label={'Supprimer ' + profile.name}>
      <AlertDescription className="space-y-3">
        <p>
          Supprimer définitivement {profile.name} ? Son visage, ses souvenirs, son style et ses
          repères, ses sources et commandes personnelles et la connexion à son agent seront effacés,
          copies de sécurité comprises. Cette action ne peut pas être annulée.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              void run('Profil supprimé.', () => api.deleteProfile(profile.id));
            }}
          >
            Supprimer {profile.name} définitivement
          </Button>
          {hasFace && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void run('Visage oublié.', () => api.forgetFace(profile.id)).then((ok) => {
                  if (ok) onClose();
                });
              }}
            >
              Oublier seulement le visage
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
