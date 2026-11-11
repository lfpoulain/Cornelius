import { useEffect, useState } from 'react';
import { CircleAlert, ScanFace, UserRoundCheck } from 'lucide-react';
import type { Profile, RecognitionLive } from '../../../shared/types';
import { request } from '../../api';
import { Fold } from './shared';

const decimal = (value: number) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Les similarités utiles vont de 0 à environ 0,8 : l’échelle des barres s’y arrête.
const SCALE = 0.8;

/**
 * Scores de reconnaissance en direct pour la personne devant le miroir : de quoi comprendre
 * pourquoi elle est (ou n’est pas) reconnue, et quel réglage ajuster.
 */
export function RecognitionTester({ profiles }: { profiles: Profile[] }) {
  const [live, setLive] = useState<RecognitionLive | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = async () => {
      if (!document.hidden) {
        try {
          const result = await request<{ live: RecognitionLive | null }>(
            '/api/admin/recognition/live',
          );
          if (!active) return;
          setLive(result.live);
          setFailed(false);
        } catch {
          if (active) setFailed(true);
        }
      }
      if (active) timer = setTimeout(() => void next(), 400);
    };
    void next();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const name = (id: string | null) =>
    profiles.find((profile) => profile.id === id)?.name ?? 'Profil inconnu';
  const face = live?.faces[0];

  return (
    // Seule la ligne d’état est annoncée : les scores, réécrits toutes les 400 ms, noieraient
    // un lecteur d’écran.
    <div className="admin-tester">
      {!live || !face ? (
        <p className="admin-tester-empty" aria-live="polite">
          <ScanFace className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {failed
            ? 'Ressemblances indisponibles : le service caméra ne répond pas.'
            : live
              ? 'Aucun visage détecté. Placez-vous devant le miroir.'
              : 'En attente de la caméra…'}
        </p>
      ) : (
        <>
          <div className="admin-tester-head" aria-live="polite">
            {face.identity ? (
              <p className="text-success">
                <UserRoundCheck className="size-4" aria-hidden="true" />
                Reconnu : <strong>{name(face.identity)}</strong>
              </p>
            ) : (
              <p className="text-muted-foreground">
                <ScanFace className="size-4" aria-hidden="true" />
                Pas encore identifié
              </p>
            )}
            {live.faces.length > 1 && (
              <span className="text-xs text-muted-foreground">
                {live.faces.length} visages : le plus proche est analysé.
              </span>
            )}
          </div>
          <ul className="admin-tester-bars">
            {face.scores.length === 0 && (
              <li className="text-sm text-muted-foreground">Aucun visage mémorisé à comparer.</li>
            )}
            {face.scores.map((entry, index) => (
              <li key={entry.profileId}>
                <span className="admin-tester-name">{name(entry.profileId)}</span>
                <span
                  className="admin-tester-track"
                  role="meter"
                  aria-label={'Ressemblance avec ' + name(entry.profileId)}
                  aria-valuemin={0}
                  aria-valuemax={1}
                  aria-valuenow={entry.score}
                >
                  <span
                    className="admin-tester-fill"
                    data-best={index === 0 && entry.score >= live.threshold}
                    style={{ width: `${Math.max(0, Math.min(1, entry.score / SCALE)) * 100}%` }}
                  />
                  <span
                    className="admin-tester-threshold"
                    style={{ left: `${(live.threshold / SCALE) * 100}%` }}
                    title={'Exigence : ' + decimal(live.threshold)}
                  />
                </span>
                <span className="admin-tester-score">{decimal(entry.score)}</span>
              </li>
            ))}
          </ul>
          <dl className="admin-tester-facts">
            <div>
              <dt>Exigence</dt>
              <dd>{decimal(live.threshold)}</dd>
            </div>
            {face.scores.length > 1 && (
              <div>
                <dt>Écart avec {name(face.scores[1]!.profileId)}</dt>
                <dd
                  className={
                    face.scores[0]!.score - face.scores[1]!.score >= (face.required ?? 0.08)
                      ? 'text-success'
                      : 'text-warning'
                  }
                >
                  {decimal(face.scores[0]!.score - face.scores[1]!.score)} · exigé{' '}
                  {decimal(face.required ?? 0.08)}
                </dd>
              </div>
            )}
            <div>
              <dt>Image</dt>
              <dd className={face.usable ? 'text-success' : 'text-warning'}>
                {face.usable ? 'utilisable' : 'ignorée'}
              </dd>
            </div>
          </dl>
          {!face.usable && (
            <p className="admin-tester-note">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              {face.issue ??
                'Visage trop loin, flou ou tourné : cette image ne compte pas pour identifier.'}
            </p>
          )}
        </>
      )}
      <Fold
        variant="inline"
        summary="Comment lire ces scores et quoi régler ?"
        className="admin-tester-help"
      >
        <ul>
          <li>
            <strong>Le score</strong> mesure la ressemblance avec chaque visage mémorisé. Une
            personne est reconnue quand son score dépasse l’<strong>exigence</strong> (trait
            vertical) sur plusieurs images de suite.
          </li>
          <li>
            <strong>L’écart</strong> sépare les deux premiers profils. Il doit être assez net ;
            Cornelius exige un écart plus grand entre deux personnes qui se ressemblent.
          </li>
          <li>
            Vous êtes confondu avec un proche ? <strong>Complétez les deux visages</strong> dans un
            autre éclairage, puis passez d’un cran vers « Stricte ».
          </li>
          <li>
            Vous n’êtes jamais reconnu alors que votre score est juste sous le trait ? Passez d’un
            cran vers « Souple », ou complétez votre visage.
          </li>
        </ul>
      </Fold>
    </div>
  );
}
