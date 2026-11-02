import { useEffect, useRef } from 'react';
import type { AlarmsMirrorState } from '../../shared/alarms';
import { ringAlarm } from '../audio/alarm-sound';
import { runningAudioContext } from '../audio/preparation';

/** Intervalle entre deux sonneries : serré pour un réveil, espacé pour un rappel. */
const insistentPeriodMs = 1_600;
const softPeriodMs = 8_000;
/** Le volume monte de ce point de départ au maximum en trente secondes. */
const startVolume = 0.35;
const rampMs = 30_000;

/**
 * Fait sonner le miroir tant qu'une échéance sonne et qu'aucune conversation n'est ouverte :
 * une conversation coupe le son pour qu'on s'entende, la carte reste. Sans contexte audio
 * activé (« Activer la voix »), rien ne peut sonner ; la carte reste visible.
 */
function useAlarmSound(alarms: AlarmsMirrorState | undefined, muted: boolean) {
  const ringing = alarms?.ringing ?? [];
  const soft = ringing.length > 0 && ringing.every((alarm) => alarm.soft);
  const since = ringing.length ? Math.min(...ringing.map((alarm) => alarm.firedAt)) : null;
  const sound = alarms?.sound ?? 'bips';
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (since === null || muted) return;
    started.current ??= Date.now();
    const ring = () => {
      const context = runningAudioContext();
      if (!context) return;
      const elapsed = Date.now() - (started.current ?? Date.now());
      const volume = soft ? 0.5 : Math.min(1, startVolume + (1 - startVolume) * (elapsed / rampMs));
      void ringAlarm(context, soft ? 'carillon' : sound, volume).catch(() => {});
    };
    ring();
    const timer = setInterval(ring, soft ? softPeriodMs : insistentPeriodMs);
    return () => clearInterval(timer);
  }, [since, muted, soft, sound]);
  useEffect(() => {
    if (since === null) started.current = null;
  }, [since]);
}

/** Carte de ce qui sonne, au-dessus de tout le miroir. */
export function AlarmRinging({
  alarms,
  muted,
}: {
  alarms: AlarmsMirrorState | undefined;
  muted: boolean;
}) {
  useAlarmSound(alarms, muted);
  const ringing = alarms?.ringing ?? [];
  if (!ringing.length) return null;
  return (
    <section className="mirror-alarm" role="alert" aria-label="Ce qui sonne">
      {ringing.slice(0, 3).map((alarm) => (
        <div className="mirror-alarm-item" key={alarm.id} data-kind={alarm.kind}>
          <p className="mirror-alarm-title">{alarm.title}</p>
          {alarm.text && <p className="mirror-alarm-text">{alarm.text}</p>}
        </div>
      ))}
      <p className="mirror-alarm-hint">
        {muted
          ? 'Dites « arrête » ou « encore dix minutes ».'
          : 'Parlez à Cornelius pour l’arrêter ou le repousser.'}
      </p>
    </section>
  );
}
