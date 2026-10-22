import { useEffect, useState } from 'react';
import { cameraWatchesInStandby, currentOpening } from '../../../shared/opening';
import {
  CAMERA_FRAME_RATES,
  CAMERA_RESOLUTIONS,
  DEFAULT_CAMERA_MODE,
  type CameraMode,
} from '../../../shared/camera';
import type { DevicesStatus, MirrorState } from '../../../shared/types';
import type { RunAction } from './types';
import { request } from '../../api';
import { isSessionActive } from './format';
import { Field } from './shared';
import { useCameraHold } from './useCameraHold';
import { useCameraPreview } from './useCameraPreview';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Alert, AlertDescription } from '../ui/alert';

/**
 * Pourquoi la caméra ne peut pas être changée maintenant : seulement un service arrêté ou un
 * visage en cours d’enregistrement. Une conversation ou une veille sans caméra ne bloquent plus :
 * la page garde la caméra allumée le temps du réglage.
 */
export function cameraBlocker(context: { connected: boolean; enrolling: boolean }): string | null {
  if (!context.connected)
    return 'Le service caméra n’est pas lancé : relancez Cornelius sur cet ordinateur pour choisir la caméra.';
  if (context.enrolling)
    return 'Un visage est en cours d’enregistrement : la caméra pourra être changée ensuite.';
  return null;
}

/** Ce qu’il est utile de savoir sans rien bloquer : allumage, veille sans caméra, conversation. */
export function cameraNote(context: {
  starting: boolean;
  standbyOff: boolean;
  conversation: boolean;
}): string | null {
  if (context.starting) return 'Allumage de la caméra pour le réglage…';
  if (context.conversation)
    return 'Une conversation est en cours : changer de caméra ou de résolution peut la couper un instant.';
  if (context.standbyOff)
    return 'Avec ce mode d’ouverture, la caméra est éteinte en veille. Elle reste allumée tant que cette page est ouverte, le temps du réglage.';
  return null;
}

export function Camera({
  state,
  status,
  run,
}: {
  state: MirrorState;
  status: DevicesStatus | null;
  run: RunAction;
}) {
  const camera = status?.perception.camera;
  const connected = !!status?.perception.connected;
  const [selected, setSelected] = useState(camera?.selectedId ?? '');
  const [open, setOpen] = useState(false);
  const standbyOff = !cameraWatchesInStandby(currentOpening(state));
  useCameraHold(connected);
  // Caméra pas encore rallumée par le maintien : on attend, sans vider ni griser la liste.
  const starting = connected && !!camera?.suspended;
  const blocker = cameraBlocker({ connected, enrolling: !!status?.perception.enrollingProfileId });
  const note = blocker
    ? null
    : cameraNote({ starting, standbyOff, conversation: isSessionActive(state) });
  const busy = blocker !== null || starting || !!camera?.changing;
  useEffect(() => {
    setSelected(camera?.selectedId ?? '');
  }, [camera?.selectedId]);
  const { frame, error, visible } = useCameraPreview(
    open && connected && !!camera?.selectedId && !camera.changing,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Caméra du miroir</CardTitle>
        <CardDescription>
          Choisissez la caméra utilisée pour la présence et la reconnaissance des visages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field id="camera-source" label="Emplacement de la caméra">
          <NativeSelect
            id="camera-source"
            value={camera?.source ?? 'server'}
            disabled={!!status?.perception.enrollingProfileId}
            onChange={(event) =>
              void run('Source de la caméra enregistrée.', () =>
                request('/api/admin/camera/source', {
                  method: 'PUT',
                  body: JSON.stringify({ source: event.target.value }),
                }),
              )
            }
          >
            <NativeSelectOption value="server">Sur le serveur Cornelius</NativeSelectOption>
            <NativeSelectOption value="browser">
              Sur l’appareil qui affiche le miroir
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        {camera?.source === 'browser' && (
          <p className="text-sm text-muted-foreground">
            Ouvrez le miroir en HTTPS sur cet appareil, puis activez sa caméra. Les images
            traversent le réseau local chiffré et sont analysées par le service de perception du
            serveur. La caméra se choisit sur le miroir ; le serveur doit toujours exécuter la
            perception.
          </p>
        )}

        {camera?.source !== 'browser' && (
          <div className="flex flex-wrap items-end gap-3">
            <Field className="min-w-56 flex-1" id="camera" label="Caméra">
              <NativeSelect
                id="camera"
                wrapperClassName="w-full"
                className="w-full"
                value={connected ? selected : ''}
                disabled={busy}
                aria-describedby={blocker || note ? 'camera-blocker' : undefined}
                onChange={(event) => setSelected(event.target.value)}
              >
                <NativeSelectOption value="" disabled>
                  {!connected
                    ? 'Aucune caméra : le service caméra n’est pas lancé'
                    : starting
                      ? 'Allumage de la caméra…'
                      : camera?.devices.length
                        ? 'Choisir une caméra'
                        : 'Aucune caméra détectée'}
                </NativeSelectOption>
                {camera?.devices.map((device) => (
                  <NativeSelectOption key={device.id} value={device.id}>
                    {device.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button
              disabled={busy || !selected || selected === camera?.selectedId}
              onClick={() => {
                void run('Changement de caméra demandé.', () =>
                  request('/api/admin/camera/select', {
                    method: 'POST',
                    body: JSON.stringify({ id: selected }),
                  }),
                );
              }}
            >
              {camera?.changing ? 'Connexion…' : 'Utiliser cette caméra'}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run('Recherche des caméras demandée.', () =>
                  request('/api/admin/camera/refresh', { method: 'POST' }),
                );
              }}
            >
              Actualiser la liste
            </Button>
          </div>
        )}
        {camera?.mode && (
          <CameraModeSettings
            mode={camera.mode}
            browser={camera.source === 'browser'}
            actual={camera.actual ?? null}
            disabled={busy || !camera.selectedId}
            run={run}
          />
        )}
        {(blocker ?? note) && (
          <p id="camera-blocker" className="text-sm text-muted-foreground" role="status">
            {blocker ?? note}
          </p>
        )}
        {connected && camera?.error && (
          <Alert variant="destructive">
            <AlertDescription>{camera.error}</AlertDescription>
          </Alert>
        )}
        <Button
          variant="outline"
          aria-expanded={open}
          aria-controls="camera-preview"
          disabled={!open && (!connected || !camera?.selectedId || camera.changing)}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Masquer l’aperçu' : 'Afficher l’aperçu'}
        </Button>
        {open && (
          <div id="camera-preview" className="overflow-hidden rounded-xl border bg-black">
            <div className="relative flex aspect-video items-center justify-center">
              {frame ? (
                <img
                  src={frame}
                  alt="Aperçu en direct de la caméra du miroir"
                  className="absolute h-full w-full object-contain"
                />
              ) : (
                <p className="px-5 text-center text-sm text-muted-foreground" role="status">
                  {error ||
                    (!connected
                      ? 'Service caméra arrêté.'
                      : !visible
                        ? 'Aperçu en pause.'
                        : 'Connexion à la caméra…')}
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t bg-card px-4 py-3 text-xs text-muted-foreground">
              <span>
                {state.presence.peopleCount} personne(s) détectée(s)
                {state.activeProfile ? ' · ' + state.activeProfile.name : ''}
              </span>
              <span>Aperçu local · aucune image enregistrée</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Résolution et cadence : le conseil du jour sous chaque liste, et ce que la caméra a accepté. */
function CameraModeSettings({
  mode,
  browser,
  actual,
  disabled,
  run,
}: {
  mode: CameraMode;
  browser: boolean;
  actual: { width: number; height: number; fps: number | null } | null;
  disabled: boolean;
  run: RunAction;
}) {
  const resolution =
    CAMERA_RESOLUTIONS.find((item) => item.width === mode.width && item.height === mode.height) ??
    CAMERA_RESOLUTIONS[1];
  const rate = CAMERA_FRAME_RATES.find((item) => item.fps === mode.fps) ?? CAMERA_FRAME_RATES[1];
  const apply = (next: CameraMode) =>
    void run('Réglage de la caméra demandé.', () =>
      request('/api/admin/camera/mode', { method: 'PUT', body: JSON.stringify(next) }),
    );
  const recommended = (width: number, height: number, fps?: number) =>
    width === DEFAULT_CAMERA_MODE.width &&
    height === DEFAULT_CAMERA_MODE.height &&
    (fps === undefined || fps === DEFAULT_CAMERA_MODE.fps);
  const differs =
    actual &&
    (actual.width !== mode.width ||
      actual.height !== mode.height ||
      (!browser && actual.fps !== null && actual.fps !== mode.fps));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        <Field
          className="min-w-56 flex-1"
          id="camera-resolution"
          label="Résolution"
          help={resolution.hint}
        >
          <NativeSelect
            id="camera-resolution"
            wrapperClassName="w-full"
            className="w-full"
            value={`${mode.width}x${mode.height}`}
            disabled={disabled}
            onChange={(event) => {
              const [width, height] = event.target.value.split('x').map(Number) as [number, number];
              apply({ width, height, fps: mode.fps });
            }}
          >
            {CAMERA_RESOLUTIONS.map((item) => (
              <NativeSelectOption key={item.label} value={`${item.width}x${item.height}`}>
                {item.label}
                {recommended(item.width, item.height) ? ' (recommandée)' : ''}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {browser ? (
          <p className="text-sm text-muted-foreground">
            Caméra du navigateur : 10 images par seconde au maximum.
          </p>
        ) : (
          <Field
            className="min-w-56 flex-1"
            id="camera-fps"
            label="Images par seconde"
            help={rate.hint}
          >
            <NativeSelect
              id="camera-fps"
              wrapperClassName="w-full"
              className="w-full"
              value={String(mode.fps)}
              disabled={disabled}
              onChange={(event) => apply({ ...mode, fps: Number(event.target.value) })}
            >
              {CAMERA_FRAME_RATES.map((item) => (
                <NativeSelectOption key={item.fps} value={String(item.fps)}>
                  {item.label}
                  {item.fps === DEFAULT_CAMERA_MODE.fps ? ' (recommandée)' : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>
      {actual && (
        <p className="text-xs text-muted-foreground" role="status">
          Image reçue : {actual.width} x {actual.height}
          {actual.fps ? `, ${actual.fps} i/s` : ''}.
          {differs
            ? ' Cette caméra ne propose pas exactement ce réglage : elle a choisi le plus proche.'
            : ''}
        </p>
      )}
    </div>
  );
}
