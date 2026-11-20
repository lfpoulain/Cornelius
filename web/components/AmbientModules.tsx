import { CardIconView } from './card-icons';
import { useEffect, useMemo, useState } from 'react';
import type { AmbientDisplay } from '../../shared/addons';
import { ambientProfile } from '../../shared/ambient';
import type { MirrorState } from '../../shared/types';

function statusLabel(display: AmbientDisplay): string | null {
  if (display.status === 'loading') return 'Actualisation…';
  if (display.status === 'empty') return 'Aucune donnée disponible';
  if (display.status === 'error') return 'Source indisponible';
  if (display.status === 'stale') return 'Dernière donnée connue';
  return null;
}

const shortAge = new Intl.RelativeTimeFormat('fr-FR', { style: 'short', numeric: 'always' });
const longAge = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'always' });

/** Ancienneté lisible d’un coup d’œil : « il y a 12 min », « il y a 2 h », « il y a 3 jours ». */
function ageLabel(fetchedAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return shortAge.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return shortAge.format(-hours, 'hour');
  return longAge.format(-Math.round(hours / 24), 'day');
}

/** Informations présentes sur le miroir, indépendantes des cartes et de la voix. */
export function AmbientModules({ state, now }: { state: MirrorState; now: number }) {
  const profile = ambientProfile(state);
  // Quatre au plus : un miroir ne défile pas ; la feuille de style en montre moins sur un
  // petit écran.
  const displays =
    profile === undefined
      ? []
      : (state.ambientDisplays ?? [])
          .filter((display) => display.profileId === null || display.profileId === profile)
          .slice(0, 4);
  // L’ancienneté d’une donnée périmée avance même sans nouvel état du serveur : `now` (heure
  // du serveur) fixe l’écart d’horloge, une minuterie fait avancer l’affichage.
  const offset = useMemo(() => now - Date.now(), [now]);
  const stale = displays.some((display) => display.status === 'stale' && display.fetchedAt);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!stale) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, [stale]);
  if (displays.length === 0) return null;
  return (
    <aside className="mirror-ambient" aria-label="Informations permanentes">
      {displays.map((display) => {
        const content = display.content;
        const status = statusLabel(display);
        return (
          <section
            key={display.instanceId}
            className="ambient-module"
            data-layout={content?.layout ?? 'metric'}
            data-status={display.status}
            aria-label={display.label}
          >
            {/* Un seul en-tête : le nom choisi pour cette source (« Météo maison »), plus précis
                que le titre générique du module (« Météo »). */}
            <h2 className="ambient-heading">{display.label}</h2>
            {content?.value && (
              <p className="ambient-value">
                {content.icon && <CardIconView name={content.icon} />}
                {content.value}
              </p>
            )}
            {content?.subtitle && <p className="ambient-subtitle">{content.subtitle}</p>}
            {!!content?.items.length && (
              <dl className="ambient-items">
                {content.items.map((item, index) => (
                  <div key={index}>
                    <dt>
                      {item.icon && <CardIconView name={item.icon} />}
                      {item.label}
                    </dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {display.status === 'stale' && display.fetchedAt ? (
              // Valeur périmée : son ancienneté reste visible, même sur un petit écran.
              <p className="ambient-status">
                {status},{' '}
                <time dateTime={display.fetchedAt}>
                  {ageLabel(display.fetchedAt, Date.now() + offset)}
                </time>
              </p>
            ) : (
              status && <p className="ambient-status">{status}</p>
            )}
            {display.fetchedAt &&
              display.status !== 'stale' &&
              content?.showCollectedAt !== false && (
                <time className="ambient-time" dateTime={display.fetchedAt}>
                  Relevé{' '}
                  {new Intl.DateTimeFormat('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(display.fetchedAt))}
                </time>
              )}
          </section>
        );
      })}
    </aside>
  );
}
