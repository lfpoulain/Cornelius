import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Mic, Volume2 } from 'lucide-react';
import { errorMessage } from '../../api';
import { previewAdmissionSound } from '../../audio/admission-sound';
import {
  audioPreferences,
  saveAudioPreferences,
  type AudioPreferences,
} from '../../audio/preferences';
import {
  microphoneConstraints,
  prepareAudio,
  releasePreparedMicrophone,
} from '../../audio/preparation';
import type { RunAction } from './types';
import { Field } from './shared';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Label } from '../ui/label';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Switch } from '../ui/switch';
import { Alert, AlertDescription } from '../ui/alert';

const fields = [
  {
    key: 'microphone',
    kind: 'audioinput',
    label: 'Microphone',
    saved: 'Microphone choisi pour ce navigateur.',
  },
  {
    key: 'speaker',
    kind: 'audiooutput',
    label: 'Haut-parleurs',
    saved: 'Haut-parleurs choisis pour ce navigateur.',
  },
] as const;

// GPT-Live n’a aucun réglage d’écoute : seuls les traitements du navigateur se choisissent.
const processing = [
  {
    key: 'noiseSuppression',
    label: 'Réduction du bruit du navigateur',
    detail:
      'GPT-Live ignore déjà le bruit ambiant. Si Cornelius vous comprend mal, essayez sans : ce filtre peut abîmer la voix.',
    on: 'Réduction du bruit du navigateur : activée.',
    off: 'Réduction du bruit du navigateur : désactivée.',
  },
  {
    key: 'autoGainControl',
    label: 'Gain automatique du micro',
    detail:
      'Relève le micro dans les silences, et avec lui la voix de Cornelius qui revient par le haut-parleur. S’il s’entend lui-même ou se laisse mal couper, essayez sans, et réglez le volume du micro dans le système.',
    on: 'Gain automatique du micro : activé.',
    off: 'Gain automatique du micro : désactivé.',
  },
] as const;

const testSeconds = 10;
type Applied = Pick<
  MediaTrackSettings,
  'echoCancellation' | 'noiseSuppression' | 'autoGainControl'
>;

export function AudioDevices({
  active,
  run,
}: {
  active: boolean;
  /** Confirme le choix dans le message commun de l’administration. */
  run: RunAction;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [preferences, setPreferences] = useState(audioPreferences);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const stopTest = useRef<(() => void) | null>(null);
  // Demande du micro en attente de la réponse du navigateur. Le jeton change dès que le test
  // n’a plus lieu d’être (rubrique quittée, conversation ouverte, réglage changé) : le flux
  // obtenu ensuite est refermé aussitôt, au lieu de rester ouvert sans bouton pour l’arrêter.
  const [requesting, setRequesting] = useState(false);
  const pending = useRef(false);
  const testToken = useRef(0);
  const cancelTest = () => {
    testToken.current++;
    stopTest.current?.();
  };

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    let mounted = true;
    const update = () => {
      void media
        .enumerateDevices()
        .then((list) => {
          if (mounted) setDevices(list);
        })
        .catch(() => {});
    };
    update();
    media.addEventListener('devicechange', update);
    // Autorisation déjà accordée à ce navigateur : inutile de la redemander pour l’afficher.
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((permission) => {
        if (mounted && permission.state === 'granted') setAuthorized(true);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      media.removeEventListener('devicechange', update);
    };
  }, []);

  useEffect(
    () => () => {
      testToken.current++;
      stopTest.current?.();
    },
    [],
  );
  // Une conversation qui s’ouvre reprend le micro.
  useEffect(() => {
    if (!active) return;
    testToken.current++;
    stopTest.current?.();
  }, [active]);

  async function authorizeMicrophone() {
    const media = navigator.mediaDevices;
    if (!media) {
      setError('Ce navigateur ne donne pas accès aux périphériques audio.');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await prepareAudio();
      releasePreparedMicrophone();
      setAuthorized(true);
      setDevices(await media.enumerateDevices());
    } catch (failure) {
      setAuthorized(false);
      setError(errorMessage(failure));
    } finally {
      setChecking(false);
    }
  }

  /** Micro ouvert quelques secondes avec les réglages du miroir, pour lire son niveau. */
  async function testMicrophone() {
    const media = navigator.mediaDevices;
    if (!media) {
      setError('Ce navigateur ne donne pas accès aux périphériques audio.');
      return;
    }
    // Un second clic avant la réponse du navigateur ouvrirait un second flux.
    if (pending.current) return;
    setError(null);
    releasePreparedMicrophone();
    const token = ++testToken.current;
    pending.current = true;
    setRequesting(true);
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia(microphoneConstraints());
    } catch (failure) {
      if (token === testToken.current) setError(errorMessage(failure));
      return;
    } finally {
      pending.current = false;
      setRequesting(false);
    }
    if (token !== testToken.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    setAuthorized(true);
    const settings = stream.getAudioTracks()[0]?.getSettings() ?? {};
    setApplied({
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    });
    const context = new AudioContext();
    const meter = context.createAnalyser();
    meter.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(meter);
    const samples = new Float32Array(meter.fftSize);
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      stopTest.current = null;
      setLevel(null);
    };
    const timer = setTimeout(stop, testSeconds * 1000);
    stopTest.current = stop;
    const tick = () => {
      meter.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
      );
      // Même échelle que l’orbe du miroir.
      setLevel(Math.min(1, rms * 5));
      frame = requestAnimationFrame(tick);
    };
    tick();
  }

  function choose(field: (typeof fields)[number], value: string) {
    const next: AudioPreferences = { ...preferences, [field.key]: value };
    setPreferences(next);
    void run(field.saved, async () => saveAudioPreferences(next), {
      key: 'audio-' + field.key,
      payload: value,
    });
  }

  function toggle(field: (typeof processing)[number], enabled: boolean) {
    const next: AudioPreferences = { ...preferences, [field.key]: enabled };
    setPreferences(next);
    // Un test en cours ou demandé garde les anciens réglages : il s’arrête pour être relancé.
    cancelTest();
    setApplied(null);
    void run(enabled ? field.on : field.off, async () => saveAudioPreferences(next), {
      key: 'audio-' + field.key,
      payload: enabled,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audio de ce navigateur</CardTitle>
        <CardDescription>
          Ce réglage s’applique au miroir ouvert dans ce navigateur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={checking || active}
            onClick={() => {
              void authorizeMicrophone();
            }}
          >
            {checking ? 'Vérification…' : 'Autoriser et vérifier le microphone'}
          </Button>
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-success">
            {authorized && !checking && (
              <>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Micro autorisé
              </>
            )}
          </span>
        </div>
        {active && (
          <p className="text-xs text-muted-foreground">
            Une conversation utilise le micro : la vérification sera possible à sa fin.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map((field) => (
            <Field key={field.key} id={field.key} label={field.label}>
              <NativeSelect
                id={field.key}
                wrapperClassName="w-full"
                className="w-full"
                value={preferences[field.key]}
                onChange={(event) => choose(field, event.target.value)}
              >
                <NativeSelectOption value="">Périphérique par défaut</NativeSelectOption>
                {preferences[field.key] &&
                  !devices.some(
                    (device) =>
                      device.kind === field.kind && device.deviceId === preferences[field.key],
                  ) && (
                    <NativeSelectOption value={preferences[field.key]}>
                      Périphérique enregistré (à reconnecter)
                    </NativeSelectOption>
                  )}
                {devices
                  .filter(
                    (device) =>
                      device.kind === field.kind &&
                      device.deviceId &&
                      device.deviceId !== 'default',
                  )
                  .map((device, index) => (
                    <NativeSelectOption key={device.deviceId} value={device.deviceId}>
                      {device.label || field.label + ' ' + (index + 1)}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
          ))}
        </div>
        {/* Un oui ou non : un interrupteur, enregistré au clic. */}
        <div className="space-y-3">
          {processing.map((field) => (
            <div key={field.key} className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor={'audio-' + field.key}>{field.label}</Label>
                <p id={'audio-' + field.key + '-detail'} className="text-xs text-muted-foreground">
                  {field.detail}
                </p>
              </div>
              <Switch
                id={'audio-' + field.key}
                aria-describedby={'audio-' + field.key + '-detail'}
                checked={preferences[field.key]}
                onCheckedChange={(enabled) => toggle(field, enabled)}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void previewAdmissionSound('carillon')}>
            <Volume2 />
            Tester le haut-parleur
          </Button>
          <Button
            variant="outline"
            disabled={active || requesting}
            onClick={() => {
              if (stopTest.current) stopTest.current();
              else void testMicrophone();
            }}
          >
            <Mic />
            {level === null ? 'Tester le micro' : 'Arrêter le test'}
          </Button>
        </div>
        {level !== null && (
          <div className="space-y-1">
            <progress aria-label="Niveau du micro" className="w-full" max={1} value={level} />
            <p className="text-xs text-muted-foreground">
              Parlez à votre distance habituelle du miroir : la barre doit bien bouger sans rester
              collée au bout. Le test s’arrête seul après {testSeconds} secondes.
            </p>
          </div>
        )}
        {applied && (
          <p className="text-xs text-muted-foreground">
            Appliqué par le navigateur : annulation d’écho {onOff(applied.echoCancellation)},
            réduction du bruit {onOff(applied.noiseSuppression)}, gain automatique{' '}
            {onOff(applied.autoGainControl)}.
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-xs text-muted-foreground">
          Le microphone n’est allumé que le temps de la vérification ou du test. L’annulation d’écho
          reste toujours active ; elle retire mieux le son quand les haut-parleurs sont la sortie
          par défaut du système, à distance du micro et pas tournés vers lui.
        </p>
      </CardContent>
    </Card>
  );
}

/** Réglage tel que le navigateur l’a appliqué, parfois absent de ses réponses. */
function onOff(value: unknown): string {
  return value === true ? 'oui' : value === false ? 'non' : 'inconnue';
}
