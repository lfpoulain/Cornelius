import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_GOOGLE_PHOTOS,
  type GooglePhotosSettings as Settings,
} from '../../../shared/google-photos';
import { api, errorMessage } from '../../api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { Label } from '../ui/label';
import { ChoiceGroup } from '../ui/choice-card';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { ResourceState, SaveBar } from './shared';
import { useAdminResource } from './useAdminResource';
import type { RunAction } from './types';
import { plural } from './format';

export function GooglePhotosSettings({ run }: { run: RunAction }) {
  const load = useCallback(() => api.googlePhotos(), []);
  const resource = useAdminResource(load);
  const [draft, setDraft] = useState<Settings>(DEFAULT_GOOGLE_PHOTOS);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (resource.data && !dirty) {
      const { source, albumUrl, refreshMinutes } = resource.data;
      setDraft({ source, albumUrl, refreshMinutes });
    }
  }, [resource.data, dirty]);
  useEffect(() => {
    if (busy || dirty) return;
    const timer = setInterval(() => void resource.reload(), 30000);
    return () => clearInterval(timer);
  }, [busy, dirty, resource.reload]);
  const change = (changes: Partial<Settings>) => {
    const next = { ...draft, ...changes };
    setDirty(
      (['source', 'albumUrl', 'refreshMinutes'] as const).some(
        (key) => next[key] !== resource.data?.[key],
      ),
    );
    setDraft(next);
    setError(null);
  };
  const action = async (save: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const ok = await run(
        save ? 'Source de l’écran de veille enregistrée.' : 'Vérification de l’album terminée.',
        () => (save ? api.saveGooglePhotos(draft) : api.refreshGooglePhotos()),
        { onError: (cause) => setError(errorMessage(cause)) },
      );
      if (ok) {
        await resource.reload();
        if (save) setDirty(false);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source des images</CardTitle>
        <CardDescription>
          Un album Google Photos partagé peut remplacer les images locales. Cette connexion
          expérimentale dépend de la page de partage de Google et peut cesser de fonctionner si son
          format change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResourceState resource={resource} loadingLabel="Lecture de la source…">
          {(view) => (
            <>
              <ChoiceGroup
                legend="Images affichées"
                value={draft.source}
                disabled={busy}
                options={[
                  {
                    value: 'local',
                    label: 'Images locales',
                    description: 'Vos photos et les peintures ajoutées ci-dessous.',
                  },
                  {
                    value: 'google-photos',
                    label: 'Album Google Photos',
                    description: 'Photos lues sur Google, sans import sur disque.',
                  },
                ]}
                onValueChange={(source) => change({ source })}
              />
              {(draft.source === 'google-photos' || draft.albumUrl.trim()) && (
                <Alert>
                  <AlertDescription>
                    <p className="font-medium text-foreground">
                      Photos accessibles à toute personne possédant le lien
                    </p>
                    <p>
                      Le partage par lien rend les photos de cet album consultables sans connexion à
                      votre compte Google. Toute personne qui obtient ce lien peut les voir.
                      Choisissez un album dont vous acceptez ce partage et ne diffusez pas son lien.
                    </p>
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="screensaver-google-album">Lien de partage de l’album</Label>
                <Input
                  id="screensaver-google-album"
                  type="url"
                  value={draft.albumUrl}
                  maxLength={2048}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  aria-describedby="google-album-help"
                  placeholder="https://photos.app.goo.gl/…"
                  onChange={(event) => change({ albumUrl: event.target.value })}
                />
                <p id="google-album-help" className="text-xs text-muted-foreground">
                  Dans Google Photos : ouvrez l’album, puis Partager → Créer un lien. Une adresse
                  /album/ privée ne convient pas. Aucune clé API ni connexion à votre compte n’est
                  demandée.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="screensaver-google-refresh">
                  Actualiser l’album toutes les (minutes)
                </Label>
                <Input
                  id="screensaver-google-refresh"
                  type="number"
                  min={5}
                  max={1440}
                  step={1}
                  value={draft.refreshMinutes}
                  disabled={busy}
                  onChange={(event) => change({ refreshMinutes: Number(event.target.value) })}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy || dirty || view.source !== 'google-photos'}
                  onClick={() => void action(false)}
                >
                  Actualiser maintenant
                </Button>
              </div>
              <SaveBar
                label="Source des images"
                count={
                  (['source', 'albumUrl', 'refreshMinutes'] as const).filter(
                    (key) => draft[key] !== view[key],
                  ).length
                }
                saving={busy}
                onSave={() => void action(true)}
                onCancel={() => {
                  setDraft({
                    source: view.source,
                    albumUrl: view.albumUrl,
                    refreshMinutes: view.refreshMinutes,
                  });
                  setDirty(false);
                }}
                error={
                  !Number.isInteger(draft.refreshMinutes) ||
                  draft.refreshMinutes < 5 ||
                  draft.refreshMinutes > 1440
                    ? 'Choisissez une durée entière entre 5 et 1440 minutes.'
                    : draft.source === 'google-photos' && !draft.albumUrl.trim()
                      ? 'Indiquez le lien partagé de l’album.'
                      : undefined
                }
              >
                <p className="text-xs text-muted-foreground">
                  L’enregistrement vérifie aussi l’accès à l’album.
                </p>
              </SaveBar>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {view.source === 'google-photos' && (
                <div role="status" className="space-y-2 text-sm">
                  <p>
                    {view.error ??
                      (view.refreshing
                        ? 'Lecture de l’album…'
                        : plural(view.count, 'photo disponible', 'photos disponibles') + '.')}
                  </p>
                  {view.lastCheckedAt !== null && (
                    <p className="text-xs text-muted-foreground">
                      Dernière vérification : {new Date(view.lastCheckedAt).toLocaleString('fr-FR')}
                      .
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Seules les photos présentes dans la page initiale sont accessibles, dans la limite
                de 500. Les grands albums peuvent être incomplets. L’actualisation manuelle est
                limitée à une fois par minute. En cas d’erreur, l’album est retiré du diaporama
                jusqu’à une vérification réussie. Les images locales restent conservées pour pouvoir
                revenir à cette source.
              </p>
              {view.images.length > 0 && (
                <ul
                  aria-label="Aperçu de l’album"
                  className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                >
                  {view.images.map((image) => (
                    <li key={image.id}>
                      <img
                        src={image.url}
                        alt={image.title}
                        loading="lazy"
                        className="aspect-video w-full rounded-lg bg-black object-contain"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </ResourceState>
      </CardContent>
    </Card>
  );
}
