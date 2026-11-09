import { useEffect, useId, useRef, useState } from 'react';
import { request } from '../../api';
import {
  GESTURES,
  GESTURE_ACTIONS,
  GESTURE_LABELS,
  ACTION_LABELS,
  defaultGestureConfig,
  suggestedGestureConfig,
  type GestureConfig,
} from '../../../shared/satellite-gestures';
import { Button } from '../ui/button';
import type { RunAction } from './types';

export function SatelliteGestureSettings({ id, run }: { id: string; run: RunAction }) {
  const [config, setConfig] = useState<GestureConfig>(defaultGestureConfig);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  const [lights, setLights] = useState<{ id: string; name: string }[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const helpId = useId();
  const helpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!helpOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!helpRef.current?.contains(event.target as Node)) setHelpOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [helpOpen]);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const load = () =>
      void request<{
        config: GestureConfig;
        supported: boolean;
        lights: { id: string; name: string }[];
        last: { gesture: (typeof GESTURES)[number]; result: string; at: number } | null;
      }>(`/api/admin/satellites/${id}/gestures`)
        .then((value) => {
          if (disposed) return;
          if (!dirty) setConfig(value.config);
          setLoaded(true);
          setLights(value.lights);
          setStatus(
            (value.supported
              ? 'Capteur annoncé par le satellite.'
              : 'Capteur non annoncé ou satellite hors ligne.') +
              (value.last
                ? ` Dernier geste : ${GESTURE_LABELS[value.last.gesture]} (${new Date(value.last.at).toLocaleTimeString()}) — ${value.last.result}.`
                : ' Aucun geste reçu.'),
          );
        })
        .catch(() => {
          if (!disposed) setStatus('Réglages des gestes indisponibles.');
        });
    load();
    const timer = setInterval(load, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [id, dirty, open]);
  return (
    <details
      className="space-y-3 rounded-lg border p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">Gestes de la main</summary>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm" role="status">
          {status}
        </p>
        <div
          ref={helpRef}
          className="relative shrink-0"
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') setHelpOpen(true);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse' && !helpRef.current?.querySelector(':focus-visible'))
              setHelpOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setHelpOpen(false);
              event.stopPropagation();
            }
          }}
        >
          <button
            type="button"
            aria-label="Aide sur les commandes gestuelles"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            aria-describedby={helpOpen ? helpId : undefined}
            className="inline-flex size-7 items-center justify-center rounded-full border text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => setHelpOpen((value) => !value)}
            onFocus={(event) => {
              if (event.currentTarget.matches(':focus-visible')) setHelpOpen(true);
            }}
            onBlur={() => setHelpOpen(false)}
          >
            ?
          </button>
          {helpOpen && (
            <div className="absolute right-0 top-full z-50 w-[min(26rem,calc(100vw-8rem))] pt-2">
              <div
                id={helpId}
                role="tooltip"
                className="max-h-[60vh] overflow-y-auto rounded-lg border bg-popover p-4 text-sm leading-relaxed text-popover-foreground shadow-lg"
              >
                La capture permet de vérifier les directions avant d’activer les commandes. Les
                gestes Home Assistant commandent directement les lampes autorisées et configurées de
                cette pièce, sans conversation ni caméra. La protection des commandes vocales reste
                inchangée. Un geste peut couper le micro. Seul le bouton du satellite peut le
                rouvrir. Le bouton physique reste utilisable ; l’état du micro est conservé après
                redémarrage.
              </div>
            </div>
          )}
        </div>
      </div>
      <label className="flex gap-2">
        <input
          type="checkbox"
          disabled={!loaded}
          checked={config.enabled}
          onChange={(e) => {
            setDirty(true);
            setConfig({ ...config, enabled: e.target.checked });
          }}
        />
        Activer les commandes gestuelles
      </label>
      <fieldset className="space-y-2 rounded border p-3 text-sm">
        <legend>Lampes commandées par les gestes de ce satellite</legend>
        <p>
          Seuls les appareils déjà autorisés dans Home Assistant sont proposés. Sans sélection, les
          gestes de lumière ne commandent rien.
        </p>
        {lights.map((light) => (
          <label key={light.id} className="flex gap-2">
            <input
              type="checkbox"
              checked={(config.lightEntityIds ?? []).includes(light.id)}
              onChange={(event) => {
                setDirty(true);
                const selected = config.lightEntityIds ?? [];
                setConfig({
                  ...config,
                  lightEntityIds: event.target.checked
                    ? [...selected, light.id]
                    : selected.filter((id) => id !== light.id),
                });
              }}
            />
            {light.name}
          </label>
        ))}
      </fieldset>
      {GESTURES.map((gesture) => (
        <label key={gesture} className="flex flex-wrap items-center gap-3 text-sm">
          <span className="w-40">{GESTURE_LABELS[gesture]}</span>
          <select
            aria-label={GESTURE_LABELS[gesture]}
            disabled={!loaded}
            className="rounded border bg-background p-2"
            value={config.bindings[gesture]}
            onChange={(e) => {
              setDirty(true);
              setConfig({ ...config, bindings: { ...config.bindings, [gesture]: e.target.value } });
            }}
          >
            {GESTURE_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!loaded}
          onClick={() => {
            setConfig({ ...suggestedGestureConfig(), lightEntityIds: config.lightEntityIds ?? [] });
            setDirty(true);
          }}
        >
          Préremplir les suggestions
        </Button>
        <Button
          type="button"
          disabled={!loaded || !dirty}
          onClick={() =>
            void run('Associations de gestes enregistrées.', () =>
              request(`/api/admin/satellites/${id}/gestures`, {
                method: 'PUT',
                body: JSON.stringify(config),
              }),
            ).then((ok) => {
              if (ok) setDirty(false);
            })
          }
        >
          Enregistrer les gestes
        </Button>
      </div>
    </details>
  );
}
