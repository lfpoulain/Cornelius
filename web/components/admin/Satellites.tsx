import { useCallback, useEffect, useRef, useState } from 'react';
import { SatelliteGestureSettings } from './SatelliteGestureSettings';
import { KeyRound, MicOff, TriangleAlert } from 'lucide-react';
import type { NetworkStatus, Profile } from '../../../shared/types';
import {
  SATELLITE_LED_PRESETS,
  SATELLITE_NAME_MAX,
  type SatelliteSettings,
  type PendingSatelliteView,
  type SatelliteView,
} from '../../../shared/satellites';
import { api } from '../../api';
import { formatWhen } from './format';
import { ConfirmAction, Field, OwnerSelect, ResourceState } from './shared';
import type { RunAction } from './types';
import { useAdminResource } from './useAdminResource';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

/** Jeton tout juste créé : montré une seule fois, avec ce qu’il faut saisir dans le satellite. */
interface Issued {
  name: string;
  token: string;
}

/**
 * Satellites audio : les petits micros et haut-parleurs des autres pièces, qui ouvrent une
 * conversation en voix seule quand ils entendent « Cornelius ».
 */
export function Satellites({
  profiles,
  network,
  run,
}: {
  profiles: Profile[];
  network: NetworkStatus | undefined;
  run: RunAction;
}) {
  const load = useCallback(
    () =>
      api.satellites().then((result) => ({
        satellites: result.satellites,
        pending: result.pending ?? [],
      })),
    [],
  );
  const resource = useAdminResource(load);
  const { reload } = resource;
  // Satellites en ligne, satellites neufs qui attendent : la liste suit sans recharger la page.
  useEffect(() => {
    const timer = setInterval(() => void reload(), 4_000);
    return () => clearInterval(timer);
  }, [reload]);
  const pending = resource.data?.pending ?? [];
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let created: Issued | null = null;
    const ok = await run('Satellite ajouté.', async () => {
      const result = await api.createSatellite(trimmed);
      created = { name: result.satellite.name, token: result.token };
    });
    if (ok && created) {
      setIssued(created);
      setName('');
      await resource.reload();
    }
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Satellites audio</CardTitle>
          <CardDescription>
            Un satellite écoute « Cornelius » dans une autre pièce et y tient la conversation, à
            voix seule : ni carte, ni caméra. Une seule conversation à la fois dans la maison. Un
            satellite neuf, relié au Wi-Fi, apparaît tout seul ci-dessous pour être associé ; le
            formulaire suivant ne sert qu’à un satellite configuré à la main.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {network && !network.lan && (
            <p className="flex items-start gap-2.5 rounded-lg border border-[#e8bc8866] bg-[#2a2519] px-3.5 py-3 text-[#f3d7b0]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                L’accès depuis le réseau local est désactivé : un satellite ne peut pas se
                connecter. Voir la carte « Accès depuis le réseau local » dans Mise en route.
              </span>
            </p>
          )}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Field
              id="satellite-name"
              label="Pièce du nouveau satellite"
              className="min-w-56 flex-1"
            >
              <Input
                id="satellite-name"
                value={name}
                maxLength={SATELLITE_NAME_MAX}
                placeholder="Chambre, cuisine…"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={!name.trim()}>
              Ajouter
            </Button>
          </form>
          {issued && (
            <IssuedToken issued={issued} network={network} onClose={() => setIssued(null)} />
          )}
        </CardContent>
      </Card>
      {pending.length > 0 && (
        <PendingSatellites pending={pending} run={run} onChanged={() => void resource.reload()} />
      )}
      <ResourceState
        resource={resource}
        loadingLabel="Lecture des satellites…"
        isEmpty={(data) => data.satellites.length === 0}
        empty={{
          title: 'Aucun satellite associé pour l’instant.',
          description:
            'Branchez un satellite neuf : il ouvre un réseau Wi-Fi « Cornelius-Satellite », où vous choisissez le Wi-Fi de la maison, puis il apparaît ici pour être associé.',
        }}
      >
        {({ satellites }) => (
          <div className="space-y-4">
            {satellites.map((satellite) => (
              <SatelliteCard
                key={satellite.id}
                satellite={satellite}
                profiles={profiles}
                run={run}
                onIssued={setIssued}
                onChanged={() => void resource.reload()}
              />
            ))}
          </div>
        )}
      </ResourceState>
    </div>
  );
}

function IssuedToken({
  issued,
  network,
  onClose,
}: {
  issued: Issued;
  network: NetworkStatus | undefined;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const addresses = (network?.urls ?? []).map(
    (url) => url.replace(/^https:/u, 'wss:') + '/satellite',
  );
  return (
    <div
      className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4"
      role="region"
      aria-label={'Jeton du satellite ' + issued.name}
    >
      <p className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4 text-primary" aria-hidden="true" />
        Jeton de « {issued.name} », affiché une seule fois
      </p>
      <p className="break-all rounded bg-background px-3 py-2 font-mono text-xs">{issued.token}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(issued.token)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? 'Copié' : 'Copier le jeton'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          C’est noté
        </Button>
      </div>
      <p className="text-muted-foreground">
        À saisir dans le satellite, avec l’adresse de Cornelius
        {addresses.length > 0 ? ' :' : '.'}
      </p>
      {addresses.length > 0 && (
        <ul className="space-y-1 font-mono text-xs" aria-label="Adresses pour les satellites">
          {addresses.map((address) => (
            <li key={address}>{address}</li>
          ))}
        </ul>
      )}
      {network?.keyFingerprint && (
        <p className="text-muted-foreground">
          Et l’empreinte de la clé de Cornelius, que le satellite vérifie à chaque connexion (elle
          ne change pas quand le certificat est renouvelé) :{' '}
          <span className="break-all font-mono text-xs text-foreground">
            {network.keyFingerprint}
          </span>
        </p>
      )}
    </div>
  );
}

function SatelliteCard({
  satellite,
  profiles,
  run,
  onIssued,
  onChanged,
}: {
  satellite: SatelliteView;
  profiles: Profile[];
  run: RunAction;
  onIssued: (issued: Issued) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(satellite.name);
  const [profileId, setProfileId] = useState(satellite.profileId ?? '');
  const [confirming, setConfirming] = useState<'token' | 'remove' | null>(null);
  const changed = name.trim() !== satellite.name || profileId !== (satellite.profileId ?? '');
  const id = 'satellite-' + satellite.id;
  const save = async () => {
    const ok = await run('Satellite enregistré.', () =>
      api.updateSatellite(satellite.id, {
        name: name.trim(),
        profileId: profileId || null,
      }),
    );
    if (ok) onChanged();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {satellite.name}
          <Badge variant={satellite.online ? 'default' : 'outline'}>
            {satellite.online ? 'En ligne' : 'Hors ligne'}
          </Badge>
          {satellite.online && satellite.muted && (
            <Badge variant="secondary">
              <MicOff aria-hidden="true" />
              Micro coupé
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {satellite.online
            ? 'Connecté' + (satellite.firmware ? ', firmware ' + satellite.firmware : '') + '.'
            : 'Vu pour la dernière fois : ' + formatWhen(satellite.lastSeenAt) + '.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (changed && name.trim()) void save();
          }}
        >
          <Field id={id + '-name'} label="Pièce">
            <Input
              id={id + '-name'}
              value={name}
              maxLength={SATELLITE_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            id={id + '-profile'}
            label="Conversations au nom de"
            help={
              profileId
                ? 'Quiconque parle dans cette pièce accède à la mémoire de cette personne.'
                : 'Le foyer : tout le monde, sans mémoire personnelle.'
            }
          >
            <OwnerSelect
              id={id + '-profile'}
              value={profileId}
              onChange={setProfileId}
              profiles={profiles}
            />
          </Field>
          {changed && (
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={!name.trim()}>
                Enregistrer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setName(satellite.name);
                  setProfileId(satellite.profileId ?? '');
                }}
              >
                Annuler
              </Button>
            </div>
          )}
        </form>
        <SatelliteSettingsPanel satellite={satellite} run={run} />
        <SatelliteGestureSettings id={satellite.id} run={run} />
        {confirming === 'token' ? (
          <ConfirmAction
            message={`Créer un nouveau jeton pour « ${satellite.name} » ? L’ancien cesse aussitôt de fonctionner : il faudra saisir le nouveau dans le satellite.`}
            confirmLabel="Nouveau jeton"
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              let token: string | null = null;
              void run('Nouveau jeton créé.', async () => {
                token = (await api.renewSatelliteToken(satellite.id)).token;
              }).then((ok) => {
                if (ok && token) onIssued({ name: satellite.name, token });
                onChanged();
              });
            }}
          />
        ) : confirming === 'remove' ? (
          <ConfirmAction
            message={`Retirer « ${satellite.name} » ? Il est déconnecté et son jeton ne fonctionne plus.`}
            confirmLabel="Retirer"
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              void run('Satellite retiré.', () => api.removeSatellite(satellite.id)).then(
                onChanged,
              );
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirming('token')}>
              Nouveau jeton
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming('remove')}>
              Retirer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Son et lumière d’un satellite : enregistrés aussitôt (les curseurs après une courte pause),
 * et appliqués par le satellite connecté sans redémarrer.
 */
function SatelliteSettingsPanel({ satellite, run }: { satellite: SatelliteView; run: RunAction }) {
  const id = 'satellite-' + satellite.id;
  const [volume, setVolume] = useState(Math.round(satellite.volume / 10));
  // Volume changé à la voix (« parle moins fort ») : la fiche suit la liste rechargée, sauf
  // pendant un réglage au curseur pas encore enregistré.
  const savedVolume = Math.round(satellite.volume / 10);
  const [brightness, setBrightness] = useState(satellite.ledBrightness);
  const [color, setColor] = useState(satellite.ledColor);
  const [nightLight, setNightLight] = useState(satellite.nightLight);
  const [attentive, setAttentive] = useState(satellite.attentive);
  const [silence, setSilence] = useState(
    satellite.silenceCloseMs === null ? 'household' : String(satellite.silenceCloseMs),
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);
  useEffect(() => {
    if (!timers.current.has('volume')) setVolume(savedVolume);
  }, [savedVolume]);
  const save = (key: string, label: string, patch: Partial<SatelliteSettings>, delayMs = 0) => {
    clearTimeout(timers.current.get(key));
    const send = () => {
      timers.current.delete(key);
      void run(label, () => api.updateSatellite(satellite.id, patch), {
        key: id + '-' + key,
        payload: patch,
      });
    };
    if (delayMs === 0) send();
    else timers.current.set(key, setTimeout(send, delayMs));
  };
  const swatch = (value: string) => (
    <span
      className="inline-block size-4 rounded-full border border-border"
      style={{ backgroundColor: value }}
      aria-hidden="true"
    />
  );
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <p className="font-medium">Son et lumière</p>
      <div className="flex items-center gap-4">
        <Label htmlFor={id + '-volume'} className="w-28 shrink-0">
          Volume
        </Label>
        <input
          id={id + '-volume'}
          type="range"
          className="w-full max-w-xs accent-primary"
          min={0}
          max={10}
          step={1}
          value={volume}
          aria-valuetext={`${volume} sur 10`}
          onChange={(event) => {
            const value = Number(event.target.value);
            setVolume(value);
            save('volume', `Volume : ${value} sur 10.`, { volume: value * 10 }, 400);
          }}
        />
        <output htmlFor={id + '-volume'} className="w-10 text-right tabular-nums">
          {volume}
        </output>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Couleur de l’anneau</legend>
        <div className="flex flex-wrap items-center gap-2">
          {SATELLITE_LED_PRESETS.map((preset) => (
            <Button
              key={preset.color}
              type="button"
              size="sm"
              variant={color === preset.color ? 'default' : 'outline'}
              aria-pressed={color === preset.color}
              onClick={() => {
                setColor(preset.color);
                save('color', `Couleur : ${preset.label.toLowerCase()}.`, {
                  ledColor: preset.color,
                });
              }}
            >
              {swatch(preset.color)}
              {preset.label}
            </Button>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Autre couleur</span>
            <input
              type="color"
              className="h-8 w-10 cursor-pointer rounded border bg-transparent"
              value={color}
              onChange={(event) => {
                const value = event.target.value.toLowerCase();
                setColor(value);
                save('color', 'Couleur de l’anneau enregistrée.', { ledColor: value }, 400);
              }}
            />
            Autre…
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Pour l’écoute, l’ouverture et la conversation. Les alertes gardent leur couleur : rouge
          micro coupé, orange Cornelius injoignable, ambre occupé.
        </p>
      </fieldset>
      <div className="flex items-center gap-4">
        <Label htmlFor={id + '-brightness'} className="w-28 shrink-0">
          Luminosité
        </Label>
        <input
          id={id + '-brightness'}
          type="range"
          className="w-full max-w-xs accent-primary"
          min={0}
          max={10}
          step={1}
          value={brightness}
          aria-valuetext={brightness === 0 ? 'alertes seulement' : `${brightness} sur 10`}
          onChange={(event) => {
            const value = Number(event.target.value);
            setBrightness(value);
            save(
              'brightness',
              value === 0 ? 'Anneau éteint, sauf alertes.' : `Luminosité : ${value} sur 10.`,
              { ledBrightness: value },
              400,
            );
          }}
        />
        <output htmlFor={id + '-brightness'} className="w-10 text-right tabular-nums">
          {brightness}
        </output>
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id + '-night'}>
          Veilleuse : une lueur faible en veille, pour voir que le satellite est prêt
        </Label>
        <Switch
          id={id + '-night'}
          checked={nightLight}
          onCheckedChange={(enabled) => {
            setNightLight(enabled);
            save('night', enabled ? 'Veilleuse allumée.' : 'Veilleuse éteinte.', {
              nightLight: enabled,
            });
          }}
        />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={id + '-attentive'}>
            Écoute attentive : couper la parole à Cornelius pendant qu’il répond
          </Label>
          <Switch
            id={id + '-attentive'}
            aria-describedby={id + '-attentive-help'}
            checked={attentive}
            onCheckedChange={(enabled) => {
              setAttentive(enabled);
              save(
                'attentive',
                enabled ? 'Écoute attentive activée.' : 'Écoute attentive désactivée.',
                { attentive: enabled },
              );
            }}
          />
        </div>
        <p id={id + '-attentive-help'} className="text-xs text-muted-foreground">
          {satellite.aec
            ? 'Le satellite annule l’écho de son haut-parleur : son micro reste ouvert pendant que Cornelius parle.'
            : satellite.online
              ? 'Sans effet pour l’instant : ce satellite n’annule pas encore l’écho, son micro est coupé pendant que Cornelius parle.'
              : 'Ne s’applique qu’à un satellite qui annule l’écho de son haut-parleur.'}
        </p>
      </div>
      <Field
        id={id + '-silence'}
        label="Fin de parole sur ce satellite"
        help="Délai de silence avant que la conversation se ferme. « Comme le foyer » suit Quand il écoute → Fin de parole."
      >
        <NativeSelect
          id={id + '-silence'}
          value={silence}
          onChange={(event) => {
            const value = event.target.value;
            setSilence(value);
            const silenceCloseMs = value === 'household' ? null : Number(value);
            save(
              'silence',
              silenceCloseMs === null
                ? 'Fin de parole : comme le foyer.'
                : 'Fin de parole : après ' + silenceCloseMs / 1000 + ' s de silence.',
              { silenceCloseMs },
            );
          }}
        >
          <NativeSelectOption value="household">Comme le foyer</NativeSelectOption>
          {[5000, 10_000, 20_000, 30_000, 60_000].map((ms) => (
            <NativeSelectOption key={ms} value={String(ms)}>
              {ms / 1000} s
            </NativeSelectOption>
          ))}
          {satellite.silenceCloseMs !== null &&
            ![5000, 10_000, 20_000, 30_000, 60_000].includes(satellite.silenceCloseMs) && (
              <NativeSelectOption value={String(satellite.silenceCloseMs)}>
                {satellite.silenceCloseMs / 1000} s
              </NativeSelectOption>
            )}
        </NativeSelect>
      </Field>
    </div>
  );
}

/** Satellites neufs, reliés au Wi-Fi, qui attendent qu’on les associe à Cornelius. */
function PendingSatellites({
  pending,
  run,
  onChanged,
}: {
  pending: PendingSatelliteView[];
  run: RunAction;
  onChanged: () => void;
}) {
  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle>Nouveaux satellites</CardTitle>
        <CardDescription>
          Ces satellites ont trouvé Cornelius et attendent votre accord. Donnez une pièce à chacun ;
          « Faire clignoter » allume son anneau pour le reconnaître.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {pending.map((entry) => (
          <PendingSatellite key={entry.device} entry={entry} run={run} onChanged={onChanged} />
        ))}
      </CardContent>
    </Card>
  );
}

function PendingSatellite({
  entry,
  run,
  onChanged,
}: {
  entry: PendingSatelliteView;
  run: RunAction;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const id = 'pending-' + entry.device;
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void run('Satellite associé.', () => api.acceptSatellite(entry.device, name.trim()), {
          key: id + '-accept',
        }).then(onChanged);
      }}
    >
      <p>
        <span className="font-mono">{entry.device}</span>
        <span className="text-muted-foreground">
          {' '}
          · firmware {entry.firmware}
          {entry.address ? ' · ' + entry.address.replace(/^::ffff:/u, '') : ''}
        </span>
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field id={id + '-name'} label="Pièce" className="min-w-56 flex-1">
          <Input
            id={id + '-name'}
            value={name}
            maxLength={SATELLITE_NAME_MAX}
            placeholder="Chambre, cuisine…"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Button type="submit" disabled={!name.trim()}>
          Associer
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void run('Le satellite clignote.', () => api.identifySatellite(entry.device), {
              key: id + '-identify',
            })
          }
        >
          Faire clignoter
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            void run('Association refusée.', () => api.rejectSatellite(entry.device), {
              key: id + '-reject',
            }).then(onChanged)
          }
        >
          Refuser
        </Button>
      </div>
    </form>
  );
}
