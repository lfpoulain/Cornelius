import { useEffect, useMemo, useState } from 'react';
import type { AlarmsMirrorState } from '../../shared/alarms';

/** Temps restant d'un minuteur : « 9:05 », « 1:02:30 ». */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * Minuteurs en cours, prochain réveil et pense-bêtes du jour, au-dessus des informations
 * permanentes et avec leur typographie. Le compte à rebours avance chaque seconde sur
 * l'horloge du serveur (`now`).
 */
export function AlarmBand({ alarms, now }: { alarms: AlarmsMirrorState | undefined; now: number }) {
  const timers = alarms?.timers ?? [];
  const nextAlarm = alarms?.nextAlarm ?? null;
  const today = alarms?.today ?? [];
  const offset = useMemo(() => now - Date.now(), [now]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timers.length) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [timers.length]);
  if (!timers.length && !nextAlarm && !today.length) return null;
  const clock = Date.now() + offset;
  const first = timers[0];
  return (
    <aside className="mirror-ambient mirror-alarms" aria-label="Minuteurs, réveil et rappels">
      {first && (
        <section className="ambient-module" data-layout="metric" aria-label="Minuteur">
          <h2 className="ambient-heading">
            {timers.length > 1 ? 'Minuteurs' : 'Minuteur'}
            {first.label ? ` · ${first.label}` : ''}
          </h2>
          <p className="ambient-value">
            <time dateTime={new Date(first.endsAt).toISOString()}>
              {countdown(first.endsAt - clock)}
            </time>
          </p>
          {timers.length > 1 && (
            <p className="ambient-subtitle">
              {timers
                .slice(1, 3)
                .map((timer) => `${timer.label ?? 'minuteur'} ${countdown(timer.endsAt - clock)}`)
                .join(' · ')}
            </p>
          )}
        </section>
      )}
      {nextAlarm && (
        <section className="ambient-module" data-layout="metric" aria-label="Prochain réveil">
          <h2 className="ambient-heading">Réveil</h2>
          <p className="ambient-value">{nextAlarm.time}</p>
          <p className="ambient-subtitle">
            {nextAlarm.day}
            {nextAlarm.label ? ` · ${nextAlarm.label}` : ''}
          </p>
        </section>
      )}
      {today.length > 0 && (
        <section className="ambient-module" data-layout="list" aria-label="Pense-bêtes du jour">
          <h2 className="ambient-heading">Aujourd’hui</h2>
          <dl className="ambient-items">
            {today.slice(0, 3).map((reminder) => (
              <div key={reminder.id}>
                <dt>{reminder.time}</dt>
                <dd>{reminder.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </aside>
  );
}
